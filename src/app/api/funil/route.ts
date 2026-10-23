import { NextResponse, NextRequest } from "next/server";
import { getAuthenticatedUser, isAdmin } from "@/lib/api-auth";

function sb() {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return null;
    return { url: url.replace(/\/$/, ""), key };
}

// Início do dia (Brasília, UTC-3 fixo) convertido para UTC-ISO, N dias atrás.
function startOfBrDayUTC(daysAgo: number): string {
    const d = new Date(Date.now() - 3 * 3600_000);
    d.setUTCHours(0, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() - daysAgo);
    return new Date(d.getTime() + 3 * 3600_000).toISOString();
}

const SEL_EVENTO = encodeURIComponent("evento:payload->>event_name");
const COL_EVENTO = encodeURIComponent("payload->>event_name");
const COL_OFER = encodeURIComponent("payload->offer->>id");
// Dados mínimos de cobrança p/ saber a origem (produtor × afiliado): evento, venda e URL/etiqueta
const SEL_EVENTO_SID = encodeURIComponent(
    "evento:payload->>event_name,sid:payload->>sale_id,curl:payload->checkout->>url,cku:payload->checkout->>url_3_steps,sck:payload->tracking_parameters->>sck,utm:payload->tracking_parameters->>utm_source"
);

// ---- Ofertas ativas na página (IDs extraídos dos links de checkout B4Y) ----
// Tudo que NÃO está aqui é ignorado no funil (ex.: promos antigas, outros produtos).
const OFERTAS_ATIVAS: Record<string, string> = {
    "pjPiea8WOx": "Renew Veins - 5 Potes",
    "i_UAvMDaLm": "Renew Veins - 3 Potes",
    "0vS1l3U-wA": "Renew Veins - 1 Pote",
    "XfTiRiO9yk": "Renew Veins - 10 Potes",
};
const IDS_ATIVOS = Object.keys(OFERTAS_ATIVAS).join(",");

// ---- Filtro de tráfego: só o link do PRODUTOR (vocÊ) ---
// A B4Y grava quem trouxe a venda no código de afiliado (?b4f=XXX da URL).
// Seus links (os da página) são pelados, sem ?b4f=. Todo evento com código
// de afiliado é tráfego de referrer e NÃO entra no funil (a B4Y readOnly).
// Exceções que são sempre suas:
//   - vendas vindas do lembrete de recuperação (utm_source=recuperacao)
//   - qualquer sessão etiquetada pela nossa automação (sck preenchido)
function eProprio(checkoutUrl: string, utmSource?: string, sck?: string): boolean {
    const utm = String(utmSource || "").toLowerCase();
    if (utm === "recuperacao") return true;
    if (String(sck || "").trim()) return true;
    const m = String(checkoutUrl || "").match(/b4f=([A-Za-z0-9_-]+)/);
    return !m; // sem código de afiliado = link do produtor
}
function eProprioPayload(p: any): boolean {
    const tp = p.tracking_parameters || {};
    const url = String(p.checkout?.url || p.checkout?.url_3_steps || "");
    return eProprio(url, tp.utm_source, tp.sck);
}

// Busca paginada (PostgREST limita a 1000 registros por página).
async function listarEventos(cfg: { url: string; key: string }, query: string, maxPaginas = 4) {
    const out: any[] = [];
    for (let offset = 0; offset < maxPaginas * 1000; offset += 1000) {
        const sep = query.includes("?") ? "&" : "?";
        const res = await fetch(`${cfg.url}/rest/v1/webhook_eventos${sep}${query}`, {
            headers: { apikey: cfg.key, Authorization: `Bearer ${cfg.key}` },
        });
        if (!res.ok) throw new Error(`Supabase: HTTP ${res.status}`);
        const page = await res.json();
        if (Array.isArray(page)) out.push(...page);
        if (!Array.isArray(page) || page.length < 1000) break;
    }
    return out;
}

// Valor pago da venda: soma da(s) charge(s) com status "paid" (inclui order bumps).
function valorPago(charges: any): number {
    const lista = Array.isArray(charges) ? charges : [];
    const pagos = lista.filter((c: any) => c && c.status === "paid" && Number(c.amount) > 0);
    if (pagos.length) return pagos.reduce((s: number, c: any) => s + Number(c.amount), 0);
    return 0;
}

interface ItemProduto { nome: string; count: number; receita: number }

// GET /api/funil?periodo=hoje|7d|30d|total
// Funil: Visitas -> Checkout iniciado (estimado) -> Cobrança gerada -> Pago
export async function GET(request: NextRequest) {
    try {
        const user = await getAuthenticatedUser(request);
        if (!user || !isAdmin(user.role)) {
            return NextResponse.json({ status: false, message: "Forbidden", error: "Forbidden" }, { status: 403 });
        }
        const cfg = sb();
        if (!cfg) {
            return NextResponse.json({ status: false, message: "Supabase não configurado", error: "Supabase não configurado" }, { status: 500 });
        }

        const sp = new URL(request.url).searchParams;
        const periodo = (sp.get("periodo") || "7d").toLowerCase();
        const diasMap: Record<string, number> = { hoje: 0, "7d": 7, "30d": 30, total: -1 };
        const dias = diasMap[periodo] ?? 7;
        const range = dias >= 0 ? `&recebido_em=gte.${startOfBrDayUTC(dias)}` : "";
        const C = cfg; // captura não-nula p/ closures abaixo

        // 1) Contagens de eventos — com payload, para filtrar por OFERTA ATIVA + LINK DO PRODUTOR
        //    (a contagem global antiga somava tráfego de afiliados, que não é função do robô)
        async function payloadsFiltrados(nomeEvento: string): Promise<any[]> {
            const out: any[] = [];
            let from = 0;
            while (true) {
                const resEv = await fetch(
                    `${C.url}/rest/v1/webhook_eventos?select=payload&${COL_EVENTO}=eq.${encodeURIComponent(nomeEvento)}${range}&order=recebido_em.desc&limit=1000&offset=${from}`,
                    { headers: { apikey: C.key, Authorization: `Bearer ${C.key}` } }
                );
                if (!resEv.ok) throw new Error(`Supabase: HTTP ${resEv.status}`);
                const page: any[] = await resEv.json();
                if (!Array.isArray(page) || page.length === 0) break;
                for (const r of page) {
                    const p = r.payload || {};
                    if (!OFERTAS_ATIVAS[String(p.offer?.id || "")]) continue;
                    if (!eProprioPayload(p)) continue;
                    out.push(p);
                }
                if (page.length < 1000) break;
                from += 1000;
            }
            return out;
        }
        const [recusadosP, pixExpiradosP, reembolsosP, chargebacksP] = await Promise.all([
            payloadsFiltrados("refused-payment"),
            payloadsFiltrados("expired-pix"),
            payloadsFiltrados("refund"),
            payloadsFiltrados("chargeback"),
        ]);

        // 2) Vendas únicas (sale_id) para estimar etapas do funil — só das 4 ofertas ativas
        const cobrancasRows = await listarEventos(
            cfg,
            `select=${SEL_EVENTO_SID}&${COL_EVENTO}=in.("generated-pix","generated-billet","approved-payment")&${COL_OFER}=in.(${IDS_ATIVOS})${range}`
        );
        const sidsCobranca = new Set<string>();
        const sidsPagos = new Set<string>();
        for (const r of cobrancasRows) {
            if (!r.sid) continue;
            if (!eProprio(r.curl, r.utm, r.sck) && !eProprio(r.cku, r.utm, r.sck)) continue; // só o link do produtor
            sidsCobranca.add(String(r.sid));
            if (r.evento === "approved-payment") sidsPagos.add(String(r.sid));
        }

        // 2b) Payload dos abandoned-cart do período (só as 4 ofertas ativas):
        //     serve para (a) contar PESSOAS (e não eventos — a B4Y dispara 1 evento
        //     por sessão abandonada, a mesma pessoa pode gerar vários) e
        //     (b) saber DE ONDE veio cada checkout (código do afiliado no link, lembrete, direto).
        const abandonosPayload: any[] = [];
        {
            let from = 0;
            while (true) {
                const resAb = await fetch(
                    `${cfg.url}/rest/v1/webhook_eventos?select=payload&${COL_EVENTO}=eq.abandoned-cart${range}&order=recebido_em.desc&limit=1000&offset=${from}`,
                    { headers: { apikey: cfg.key, Authorization: `Bearer ${cfg.key}` } }
                );
                if (!resAb.ok) throw new Error(`Supabase: HTTP ${resAb.status}`);
                const page: any[] = await resAb.json();
                if (!Array.isArray(page) || page.length === 0) break;
                for (const r of page) {
                    const p = r.payload || {};
                    if (!OFERTAS_ATIVAS[String(p.offer?.id || "")]) continue;
                    if (!eProprioPayload(p)) continue; // só tráfego do produtor
                    abandonosPayload.push(r);
                }
                if (page.length < 1000) break;
                from += 1000;
            }
        }

        // Cliente único: mesmo e-mail (ou WhatsApp) = 1 pessoa, mesmo que tenha
        // aberto o checkout 7 vezes (o evento dispara por sessão).
        function chaveCliente(p: any): string {
            return String(p.customer?.email || "").toLowerCase() || String(p.customer?.whatsapp || "").trim();
        }        const clientesAbandono = new Set<string>();
        interface Origem { rotulo: string; clientes: number }
        const origensMap = new Map<string, Set<string>>();
        for (const r of abandonosPayload) {
            const p = r.payload || {};
            const chave = chaveCliente(p) || "(sem identificação)";
            clientesAbandono.add(chave);
            const tp = p.tracking_parameters || {};
            let rotulo: string;
            if (String(tp.utm_source || "").toLowerCase() === "recuperacao") rotulo = "Lembrete WhatsApp (recuperação)";
            else if (String(tp.sck || "").trim()) rotulo = "Sua página (etiquetada)";
            else rotulo = "Sua página (link direto)";
            if (!origensMap.has(rotulo)) origensMap.set(rotulo, new Set());
            origensMap.get(rotulo)!.add(chave); // Set cuida da repetição da mesma pessoa
        }
        const origens: Origem[] = [...origensMap.entries()]
            .map(([rotulo, set]) => ({ rotulo, clientes: set.size }))
            .sort((a, b) => b.clientes - a.clientes);
        // Top 5 + resto consolidado
        const origensLista: Origem[] = origens.length > 6
            ? [...origens.slice(0, 5), { rotulo: "Outros vínculos", clientes: origens.slice(5).reduce((s, o) => s + o.clientes, 0) }]
            : origens;

        // 3) Pagamentos aprovados (payload completo: valor, método, produto, cliente, UTM)
        //    filtrados pelas 4 ofertas ativas da página
        const aprovadosRes = await fetch(
            `${cfg.url}/rest/v1/webhook_eventos?select=payload&${COL_EVENTO}=eq.approved-payment&${COL_OFER}=in.(${IDS_ATIVOS})${range}&order=recebido_em.desc&limit=500`,
            { headers: { apikey: cfg.key, Authorization: `Bearer ${cfg.key}` } }
        );
        if (!aprovadosRes.ok) throw new Error(`Supabase: HTTP ${aprovadosRes.status}`);
        const aprovadosTodos: any[] = await aprovadosRes.json();
        const aprovadosRows = aprovadosTodos.filter((r: any) => {
            const p = r.payload || {};
            if (!OFERTAS_ATIVAS[String(p.offer?.id || "")]) return false;
            return eProprioPayload(p); // só vendas vindas do link do produtor (ou etiqueta do lembrete)
        });

        // Recuperação (acumuladores: definidos antes do loop de vendas)
        let recPorEtiqueta = 0;        // contagem por etiqueta vinda do webhook
        let recReceitaEtiqueta = 0;    // dinheiro pago nessas vendas

        let faturamento = 0;
        let recuperadas = 0;
        const porMetodo: Record<string, { count: number; receita: number }> = {};
        const porProdutoMap = new Map<string, ItemProduto>();
        const ultimasVendas: any[] = [];

        for (const r of aprovadosRows) {
            const p = r.payload || {};
            const oferta = p.offer || {};
            const valor = valorPago(p.charges) || Number(oferta.original_price) || 0;
            const metodo = String(p.payment_method || "outro");
            const nomeOferta = OFERTAS_ATIVAS[String(oferta.id || "")]
                || String(oferta.name || p.product?.name || "—").trim();
            // A compra veio de lembrete? O worker etiqueta o link com utm_source=recuperacao
            // e a B4Y devolve a etiqueta no tracking_parameters do webhook.
            const tp = p.tracking_parameters || {};
            const recuperada =
                String(tp.utm_source || "").toLowerCase() === "recuperacao"
                || String(tp.sck || "").toLowerCase().includes("recuperacao");

            faturamento += valor;
            if (recuperada) { recuperadas += 1; recPorEtiqueta += 1; recReceitaEtiqueta += valor; }

            if (!porMetodo[metodo]) porMetodo[metodo] = { count: 0, receita: 0 };
            porMetodo[metodo].count += 1;
            porMetodo[metodo].receita += valor;

            const item = porProdutoMap.get(nomeOferta) || { nome: nomeOferta, count: 0, receita: 0 };
            item.count += 1;
            item.receita += valor;
            porProdutoMap.set(nomeOferta, item);

            const cliente = p.customer || {};
            ultimasVendas.push({
                nome: cliente.full_name || "—",
                email: cliente.email || null,
                oferta: nomeOferta,
                metodo,
                valor,
                pago_em: p.paid_at || p.created_at || null,
                recuperada,
            });
        }

        ultimasVendas.sort((a, b) => String(b.pago_em || "").localeCompare(String(a.pago_em || "")));
        // As 4 ofertas ativas sempre aparecem (zeradas se não venderam no período)
        const porProduto = Object.entries(OFERTAS_ATIVAS)
            .map(([id, nome]) => {
                const item = porProdutoMap.get(nome);
                return { nome, count: item?.count || 0, receita: item?.receita || 0 };
            })
            .sort((a, b) => b.receita - a.receita);

        // 4) Recuperação de carrinho — lado "robô":
        //    a) lembretes de abandono ENVIADOS no período (contagem + valor em jogo)
        //    b) quantos compraram depois: 1º pela etiqueta do link do lembrete (utm_source=recuperacao);
        //       como histórico anterior à etiqueta não tem como saber a origem, usa os lembretes
        //       marcados como "pago" como aproximação (o maior dos dois, nunca soma os dois).
        let recPorPago = 0;            // aproximação histórica (lembrete status=pago)
        let recReceitaPago = 0;
        const recEnvios = { cont: 0, valor: 0 };
        try {
            const rangeLem = dias >= 0 ? `&criado_em=gte.${startOfBrDayUTC(dias)}` : "";
            const headersLem = { apikey: cfg.key, Authorization: `Bearer ${cfg.key}` };
            const resLem = await fetch(
                `${cfg.url}/rest/v1/lembretes?select=valor&pedido_id=like.abandono*&status=eq.enviado${rangeLem}&limit=5000`,
                { headers: headersLem }
            );
            if (resLem.ok) {
                for (const l of (await resLem.json()) as any[]) {
                    recEnvios.cont += 1;
                    recEnvios.valor += Number(l.valor) || 0;
                }
            }
            const resPago = await fetch(
                `${cfg.url}/rest/v1/lembretes?select=valor&pedido_id=like.abandono*&status=eq.pago${rangeLem}&limit=5000`,
                { headers: headersLem }
            );
            if (resPago.ok) {
                for (const l of (await resPago.json()) as any[]) {
                    recPorPago += 1;
                    recReceitaPago += Number(l.valor) || 0;
                }
            }
        } catch {
            // tabela de lembretes indisponível → card fica zerado, resto do funil segue
        }
        const recVendas = Math.max(recPorEtiqueta, recPorPago);
        const recReceita = recPorEtiqueta >= recPorPago ? recReceitaEtiqueta : recReceitaPago;
        const recuperacao = {
            enviados: recEnvios.cont,
            valorEmJogo: recEnvios.valor,
            recuperadas: recVendas,
            receitaRecuperada: recReceita,
        };

        // 5) Visitas — a tabela pode ainda não existir (SQL não rodou)
        let visitas: number | null = null;
        try {
            const resVisitas = await fetch(`${cfg.url}/rest/v1/visitas?select=id${range}`, {
                headers: {
                    apikey: cfg.key,
                    Authorization: `Bearer ${cfg.key}`,
                    Prefer: "count=exact",
                },
            });
            if (resVisitas.ok) {
                const cr = resVisitas.headers.get("content-range");
                const total = cr ? cr.split("/")[1] : "0";
                if (total !== "*") visitas = Number(total) || 0;
            }
        } catch {
            // tabela ausente ou indisponível: painel mostra dica de instalação
        }

        const pagos = sidsPagos.size || aprovadosRows.length;
        const data = {
            periodo,
            inicio: dias >= 0 ? startOfBrDayUTC(dias) : null,
            visitas,
            // Pessoas (não eventos): cada pessoa abrindo 5× o checkout continua sendo 1 checkout aberto.
            // As cobranças (pix/boleto) entram como entry adicional porque geram outra sessão na B4Y.
            checkoutsIniciados: clientesAbandono.size + sidsCobranca.size,
            abandonados: clientesAbandono.size,
            origens: origensLista,
            cobrancas: sidsCobranca.size,
            pagos,
            faturamento,
            recuperadas,
            ticket: pagos > 0 ? faturamento / pagos : 0,
            porMetodo,
            porProduto,
            recuperacao,
            recusados: recusadosP.length,
            pixExpirados: pixExpiradosP.length,
            reembolsos: reembolsosP.length,
            chargebacks: chargebacksP.length,
            ultimasVendas: ultimasVendas.slice(0, 10),
        };

        return NextResponse.json({ status: true, message: "Funil retrieved", data });
    } catch (error: any) {
        return NextResponse.json({ status: false, message: error?.message || "Failed", error: error?.message || "Failed" }, { status: 500 });
    }
}
