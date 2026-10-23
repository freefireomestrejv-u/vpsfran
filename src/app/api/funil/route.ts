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
const SEL_EVENTO_SID = encodeURIComponent("evento:payload->>event_name,sid:payload->>sale_id");
const COL_EVENTO = encodeURIComponent("payload->>event_name");
const COL_OFER = encodeURIComponent("payload->offer->>id");

// ---- Ofertas ativas na página (IDs extraídos dos links de checkout B4Y) ----
// Tudo que NÃO está aqui é ignorado no funil (ex.: promos antigas, outros produtos).
const OFERTAS_ATIVAS: Record<string, string> = {
    "pjPiea8WOx": "Renew Veins - 5 Potes",
    "i_UAvMDaLm": "Renew Veins - 3 Potes",
    "0vS1l3U-wA": "Renew Veins - 1 Pote",
    "XfTiRiO9yk": "Renew Veins - 10 Potes",
};
const IDS_ATIVOS = Object.keys(OFERTAS_ATIVAS).join(",");

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

        // 1) Contagem de todos os eventos no período
        const eventosRows = await listarEventos(cfg, `select=${SEL_EVENTO}${range}`);
        const eventos: Record<string, number> = {};
        for (const r of eventosRows) {
            const nome = r.evento || "(sem nome)";
            eventos[nome] = (eventos[nome] || 0) + 1;
        }

        // 2) Vendas únicas (sale_id) para estimar etapas do funil — só das 4 ofertas ativas
        const cobrancasRows = await listarEventos(
            cfg,
            `select=${SEL_EVENTO_SID}&${COL_EVENTO}=in.("generated-pix","generated-billet","approved-payment")&${COL_OFER}=in.(${IDS_ATIVOS})${range}`
        );
        const sidsCobranca = new Set<string>();
        const sidsPagos = new Set<string>();
        for (const r of cobrancasRows) {
            if (!r.sid) continue;
            sidsCobranca.add(String(r.sid));
            if (r.evento === "approved-payment") sidsPagos.add(String(r.sid));
        }

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
            return Boolean(OFERTAS_ATIVAS[String(p.offer?.id || "")]);
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
            checkoutsIniciados: (eventos["abandoned-cart"] || 0) + sidsCobranca.size,
            abandonados: eventos["abandoned-cart"] || 0,
            cobrancas: sidsCobranca.size,
            pagos,
            faturamento,
            recuperadas,
            ticket: pagos > 0 ? faturamento / pagos : 0,
            porMetodo,
            porProduto,
            recuperacao,
            recusados: eventos["refused-payment"] || 0,
            pixExpirados: eventos["expired-pix"] || 0,
            reembolsos: eventos["refund"] || 0,
            chargebacks: eventos["chargeback"] || 0,
            ultimasVendas: ultimasVendas.slice(0, 10),
        };

        return NextResponse.json({ status: true, message: "Funil retrieved", data });
    } catch (error: any) {
        return NextResponse.json({ status: false, message: error?.message || "Failed", error: error?.message || "Failed" }, { status: 500 });
    }
}
