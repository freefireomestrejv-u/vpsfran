// Worker: busca lembretes vencidos no Supabase e envia pelo WA-AKG (localhost)
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  WAAKG_URL = "http://localhost:3000",
  WAAKG_API_KEY,
  WAAKG_SESSION_ID,
  NOME_MARCA = "Equipe Renew Veins",
  MAX_POR_DIA = "40",        // limite de envios nas últimas 24h (protege o chip)
  HORA_INICIO = "8",         // não envia antes dessas horas (horário de Brasília)
  HORA_FIM = "21",           // nem depois
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

function horaBrasilia() {
  return Number(new Intl.DateTimeFormat("pt-BR", { hour: "numeric", hour12: false, timeZone: "America/Sao_Paulo" }).format(new Date()));
}

// Templates editáveis na aba Recuperação (cache de 60s; cai para o padrão se falhar)
let tplCache = { quando: 0, dados: {} };
async function carregarTemplates() {
  if (Date.now() - tplCache.quando < 60_000) return tplCache.dados;
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/templates_recuperacao?select=etapa,texto,audio_url`, {
      headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
    });
    const rows = await r.json();
    const dados = {};
    for (const t of rows || []) dados[t.etapa] = t;
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
    .replaceAll("{link}", l.link_retomada || "")
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
    else if (l.link_retomada) corpo.push(`Você pode finalizar por aqui: ${l.link_retomada}`);
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

async function ciclo() {
  // Linhas travadas em "enviando" há mais de 10 min (worker caiu no meio): voltam para a fila
  await supabase.from("lembretes").update({ status: "pendente" })
    .eq("status", "enviando").lt("atualizado_em", new Date(Date.now() - 10 * 60_000).toISOString());

  const h = horaBrasilia();
  if (h < Number(HORA_INICIO) || h >= Number(HORA_FIM)) return;
  if (!(await sessaoConectada())) { log("⚠️  Sessão do WhatsApp NÃO está conectada. Nada enviado."); return; }

  const { count } = await supabase.from("lembretes").select("id", { count: "exact", head: true })
    .eq("status", "enviado").gte("atualizado_em", new Date(Date.now() - 24 * 3600_000).toISOString());
  const restante = Number(MAX_POR_DIA) - (count ?? 0);
  if (restante <= 0) { log("Limite diário atingido."); return; }

  const { data: lote, error } = await supabase.rpc("reservar_lembretes", { limite: Math.min(5, restante) });
  if (error) { log("Erro ao reservar:", error.message); return; }

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
      await atualizar(l.id, { status: "enviado", whatsapp_msg_id: msgId, erro: null });
      log(`✅ Enviado (pedido ${l.pedido_id})`);
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
