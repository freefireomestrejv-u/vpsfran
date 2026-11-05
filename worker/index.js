// Worker: busca lembretes vencidos no Supabase e envia pelo WA-AKG (localhost)
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  WAAKG_URL = "http://localhost:3000",
  WAAKG_API_KEY,
  WAAKG_SESSION_ID,
  AFFILIATE_CODE,
  NOME_MARCA = "Equipe Renew Veins",
  MAX_POR_DIA = "40",        // limite de envios nas últimas 24h (protege o chip)
  HORA_INICIO = "0",         // janela de envio (horário de Brasília): 0-24 = sempre
  HORA_FIM = "24",
  INTERVALO_MIN_S = "20",    // pausa aleatória entre mensagens
  INTERVALO_MAX_S = "60",
  MAX_TENTATIVAS = "3",
} = process.env;

for (const [k, v] of Object.entries({ SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, WAAKG_API_KEY, WAAKG_SESSION_ID })) {
  if (!v) { console.error(`Falta ${k} no .env`); process.exit(1); }
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (a, b) => Math.floor(a + Math.random() * (b - a));
const log = (...a) => console.log(new Date().toLocaleString("pt-BR"), ...a);

// ------------------------------------------------------------------
// Etiqueta de rastreamento: marca o link de retomada para sabermos no
// webhook da B4Y que a compra veio de um lembrete (utm_source=recuperacao).
// Não mexe em nada do link original (b4f= do afiliado é preservado);
// se o link for inválido, volta exatamente como era.
// ------------------------------------------------------------------
function linkMarcado(l) {
  const bruto = String(l?.link_retomada || "").trim();
  if (!bruto || !/^https?:\/\//i.test(bruto)) return bruto;
  try {
    const u = new URL(bruto);
    if (!u.searchParams.has("utm_source")) u.searchParams.set("utm_source", "recuperacao");
    if (!u.searchParams.has("utm_medium")) u.searchParams.set("utm_medium", "whatsapp");
    if (!u.searchParams.has("sck")) u.searchParams.set("sck", "recuperacao-wpp");
    if (l?.id != null && !u.searchParams.has("b1")) u.searchParams.set("b1", String(l.id));
    return u.toString();
  } catch {
    return bruto;
  }
}

function horaBrasilia() {
  return Number(new Intl.DateTimeFormat("pt-BR", { hour: "numeric", hour12: false, timeZone: "America/Sao_Paulo" }).format(new Date()));
}

// Templates editáveis na aba Recuperação (cache de 60s; cai para o padrão se falhar).
// Regra: cada sessão usa SOMENTE o script dela. O script "padrao" é o do produtor:
// afiliada sem script próprio = textos genéricos do código, sem áudio.
let tplCache = { quando: 0, dados: {} };
async function carregarTemplates() {
  if (Date.now() - tplCache.quando < 60_000) return tplCache.dados;
  const meuCodigo = AFFILIATE_CODE ? AFFILIATE_CODE.trim() : null;
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/templates_recuperacao?select=sessao,etapa,texto,audio_url,blocos`, {
      headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
    });
    const rows = await r.json();
    const temConteudo = (t) => (Array.isArray(t.blocos) && t.blocos.length) || String(t.texto || "").trim() || t.audio_url;
    const dados = {};
    // Produtor: base = script "padrao" (afiliada NUNCA herda isso)
    if (!meuCodigo) {
      for (const t of rows || []) {
        if ((t.sessao || "padrao") === "padrao") dados[t.etapa] = t;
      }
    }
    // Script da PRÓPRIA sessão (sobrescreve o padrão no produtor; é o único na afiliada)
    for (const t of rows || []) {
      if (t.sessao === WAAKG_SESSION_ID && temConteudo(t)) dados[t.etapa] = t;
    }
    tplCache = { quando: Date.now(), dados };
  } catch (e) {
    log("Aviso: usando textos padrão (templates).");
  }
  return tplCache.dados;
}

function render(template, l) {
  const primeiro = (l.nome ?? "").trim().split(" ")[0] || "tudo bem";
  const valor = l.valor ? ` (R$ ${Number(l.valor).toFixed(2).replace(".", ",")})` : "";
  const produto = l.produto ? ` de ${l.produto}` : "";
  return String(template)
    .replaceAll("{nome}", primeiro)
    .replaceAll("{produto}", produto)
    .replaceAll("{valor}", valor)
    .replaceAll("{codigo}", l.codigo_pix || "")
    .replaceAll("{link}", linkMarcado(l))
    .replaceAll("{marca}", NOME_MARCA);
}

async function sessaoConectada() {
  try {
    const r = await fetch(`${WAAKG_URL}/api/sessions/${WAAKG_SESSION_ID}`, { headers: { "X-API-Key": WAAKG_API_KEY } });
    const j = await r.json();
    return j?.data?.status === "CONNECTED";
  } catch {
    return false;
  }
}

function etapaDe(l) {
  const id = String(l.pedido_id);
  if (id.endsWith("#boasvindas")) return "boasvindas";
  if (id.startsWith("abandono:")) return "abandono";
  if (id.endsWith("#cartao")) return "cartao";
  return "cobranca";
}

function montarMensagem(l, tpls = {}) {
  const etapa = etapaDe(l);
  const t = tpls[etapa] || {};

  // Modelo novo: sequência de blocos [{tipo: texto|audio|codigo}]
  if (Array.isArray(t.blocos) && t.blocos.length) {
    const partes = [];
    for (const b of t.blocos) {
      if (b.tipo === "texto" && b.texto) partes.push({ kind: "texto", texto: render(b.texto, l) });
      else if (b.tipo === "codigo" && l.codigo_pix) partes.push({ kind: "texto", texto: l.codigo_pix });
      else if (b.tipo === "audio" && b.audio_url) partes.push({ kind: "audio", url: b.audio_url });
    }
    return { partes, sequencia: true };
  }

  const tpl = t.texto;
  const audioUrl = t.audio_url || null;

  // Sem template salvo: comportamento padrão de antes
  if (!tpl) {
    const primeiro = (l.nome ?? "").trim().split(" ")[0] || "tudo bem";
    const valor = l.valor ? ` (R$ ${Number(l.valor).toFixed(2).replace(".", ",")})` : "";
    const produto = l.produto ? ` ${l.produto}` : "";
    if (etapa === "boasvindas") {
      return { partes: [
        `Oi, ${primeiro}! Aqui é da ${NOME_MARCA}.`,
        `Vi que você gerou o QR Code${produto}${valor}. Fico muito feliz que confiou no nosso trabalho!`,
        "Qualquer dúvida, estou por aqui à disposição. Assim que o pagamento for confirmado, te aviso.",
      ].join("\n\n"), audioUrl };
    }
    const corpo = [`Oi, ${primeiro}! Aqui é da ${NOME_MARCA}.`, `Vi que você gerou o Pix${produto ? ` de${produto}` : ""}${valor}, mas o pagamento ainda não caiu.`];
    if (l.codigo_pix) corpo.push("Se ainda quiser, segue o Pix Copia e Cola:");
    else if (l.link_retomada) corpo.push(`Você pode finalizar por aqui: ${linkMarcado(l)}`);
    corpo.push("Se já pagou, pode ignorar esta mensagem. Para não receber mais avisos, responda SAIR.");
    const partes = [corpo.join("\n\n")];
    if (l.codigo_pix && !partes[0].includes(l.codigo_pix)) partes.push(l.codigo_pix);
    return { partes, audioUrl };
  }

  // Com template: renderiza variáveis; código Pix vai separado (salvo se já estiver no texto)
  const texto = render(tpl, l);
  const partes = [texto];
  if (etapa !== "boasvindas" && l.codigo_pix && !texto.includes(l.codigo_pix)) partes.push(l.codigo_pix);
  return { partes, audioUrl };
}

async function enviarAudio(telefone, audioUrl) {
  const r = await fetch(audioUrl);
  if (!r.ok) throw new Error(`Áudio HTTP ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  const fd = new FormData();
  fd.append("file", new Blob([buf], { type: "audio/ogg" }), "audio.ogg");
  fd.append("type", "voice");
  const jid = encodeURIComponent(`${telefone}@s.whatsapp.net`);
  const s = await fetch(`${WAAKG_URL}/api/messages/${WAAKG_SESSION_ID}/${jid}/media`, {
    method: "POST",
    headers: { "X-API-Key": WAAKG_API_KEY },
    body: fd,
  });
  const j = await s.json().catch(() => ({}));
  if (!s.ok || j.status !== true) throw new Error(j.message || j.error || `HTTP ${s.status}`);
  return j?.data?.key?.id ?? j?.data?.id ?? null;
}

async function enviar(telefone, texto) {
  const jid = encodeURIComponent(`${telefone}@s.whatsapp.net`);
  const r = await fetch(`${WAAKG_URL}/api/messages/${WAAKG_SESSION_ID}/${jid}/send`, {
    method: "POST",
    headers: { "X-API-Key": WAAKG_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ message: { text: texto } }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.status !== true) throw new Error(j.message || j.error || `HTTP ${r.status}`);
  return j?.data?.key?.id ?? null;
}

async function atualizar(id, campos) {
  await supabase.from("lembretes").update({ ...campos, atualizado_em: new Date().toISOString() }).eq("id", id);
}

// Reserva origem-aware: cada worker busca e trava SOMENTE os leads da própria origem
// (b4f do link). A atualização condicional (status=pendente) garante exclusividade
// entre workers concorrentes, sem depender da ordem cega da fila.
async function reservarOrigem(limite, meuCodigo) {
  const agora = new Date().toISOString();
  // Filtro de origem direto na query: afiliada pega só os links com o b4f dela;
  // produtor pega os SEM b4f (incluindo linhas sem link).
  let query = supabase.from("lembretes")
    .select("*")
    .eq("status", "pendente")
    .lt("enviar_em", agora)
    .order("criado_em", { ascending: true })
    .limit(limite * 4);
  query = meuCodigo
    ? query.like("link_retomada", "%b4f=" + meuCodigo + "%")
    : query.or("link_retomada.is.null,link_retomada.not.like.*b4f=*");
  const { data: candidatos, error } = await query;
  if (error) { log("Erro ao buscar fila:", error.message); return []; }
  const reservados = [];
  for (const l of candidatos ?? []) {
    if (reservados.length >= limite) break;
    const { data: upd, error: e2 } = await supabase.from("lembretes")
      .update({ status: "enviando", tentativas: (l.tentativas || 0) + 1, atualizado_em: agora })
      .eq("id", l.id).eq("status", "pendente").select();
    if (!e2 && upd && upd.length) reservados.push(upd[0]);
  }
  return reservados;
}

async function ciclo() {
  // Linhas travadas em "enviando" há mais de 10 min (worker caiu no meio): voltam para a fila
  await supabase.from("lembretes").update({ status: "pendente" })
    .eq("status", "enviando").lt("atualizado_em", new Date(Date.now() - 10 * 60_000).toISOString());

  const h = horaBrasilia();
  if (h < Number(HORA_INICIO) || h >= Number(HORA_FIM)) return;
  if (!(await sessaoConectada())) { log("⚠️  Sessão do WhatsApp NÃO está conectada. Nada enviado."); return; }

  // Limite diário por origem: cada número/sessão conta só os próprios envios.
  const meuCodigo = AFFILIATE_CODE ? AFFILIATE_CODE.trim() : null;
  const { data: enviados } = await supabase.from("lembretes").select("link_retomada")
    .eq("status", "enviado").gte("atualizado_em", new Date(Date.now() - 24 * 3600_000).toISOString());
  const count = (enviados ?? []).filter((r) => {
    const m = String(r.link_retomada || "").match(/b4f=([A-Za-z0-9_-]+)/);
    return meuCodigo ? m?.[1] === meuCodigo : !m;
  }).length;
  const restante = Number(MAX_POR_DIA) - count;
  if (restante <= 0) { log("Limite diário atingido."); return; }

  const lote = await reservarOrigem(Math.min(5, restante), meuCodigo);

  for (const l of lote ?? []) {
    try {
      if (l.expira_em && new Date(l.expira_em) < new Date()) { await atualizar(l.id, { status: "descartado", erro: "Pix expirado" }); continue; }
      const { data: bloqueado } = await supabase.from("optout").select("telefone").eq("telefone", l.telefone).maybeSingle();
      if (bloqueado) { await atualizar(l.id, { status: "descartado", erro: "optout" }); continue; }

      // Última checagem: pode ter sido pago enquanto estava na fila
      const { data: atual } = await supabase.from("lembretes").select("status").eq("id", l.id).single();
      if (atual?.status === "pago") continue;

      const tpls = await carregarTemplates();
      const m = montarMensagem(l, tpls);
      let msgId = null;
      if (m.sequencia) {
        // Modelo novo: cada bloco na ordem definida na aba
        for (const p of m.partes) {
          try {
            if (p.kind === "texto") {
              const id = await enviar(l.telefone, p.texto);
              if (!msgId) msgId = id;
            } else if (p.kind === "audio") {
              await enviarAudio(l.telefone, p.url);
              log(`🎙️ Áudio enviado (pedido ${l.pedido_id})`);
            }
          } catch (e) {
            log(`⚠️ Falha numa parte (pedido ${l.pedido_id}): ${e.message}`);
          }
          await sleep(2000); // pequena pausa entre as partes
        }
      } else {
        const { partes, audioUrl } = m;
        for (const [i, texto] of partes.entries()) {
          const id = await enviar(l.telefone, texto);
          if (i === 0) msgId = id;
          await sleep(2000); // pequena pausa entre as partes
        }
        if (audioUrl) {
          try {
            await enviarAudio(l.telefone, audioUrl);
            log(`🎙️ Áudio enviado (pedido ${l.pedido_id})`);
          } catch (e) {
            log(`⚠️ Falha no áudio (pedido ${l.pedido_id}): ${e.message}`);
          }
          await sleep(2000);
        }
      }
      await atualizar(l.id, { status: "enviado", whatsapp_msg_id: msgId, erro: null, sessao: WAAKG_SESSION_ID });
      log(`✅ Enviado (pedido ${l.pedido_id} via sessão ${WAAKG_SESSION_ID})`);
    } catch (e) {
      const esgotou = l.tentativas >= Number(MAX_TENTATIVAS);
      await atualizar(l.id, { status: esgotou ? "erro" : "pendente", erro: String(e.message).slice(0, 300) });
      log(`❌ Falha (pedido ${l.pedido_id}): ${e.message}`);
    }
    await sleep(rand(Number(INTERVALO_MIN_S), Number(INTERVALO_MAX_S)) * 1000);
  }
}

log("Worker iniciado (ciclo a cada 10s).");
while (true) {
  try { await ciclo(); } catch (e) { log("Erro no ciclo:", e.message); }
  await sleep(10_000);
}
