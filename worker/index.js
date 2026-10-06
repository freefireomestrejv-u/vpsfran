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

async function sessaoConectada() {
  try {
    const r = await fetch(`${WAAKG_URL}/api/sessions/${WAAKG_SESSION_ID}`, { headers: { "X-API-Key": WAAKG_API_KEY } });
    const j = await r.json();
    return j?.data?.status === "CONNECTED";
  } catch {
    return false;
  }
}

function montarMensagem(l) {
  const primeiro = (l.nome ?? "").trim().split(" ")[0] || "tudo bem";
  const valor = l.valor ? ` (R$ ${Number(l.valor).toFixed(2).replace(".", ",")})` : "";
  const produto = l.produto ? ` ${l.produto}` : "";
  // 1ª mensagem: boas-vindas na hora em que o Pix é gerado
  if (String(l.pedido_id).endsWith("#boasvindas")) {
    return [
      `Oi, ${primeiro}! Aqui é da ${NOME_MARCA}.`,
      `Vi que você gerou o QR Code${produto}${valor}. Fico muito feliz que confiou no nosso trabalho!`,
      "Qualquer dúvida, estou por aqui à disposição. Assim que o pagamento for confirmado, te aviso.",
    ].join("\n\n");
  }
  // 2ª mensagem: cobrança após 15 min sem pagamento (texto + código em seguida)
  const corpo = [`Oi, ${primeiro}! Aqui é da ${NOME_MARCA}.`, `Vi que você gerou o Pix${produto ? ` de${produto}` : ""}${valor}, mas o pagamento ainda não caiu.`];
  if (l.codigo_pix) corpo.push("Se ainda quiser, segue o Pix Copia e Cola:");
  else if (l.link_retomada) corpo.push(`Você pode finalizar por aqui: ${l.link_retomada}`);
  corpo.push("Se já pagou, pode ignorar esta mensagem. Para não receber mais avisos, responda SAIR.");
  if (l.codigo_pix) return [corpo.join("\n\n"), l.codigo_pix];
  return corpo.join("\n\n");
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

      const textos = montarMensagem(l);
      const partes = Array.isArray(textos) ? textos : [textos];
      let msgId = null;
      for (const [i, texto] of partes.entries()) {
        const id = await enviar(l.telefone, texto);
        if (i === 0) msgId = id;
        if (i < partes.length - 1) await sleep(2000); // pequena pausa entre as partes
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
