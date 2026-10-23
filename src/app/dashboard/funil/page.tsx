"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

interface Venda {
    nome: string;
    email: string | null;
    oferta: string;
    metodo: string;
    valor: number;
    pago_em: string | null;
    recuperada?: boolean;
}

interface Dados {
    periodo: string;
    visitas: number | null;
    checkoutsIniciados: number;
    abandonados: number;
    cobrancas: number;
    pagos: number;
    faturamento: number;
    recuperadas: number;
    ticket: number;
    recuperacao: {
        enviados: number;
        valorEmJogo: number;
        recuperadas: number;
        receitaRecuperada: number;
    };
    origens: { rotulo: string; clientes: number }[];
    porMetodo: Record<string, { count: number; receita: number }>;
    porProduto: { nome: string; count: number; receita: number }[];
    recusados: number;
    pixExpirados: number;
    reembolsos: number;
    chargebacks: number;
    ultimasVendas: Venda[];
}

const PERIODOS: Record<string, string> = {
    hoje: "Hoje",
    "7d": "7 dias",
    "30d": "30 dias",
    total: "Total",
};

const METODO_NOME: Record<string, string> = {
    pix: "Pix",
    card: "Cartão",
    billet: "Boleto",
};

const moeda = (v: number) =>
    new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v || 0);

const numero = (v: number | null) => (v == null ? "—" : new Intl.NumberFormat("pt-BR").format(v || 0));

function quando(iso: string | null): string {
    if (!iso) return "—";
    const d = new Date(iso);
    return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function pct(rel: number): string {
    if (!isFinite(rel) || rel <= 0) return "0%";
    if (rel < 0.005) return "<1%";
    return `${Math.round(rel * 100)}%`;
}

function tickFmt(v: number): string {
    if (v >= 1000) {
        const k = v / 1000;
        return `${k.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}k`;
    }
    return String(v);
}

function ticks(maxRaw: number): number[] {
    const max = maxRaw || 1;
    for (const passo of [500, 250, 100, 50, 20, 10, 5, 2, 1]) {
        const topo = Math.ceil(max / passo) * passo;
        const n = topo / passo;
        if (n >= 3 && n <= 5) return Array.from({ length: n + 1 }, (_, i) => topo - i * passo);
    }
    return [Math.ceil(max / 2) * 2, Math.ceil(max / 2), 0];
}

export default function FunilPage() {
    const [dados, setDados] = useState<Dados | null>(null);
    const [carregando, setCarregando] = useState(true);
    const [periodo, setPeriodo] = useState("7d");

    // Estado local de UI (visual) — não toca na API/dados
    const [menuAberto, setMenuAberto] = useState(false);
    const [sel, setSel] = useState<number | null>(null);
    const [busca, setBusca] = useState("");
    const [modal, setModal] = useState<"sales" | "detail" | null>(null);
    const [detId, setDetId] = useState<number | null>(null);
    const [toastDados, setToastDados] = useState(false);

    const carregar = useCallback(async (p: string) => {
        setCarregando(true);
        try {
            const res = await fetch(`/api/funil?periodo=${p}`);
            const json = await res.json();
            if (!json.status) throw new Error(json.message || "Resposta inválida");
            setDados(json.data);
            setSel(null);
            setToastDados(true);
            setTimeout(() => setToastDados(false), 2500);
        } catch (e: any) {
            setDados(null);
            toast.error("Não foi possível carregar o funil", { description: e?.message });
        } finally {
            setCarregando(false);
        }
    }, []);

    useEffect(() => {
        carregar(periodo);
    }, [periodo, carregar]);

    const d = dados;

    // ---- Métricas: Visitas / Checkouts / Compras / Abandono ---------------
    const visitasVal = d?.visitas ?? null;
    const maxEtapa = Math.max(visitasVal ?? 0, d?.checkoutsIniciados ?? 0, d?.pagos ?? 0, d?.abandonados ?? 0, 1);

    // "de cada 100 que abriram o checkout, N ..." — leitura em frase, sem jargão
    const de100 = (parte: number, todo: number): string | null => {
        if (todo <= 0 || parte <= 0) return null;
        const n = Math.round((parte / todo) * 100);
        return n < 1 ? "menos de 1" : String(n);
    };
    const nenhum = "nenhum registro no período";

    const etapas = [
        {
            label: "Visitas",
            name: "Visitas na página",
            val: visitasVal,
            frase: visitasVal == null
                ? "Sem rastreamento instalado na landing."
                : `${numero(visitasVal)} ${visitasVal === 1 ? "visita" : "visitas"} na página da loja.`,
            detalhe: visitasVal == null
                ? "Cole o snippet de rastreamento na landing para medir essa etapa."
                : (() => {
                    const n = de100(d?.checkoutsIniciados ?? 0, visitasVal);
                    return n ? `De cada 100 visitas, ${n} abriram o checkout.` : nenhum;
                })(),
        },
        {
            label: "Checkouts",
            name: "Checkouts abertos",
            val: d?.checkoutsIniciados ?? 0,
            frase: `${numero(d?.checkoutsIniciados ?? 0)} ${((d?.checkoutsIniciados ?? 0) === 1) ? "pessoa abriu" : "pessoas abriram"} o checkout.`,
            detalhe: "contagem estimada: soma de quem abandonou com quem gerou cobrança.",
        },
        {
            label: "Compras",
            name: "Compras finalizadas",
            val: d?.pagos ?? 0,
            frase: `${numero(d?.pagos ?? 0)} ${((d?.pagos ?? 0) === 1) ? "pessoa finalizou" : "pessoas finalizaram"} a compra.`,
            detalhe: (() => {
                const n = de100(d?.pagos ?? 0, d?.checkoutsIniciados ?? 0);
                return n ? `De cada 100 que abriram o checkout, ${n} compraram.` : nenhum;
            })(),
        },
        {
            label: "Abandonos",
            name: "Abandono de carrinho",
            val: d?.abandonados ?? 0,
            frase: `${numero(d?.abandonados ?? 0)} ${((d?.abandonados ?? 0) === 1) ? "pessoa abriu e não" : "pessoas abriram e não"} finalizaram.`,
            detalhe: (() => {
                const n = de100(d?.abandonados ?? 0, d?.checkoutsIniciados ?? 0);
                return n ? `De cada 100 que abriram o checkout, ${n} saíram sem pagar.` : nenhum;
            })(),
        },
    ];

    const eixo = ticks(maxEtapa);

    // ---- Gauge: taxa de aprovação ---------------------------------------
    const taxa = (d?.cobrancas ?? 0) > 0 ? Math.round((d!.pagos / d!.cobrancas) * 100) : null;
    const paresVerde = taxa != null ? Math.floor(taxa / 5) : 0;
    const strokeVerde = taxa != null && taxa > 0 ? `${"4.2 0.8 ".repeat(paresVerde).trim()} 0 100` : "0 100";

    // ---- Receita por método ----------------------------------------------
    const metodos = Object.entries(d?.porMetodo || {})
        .map(([k, v]) => ({ k, nome: METODO_NOME[k] || "Outros", ...v }))
        .sort((a, b) => b.receita - a.receita);
    const maxReceita = Math.max(...metodos.map((m) => m.receita), 1);

    // ---- Recuperação de carrinho -------------------------------------------
    const realRecuperacao = dados?.recuperacao ?? { enviados: 0, recuperadas: 0, receitaRecuperada: 0, valorEmJogo: 0 };
    const rec = realRecuperacao;
    const recTaxa = rec.enviados > 0 ? rec.recuperadas / Math.max(rec.enviados, 1) : 0;
    const recBarra = Math.max(recTaxa * 100, rec.recuperadas > 0 ? 1.5 : 0);

    // ---- Últimas vendas + busca ------------------------------------------
    const vendaSel = detId != null && d ? d.ultimasVendas[detId] : null;
    const chir = (busca || "").trim().toLowerCase();
    const vendasFiltradas = (d?.ultimasVendas || []).filter((v) => {
        if (!chir) return true;
        return `${v.nome} ${v.email || ""} ${v.oferta} ${METODO_NOME[v.metodo] || v.metodo}`
            .toLowerCase()
            .includes(chir);
    });
    const vendasVisiveis = vendasFiltradas.slice(0, 6);
    const semVendas = chir.length > 0 && vendasFiltradas.length === 0;

    return (
        <div
            className="fnl"
            style={{
                maxWidth: 1280,
                margin: "0 auto",
                padding: "32px 24px 56px",
                display: "flex",
                flexDirection: "column",
                gap: 16,
            }}
        >
            <style jsx global>{`
                .fnl {
                    font-family: inherit;
                    color: #0b1b2b;
                }
                .fnl b {
                    font-weight: 700;
                }
                .fnl h1 {
                    margin: 0;
                    font-size: 32px;
                    font-weight: 600;
                    letter-spacing: -.02em;
                }
                .fnl h2 {
                    margin: 0;
                    font-size: 22px;
                    font-weight: 600;
                    letter-spacing: -.01em;
                }
                .fnl .mu {
                    color: #566575;
                    font-size: 13px;
                }
                .fnl .nw {
                    white-space: nowrap;
                }
                .fnl .tx {
                    color: #0b1b2b;
                }
                .fnl .ell {
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                    display: block;
                    font-size: 14px;
                    min-width: 0;
                }
                .fnl .card {
                    background: #fff;
                    border-radius: 28px;
                    padding: 28px;
                    min-width: 0;
                    display: flex;
                    flex-direction: column;
                    border: 1px solid rgba(11, 27, 43, .06);
                }
                .fnl .pillbtn {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    min-height: 48px;
                    padding: 0 20px;
                    border: 0;
                    border-radius: 99px;
                    background: #fff;
                    font-size: 14px;
                    font-weight: 500;
                    cursor: pointer;
                }
                .fnl .pillbtn.main {
                    background: linear-gradient(135deg, #ff8fb7, #d6336c);
                    color: #fff;
                    font-weight: 600;
                }
                .fnl .pillbtn main:disabled {
                    opacity: .7;
                    cursor: default;
                }
                .fnl .link {
                    border: 0;
                    background: #fff1f6;
                    color: #b3224f;
                    font-size: 13px;
                    font-weight: 600;
                    min-height: 44px;
                    padding: 0 18px;
                    border-radius: 99px;
                    cursor: pointer;
                }
                .fnl .spin {
                    animation: fnlsp .8s linear infinite;
                }
                @keyframes fnlsp {
                    to {
                        transform: rotate(360deg);
                    }
                }
                .fnl .menu {
                    position: absolute;
                    right: 0;
                    top: 56px;
                    background: #fff;
                    border-radius: 20px;
                    padding: 8px;
                    box-shadow: 0 12px 32px rgba(11, 27, 43, .14);
                    min-width: 170px;
                    z-index: 20;
                    display: flex;
                    flex-direction: column;
                }
                .fnl .mi {
                    border: 0;
                    background: transparent;
                    text-align: left;
                    font-size: 14px;
                    font-weight: 500;
                    padding: 0 14px;
                    min-height: 44px;
                    border-radius: 12px;
                    cursor: pointer;
                }
                .fnl .mi:hover {
                    background: #f3fafc;
                }
                .fnl .mi.on {
                    background: #ffe0ec;
                    color: #b3224f;
                    font-weight: 600;
                }
                .fnl .catch {
                    position: fixed;
                    inset: 0;
                    background: transparent;
                    border: 0;
                    z-index: 10;
                    cursor: default;
                }
                .fnl .kpis {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
                    gap: 16px;
                }
                .fnl .kpi {
                    background: #fff;
                    border-radius: 24px;
                    padding: 22px;
                    display: flex;
                    flex-direction: column;
                    gap: 12px;
                    border: 1px solid rgba(11, 27, 43, .06);
                }
                .fnl .kh {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }
                .fnl .kl {
                    font-size: 14px;
                    color: #566575;
                }
                .fnl .ic {
                    width: 48px;
                    height: 48px;
                    border-radius: 50%;
                    display: grid;
                    place-items: center;
                    background: #e3f4ec;
                    color: #087f55;
                    flex: none;
                }
                .fnl .kpi.dk .ic {
                    background: #0b1b2b;
                    color: #fff;
                }
                .fnl .kpi.hi {
                    background: linear-gradient(150deg, #4fa486, #087f55);
                    color: #fff;
                }
                .fnl .kpi.hi .kl,
                .fnl .kpi.hi .kf {
                    color: #fff;
                }
                .fnl .kpi.hi .ic {
                    background: #fff;
                    color: #087f55;
                }
                .fnl .kpi.hi .kf {
                    border-top-color: rgba(255, 255, 255, .3);
                }
                .fnl .kv {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    flex-wrap: wrap;
                }
                .fnl .v {
                    font-size: 34px;
                    font-weight: 700;
                    letter-spacing: -.02em;
                }
                .fnl .chip {
                    font-style: normal;
                    font-size: 12px;
                    font-weight: 600;
                    padding: 4px 10px;
                    border-radius: 99px;
                }
                .fnl .chip.g {
                    background: #ddf1e8;
                    color: #066b48;
                }
                .fnl .chip.p {
                    background: #ffe0ec;
                    color: #b3224f;
                }
                .fnl .kf {
                    font-size: 13px;
                    color: #566575;
                    border-top: 1px solid rgba(86, 101, 117, .18);
                    padding-top: 10px;
                }
                .fnl .kpi.hi .kf {
                    border-color: rgba(255, 255, 255, .3);
                }
                .fnl .mid {
                    display: grid;
                    grid-template-columns: minmax(0, 1.9fr) minmax(0, 1fr);
                    gap: 16px;
                }
                .fnl .chw {
                    display: flex;
                    gap: 12px;
                    margin-top: 28px;
                }
                .fnl .yl {
                    display: flex;
                    flex-direction: column;
                    justify-content: space-between;
                    height: 260px;
                    min-width: 34px;
                }
                .fnl .yl span {
                    height: 0;
                    display: flex;
                    align-items: center;
                    justify-content: flex-end;
                    font-size: 13px;
                    color: #566575;
                }
                .fnl .plot {
                    flex: 1;
                    min-width: 0;
                }
                .fnl .cols,
                .fnl .xr {
                    display: flex;
                    gap: 18px;
                }
                .fnl .cols {
                    height: 260px;
                }
                .fnl .xr {
                    margin-top: 12px;
                }
                .fnl .xr span {
                    flex: 1;
                    text-align: center;
                    font-size: 13px;
                    color: #566575;
                    min-width: 0;
                }
                .fnl .xr span.on {
                    color: #0b1b2b;
                    font-weight: 600;
                }
                .fnl .col {
                    flex: 1;
                    min-width: 0;
                    border: 0;
                    padding: 0;
                    background: #fff1f6;
                    border-radius: 20px;
                    position: relative;
                    display: flex;
                    align-items: flex-end;
                    cursor: pointer;
                }
                .fnl .col .in {
                    width: 100%;
                    background: #ffd3e4;
                    border-radius: 20px;
                    min-height: 8px;
                    position: relative;
                }
                .fnl .col:hover {
                    background: #ffe8f1;
                }
                .fnl .col.on .in {
                    background: repeating-linear-gradient(135deg, #0a9462 0 1.5px, #cfebdd 1.5px 6px);
                }
                .fnl .col .dot {
                    position: absolute;
                    left: 50%;
                    top: -7px;
                    margin-left: -7px;
                    width: 14px;
                    height: 14px;
                    border-radius: 50%;
                    background: #fff;
                    border: 3px solid #0a9462;
                }
                .fnl .tip {
                    position: absolute;
                    left: 50%;
                    transform: translateX(-50%);
                    top: 14px;
                    width: 210px;
                    background: #fff;
                    border-radius: 16px;
                    padding: 14px 16px;
                    box-shadow: 0 10px 30px rgba(11, 27, 43, .14);
                    font-size: 13px;
                    display: flex;
                    flex-direction: column;
                    gap: 8px;
                    text-align: left;
                    z-index: 3;
                    cursor: default;
                    pointer-events: none;
                }
                .fnl .tip > div {
                    display: flex;
                    justify-content: space-between;
                    color: #566575;
                }
                .fnl .tip > div b {
                    color: #0b1b2b;
                }
                .fnl .tip .ds {
                    color: #566575;
                    font-size: 12px;
                    line-height: 1.35;
                }
                .fnl .gp {
                    align-items: center;
                }
                .fnl .gauge-wrap {
                    max-width: 300px;
                    width: 100%;
                    margin: 28px 0 16px;
                }
                .fnl .mini {
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    gap: 12px;
                    width: 100%;
                    margin-top: 8px;
                }
                .fnl .mini > div {
                    background: #f3fafc;
                    border-radius: 20px;
                    padding: 16px;
                    display: flex;
                    flex-direction: column;
                    gap: 8px;
                }
                .fnl .mini .n {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    font-size: 22px;
                    font-weight: 700;
                    flex-wrap: wrap;
                }
                .fnl .lst {
                    display: flex;
                    flex-direction: column;
                    flex: 1;
                    margin-top: 14px;
                }
                .fnl .li {
                    display: flex;
                    justify-content: space-between;
                    gap: 12px;
                    align-items: center;
                    padding: 12px 0;
                    border-top: 1px solid #eef3f6;
                    font-size: 14px;
                    min-height: 46px;
                }
                .fnl .pm,
                .fnl .li:first-of-type {
                    border-top: 0;
                }
                .fnl .pm {
                    flex: none;
                    display: flex;
                    flex-direction: column;
                    justify-content: center;
                    gap: 8px;
                    padding: 12px 0;
                    border-top: 1px solid #eef3f6;
                }
                .fnl .pm > div:first-child > div:first-child,
                .fnl .pm > div:first-child > span:first-child {
                    display: flex;
                    justify-content: space-between;
                    font-size: 14px;
                }
                .fnl .bar {
                    height: 10px;
                    border-radius: 99px;
                    background: #ffe0ec;
                    overflow: hidden;
                }
                .fnl .bar i {
                    display: block;
                    height: 100%;
                    border-radius: 99px;
                    background: #4fa486;
                }
                .fnl .bot {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
                    gap: 16px;
                }
                .fnl .sb {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    min-height: 48px;
                    padding: 0 16px;
                    border-radius: 99px;
                    background: #f3fafc;
                    min-width: 220px;
                    border: 1px solid rgba(11, 27, 43, .05);
                }
                .fnl .sb input {
                    border: 0;
                    background: transparent;
                    font-size: 14px;
                    font-family: inherit;
                    outline: 0;
                    width: 100%;
                    color: #0b1b2b;
                }
                .fnl .th2,
                .fnl .tr2 {
                    display: grid;
                    grid-template-columns: minmax(0, 1.7fr) minmax(0, 1.5fr) 80px 110px 110px 110px;
                    gap: 16px;
                    align-items: center;
                    padding: 14px 16px;
                }
                .fnl .th2 {
                    background: #f3fafc;
                    border-radius: 16px;
                    font-size: 13px;
                    color: #566575;
                    margin-top: 22px;
                }
                .fnl .tr2 {
                    width: 100%;
                    border: 0;
                    border-bottom: 1px solid #eef3f6;
                    background: transparent;
                    text-align: left;
                    font-size: 14px;
                    cursor: pointer;
                    min-height: 64px;
                    padding-left: 16px;
                    padding-right: 16px;
                }
                .fnl .tr2:hover {
                    background: #f8fcfd;
                }
                .fnl .tr2 .c {
                    display: flex;
                    flex-direction: column;
                    min-width: 0;
                }
                .fnl .tr2 .c b,
                .fnl .tr2 .c span {
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                    display: block;
                }
                .fnl .tr2 .t,
                .fnl .th2 .t {
                    text-align: right;
                }
                .fnl .pill {
                    font-style: normal;
                    font-size: 12px;
                    font-weight: 600;
                    padding: 5px 12px;
                    border-radius: 99px;
                    background: #ddf1e8;
                    color: #066b48;
                    display: inline-block;
                }
                .fnl .pill.rec {
                    background: #fce7f0;
                    color: #a61e4d;
                }
                /* ---- Faixa: origem dos checkouts ---- */
                .fnl .card.orc {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    gap: 16px;
                    flex-wrap: wrap;
                }
                .fnl .card.orc .chips {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 8px;
                    max-width: 62%;
                }
                .fnl .orc .chipn {
                    font-style: normal;
                    font-size: 13px;
                    padding: 6px 14px;
                    border-radius: 99px;
                    background: #f0f6f9;
                    border: 1px solid rgba(11, 27, 43, .08);
                    white-space: nowrap;
                }
                .fnl .orc .chipn b {
                    color: #087f55;
                }
                @media (max-width: 720px) {
                    .fnl .card.orc .chips { max-width: 100%; }
                }
                /* ---- Card: Recuperação de carrinho ---- */
                .fnl .card.rec .rechero {
                    display: flex;
                    flex-direction: column;
                    gap: 2px;
                    padding: 20px 18px 16px;
                    margin-top: 16px;
                    border: 1px solid rgba(8, 127, 85, .18);
                    border-radius: 12px;
                    background: #f0f9f3;
                }
                .fnl .card.rec .rechero .num {
                    font-size: 32px;
                    font-weight: 800;
                    letter-spacing: -.02em;
                    color: #087f55;
                    line-height: 1.1;
                }
                .fnl .card.rec .rechero .det {
                    font-size: 14px;
                    color: #0b1b2b;
                    margin-top: 6px;
                }
                .fnl .card.rec .recbar {
                    height: 8px;
                    border-radius: 99px;
                    background: #efeff1;
                    margin-top: 16px;
                    overflow: hidden;
                }
                .fnl .card.rec .recbar i {
                    display: block;
                    height: 100%;
                    border-radius: 99px;
                    background: linear-gradient(90deg, #4fa486, #087f55);
                    transition: width .5s ease-out;
                }
                .fnl .card.rec .recline {
                    display: flex;
                    flex-direction: column;
                    gap: 6px;
                    margin-top: 10px;
                }
                .fnl .card.rec .recline .g {
                    font-size: 14px;
                    font-weight: 600;
                    color: #087f55;
                }
                .fnl .empty {
                    padding: 40px 0;
                    text-align: center;
                    color: #566575;
                    font-size: 14px;
                }
                .fnl .ov {
                    position: fixed;
                    inset: 0;
                    background: rgba(11, 27, 43, .45);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    padding: 24px;
                    z-index: 50;
                }
                .fnl .dlg {
                    background: #fff;
                    border-radius: 28px;
                    padding: 28px;
                    width: 100%;
                    max-width: 820px;
                    max-height: calc(100vh - 48px);
                    overflow: auto;
                    color: #0b1b2b;
                }
                .fnl .dlg.sm {
                    max-width: 480px;
                }
                .fnl .dh {
                    display: flex;
                    justify-content: space-between;
                    align-items: flex-start;
                    gap: 12px;
                }
                .fnl .x {
                    width: 44px;
                    height: 44px;
                    border-radius: 50%;
                    border: 0;
                    background: #f3fafc;
                    display: grid;
                    place-items: center;
                    cursor: pointer;
                    flex: none;
                }
                .fnl .orow {
                    display: grid;
                    grid-template-columns: minmax(0, 1.6fr) 60px 120px;
                    gap: 16px;
                    align-items: center;
                    padding: 14px 0;
                    border-top: 1px solid #eef3f6;
                    font-size: 14px;
                }
                .fnl .orow > span:first-child {
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }
                .fnl .orow .bar {
                    grid-column: 1 / -1;
                    height: 8px;
                    margin-top: -4px;
                }
                .fnl .dl {
                    display: flex;
                    justify-content: space-between;
                    gap: 16px;
                    padding: 14px 0;
                    border-top: 1px solid #eef3f6;
                    font-size: 14px;
                }
                .fnl .dl span:first-child {
                    color: #566575;
                }
                .fnl .dl b {
                    text-align: right;
                    overflow-wrap: anywhere;
                }
                .fnl .toast {
                    position: fixed;
                    left: 50%;
                    bottom: 28px;
                    transform: translateX(-50%);
                    background: #0b1b2b;
                    color: #fff;
                    font-size: 14px;
                    font-weight: 500;
                    padding: 14px 22px;
                    border-radius: 99px;
                    z-index: 60;
                    animation: fnlsobe .25s ease-out;
                }
                @keyframes fnlsobe {
                    from {
                        opacity: 0;
                        transform: translate(-50%, 8px);
                    }
                }
                .fnl button:focus-visible,
                .fnl input:focus-visible {
                    outline: 2px solid #d6336c;
                    outline-offset: 2px;
                    border-radius: 12px;
                }
                .fnl .aviso {
                    display: flex;
                    gap: 12px;
                    border: 1px solid #c8e7d9;
                    background: #e3f4ec;
                    color: #066b48;
                    border-radius: 20px;
                    padding: 16px 18px;
                    font-size: 14px;
                    line-height: 1.5;
                }
                .fnl .aviso code {
                    background: rgba(6, 107, 72, .1);
                    border-radius: 6px;
                    padding: 2px 6px;
                    font-size: 12px;
                }
                @media (max-width: 1000px) {
                    .fnl .mid {
                        grid-template-columns: 1fr;
                    }
                }
                @media (max-width: 760px) {
                    .fnl {
                        padding: 24px 16px 48px;
                    }
                    .fnl h1 {
                        font-size: 26px;
                    }
                    .fnl .v {
                        font-size: 28px;
                    }
                    .fnl .th2,
                    .fnl .tr2 {
                        grid-template-columns: minmax(0, 1fr) auto;
                    }
                    .fnl .o,
                    .fnl .m,
                    .fnl .d,
                    .fnl .st {
                        display: none;
                    }
                    .fnl .tip {
                        width: 170px;
                    }
                    .fnl .cols,
                    .fnl .xr {
                        gap: 8px;
                    }
                }
                @media (prefers-reduced-motion: reduce) {
                    .fnl .spin {
                        animation: none;
                    }
                    .fnl .toast {
                        animation: none;
                    }
                }
            `}</style>

            {/* Cabeçalho */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap", marginBottom: 8 }}>
                <div>
                    <h1>Funil de vendas</h1>
                    <p className="mu" style={{ margin: "6px 0 0", fontSize: 14 }}>
                        Visitas na landing, checkouts iniciados e compras finalizadas — direto dos webhooks da B4Y.
                    </p>
                </div>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap", position: "relative" }}>
                    <button
                        type="button"
                        className="pillbtn"
                        aria-haspopup="true"
                        aria-expanded={menuAberto}
                        onClick={() => setMenuAberto(!menuAberto)}
                    >
                        {PERIODOS[periodo]}
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
                    </button>
                    {menuAberto && (
                        <>
                            <button type="button" className="catch" aria-label="Fechar menu" onClick={() => setMenuAberto(false)} />
                            <div className="menu" role="menu">
                                {Object.entries(PERIODOS).map(([k, t]) => (
                                    <button
                                        key={k}
                                        type="button"
                                        role="menuitem"
                                        className={periodo === k ? "mi on" : "mi"}
                                        onClick={() => {
                                            if (k !== periodo) setPeriodo(k);
                                            setMenuAberto(false);
                                        }}
                                    >
                                        {t}
                                    </button>
                                ))}
                            </div>
                        </>
                    )}
                    <button type="button" className="pillbtn main" onClick={() => carregar(periodo)} disabled={carregando}>
                        <svg className={carregando ? "spin" : ""} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M21 12a9 9 0 0 1-15.5 6.2M3 12A9 9 0 0 1 18.5 5.8M18 2v4h-4M6 22v-4h4" /></svg>
                        {carregando ? "Atualizando…" : "Atualizar"}
                    </button>
                </div>
            </div>

            {carregando && !d ? (
                <div className="card empty" style={{ borderStyle: "dashed" }}>Calculando o funil…</div>
            ) : !d ? (
                <div className="card empty">Sem dados. Confira se o worker e o Supabase estão configurados.</div>
            ) : (
                <>
                    {/* KPIs */}
                    <div className="kpis">
                        <div className="kpi">
                            <div className="kh">
                                <span className="kl">Visitas na página</span>
                                <span className="ic"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" /></svg></span>
                            </div>
                            <div className="kv"><span className="v">{visitasVal == null ? "—" : numero(visitasVal)}</span></div>
                            <span className="kf">só vale o snippet da landing — não conta o resto da internet</span>
                        </div>
                        <div className="kpi">
                            <div className="kh">
                                <span className="kl">Checkouts abertos</span>
                                <span className="ic"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6h15l-2 9H8L6 3H3" /><circle cx="9" cy="20" r="1" /><circle cx="18" cy="20" r="1" /></svg></span>
                            </div>
                            <div className="kv"><span className="v">{numero(d.checkoutsIniciados)}</span></div>
                            <span className="kf">pessoas que abriram o checkout pelos SEUS links (afiliados não entram na conta)</span>
                        </div>
                        <div className="kpi hi">
                            <div className="kh">
                                <span className="kl">Compras finalizadas</span>
                                <span className="ic"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M8 12l3 3 5-6" /></svg></span>
                            </div>
                            <div className="kv">
                                <span className="v">{numero(d.pagos)}</span>
                                <i className="chip g">{pct(d.pagos / Math.max(d.checkoutsIniciados, 1))} dos checkouts</i>
                            </div>
                            <span className="kf">Faturamento: <b>{moeda(d.faturamento)}</b>{d.recuperadas > 0 ? <> · {d.recuperadas} da recuperação</> : null}</span>
                        </div>
                        <div className="kpi dk">
                            <div className="kh">
                                <span className="kl">Abandono de carrinho</span>
                                <span className="ic"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6h15l-2 9H8L6 3H3" /><circle cx="9" cy="20" r="1" /><circle cx="18" cy="20" r="1" /><path d="M2 2l20 20" /></svg></span>
                            </div>
                            <div className="kv">
                                <span className="v">{numero(d.abandonados)}</span>
                                <i className="chip p">{pct(d.abandonados / Math.max(d.checkoutsIniciados, 1))} dos checkouts</i>
                            </div>
                            <span className="kf">pessoas que largaram o carrinho · Pix ou boleto emitidos: <b>{numero(d.cobrancas)}</b></span>
                        </div>
                    </div>

                    {/* Origem dos checkouts: o tráfego vem de vários lugares, não só da landing */}
                    {d.origens.length > 0 && (
                        <div className="card orc">
                            <div>
                                <h2 style={{ fontSize: 16 }}>De onde vieram {numero(d.checkoutsIniciados)} checkouts abertos</h2>
                                <p className="mu" style={{ margin: "4px 0 0", fontSize: 13 }}>de onde entraram no checkout — só os seus links de produtor, sem afiliados</p>
                            </div>
                            <div className="chips">
                                {d.origens.map((o) => (
                                    <i className="chipn" key={o.rotulo}>{o.rotulo} · <b>{o.clientes}</b></i>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Aviso: rastreamento de visitas não instalado */}
                    {visitasVal == null && (
                        <div className="aviso">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" style={{ flex: "none", marginTop: 2 }}><circle cx="12" cy="12" r="9" /><path d="M12 8h.01M12 12v4" /></svg>
                            <span>
                                Para medir a etapa <b>Página visitada</b>: execute{" "}
                                <code>WA-AKG/supabase/funil.sql</code> no SQL Editor do Supabase e cole o snippet{" "}
                                <code>tracking-visitas/snippet-visitas.html</code> na landing. O resto do funil já está ativo.
                            </span>
                        </div>
                    )}

                    {/* Gráfico + gauge */}
                    <div className="mid">
                        <div className="card">
                            <h2>Funil de conversão</h2>
                            <p className="mu" style={{ margin: "6px 0 0" }}>Passe o mouse ou toque em uma etapa para ver os detalhes</p>
                            <div className="chw">
                                <div className="yl" aria-hidden="true">
                                    {eixo.map((t, i) => (<span key={i}>{tickFmt(t)}</span>))}
                                </div>
                                <div className="plot">
                                    <div
                                        className="cols"
                                        onMouseLeave={() => setSel(null)}
                                        onBlur={() => setSel(null)}
                                    >
                                        {etapas.map((c, i) => (
                                            <button
                                                key={c.label}
                                                type="button"
                                                className={i === sel ? "col on" : "col"}
                                                aria-label={`${c.name}: ${numero(c.val)}`}
                                                aria-current={i === sel}
                                                onClick={() => setSel(i)}
                                                onMouseEnter={() => setSel(i)}
                                                onFocus={() => setSel(i)}
                                            >
                                                <span className="in" style={{ height: `${Math.max(((c.val ?? 0) / maxEtapa) * 100, 0)}%` }}>
                                                    {i === sel && <span className="dot" />}
                                                </span>
                                                {i === sel && (
                                                    <span className="tip">
                                                        <b>{c.name}</b>
                                                        <span className="ds">{c.frase}</span>
                                                        <span className="ds">{c.detalhe}</span>
                                                    </span>
                                                )}
                                            </button>
                                        ))}
                                    </div>
                                    <div className="xr">
                                        {etapas.map((c, i) => (
                                            <span key={c.label} className={i === sel ? "on" : ""}>{c.label}</span>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="card gp">
                            <h2 style={{ alignSelf: "flex-start" }}>Taxa de aprovação</h2>
                            <div className="gauge-wrap" role="img" aria-label={taxa != null ? `${taxa}% de pagamentos aprovados` : "Sem cobranças no período"}>
                                <svg viewBox="0 0 260 150" width="100%">
                                    <path d="M 20 130 A 110 110 0 0 1 240 130" pathLength={100} fill="none" stroke="#FFD3E4" strokeWidth="30" strokeDasharray="4.2 0.8" />
                                    <path d="M 20 130 A 110 110 0 0 1 240 130" pathLength={100} fill="none" stroke="#0A9462" strokeWidth="30" strokeDasharray={strokeVerde} />
                                    <text x="130" y="118" textAnchor="middle" fontFamily="inherit" fontWeight="600" fontSize="38" fill="#0B1B2B">{taxa != null ? `${taxa}%` : "—"}</text>
                                    <text x="130" y="140" textAnchor="middle" fontFamily="inherit" fontSize="12" fill="#566575">aprovados</text>
                                </svg>
                            </div>
                            <div className="mini">
                                <div>
                                    <span className="mu">Cobranças</span>
                                    <span className="n">{numero(d.cobrancas)} <i className="chip p">{pct(d.cobrancas / Math.max(d.checkoutsIniciados, 1))}</i></span>
                                </div>
                                <div>
                                    <span className="mu">Aprovados</span>
                                    <span className="n">{numero(d.pagos)} {taxa != null && <i className="chip g">{taxa}%</i>}</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Linha de três cards */}
                    <div className="bot">
                        <div className="card">
                            <h2>Receita por pagamento</h2>
                            <div className="lst">
                                {metodos.length === 0 && (
                                    <div className="li"><span className="mu">Nenhuma venda no período.</span></div>
                                )}
                                {metodos.map((m) => (
                                    <div className="pm" key={m.k}>
                                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14 }}>
                                            <span>{m.nome} <span className="mu">({m.count})</span></span>
                                            <b>{moeda(m.receita)}</b>
                                        </div>
                                        <div className="bar"><i style={{ width: `${Math.max((m.receita / maxReceita) * 100, 2)}%` }} /></div>
                                    </div>
                                ))}
                                <div className="li" style={{ borderTop: 0 }}>
                                    <span className="mu">Total · {numero(d.pagos)} vendas</span>
                                    <b>{moeda(d.faturamento)}</b>
                                </div>
                            </div>
                        </div>

                        <div className="card">
                            <h2>O que não fechou</h2>
                            <p className="mu" style={{ margin: "6px 0 0" }}>Onde as vendas deram errado no período</p>
                            <div className="lst">
                                <div className="li"><span>Cartões recusados</span><b style={{ fontSize: 18 }}>{numero(d.recusados)}</b></div>
                                <div className="li"><span>Pix expirados</span><b style={{ fontSize: 18 }}>{numero(d.pixExpirados)}</b></div>
                                <div className="li"><span>Reembolsos</span><b style={{ fontSize: 18 }}>{numero(d.reembolsos)}</b></div>
                            </div>
                        </div>

                        <div className="card">
                            <h2>Por oferta</h2>
                            <div className="lst">
                                {d.porProduto.map((o, i) => (
                                    <div className="li" key={o.nome}>
                                        <span className="ell">{o.nome}</span>
                                        <span className="mu nw">{o.count}× <b className="tx">{moeda(o.receita)}</b></span>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Recuperação de carrinho */}
                        <div className="card rec">
                            <h2 style={{ margin: 0 }}>Recuperação de carrinho</h2>
                            <p className="mu" style={{ margin: "6px 0 0" }}>Quem recebeu lembrete no WhatsApp no período</p>

                            {rec.enviados > 0 ? (
                                <>
                                    <div className="rechero">
                                        <span className="num">{moeda(rec.receitaRecuperada)}</span>
                                        <span className="mu">voltaram pra conta pela recuperação</span>
                                        <span className="det">
                                            <b>{numero(rec.recuperadas)}</b> {rec.recuperadas === 1 ? "venda recuperada" : "vendas recuperadas"} de{" "}
                                            <b>{numero(rec.enviados)}</b> lembretes enviados
                                        </span>
                                    </div>

                                    <div className="recbar" role="img" aria-label={`Taxa de recuperação: ${Math.round(recTaxa * 100)} de cada 100 lembretes`}>
                                        <i style={{ width: `${recBarra}%` }} />
                                    </div>
                                    <div className="recline">
                                        <span className="mu">Taxa: {pct(recTaxa)}</span>
                                        <b className="g">De cada 100 lembretes enviados, {Math.round(recTaxa * 100)} voltaram e compraram.</b>
                                    </div>

                                    <div className="lst">
                                        <div className="li">
                                            <span>Dinheiro que estava em jogo</span>
                                            <b style={{ fontSize: 18 }}>{moeda(rec.valorEmJogo)}</b>
                                        </div>
                                        <div className="li">
                                            <span>Dinheiro recuperado (pago)</span>
                                            <b style={{ fontSize: 18 }}>{moeda(rec.receitaRecuperada)}</b>
                                        </div>
                                    </div>
                                </>
                            ) : (
                                <div style={{ paddingBlock: 24 }}><span className="mu">Nenhum lembrete enviado no período.</span></div>
                            )}
                        </div>
                    </div>

                    {/* Últimas vendas */}
                    <div className="card">
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                            <div>
                                <h2>Últimas vendas</h2>
                                <p className="mu" style={{ margin: "6px 0 0" }}>Pagamentos aprovados mais recentes</p>
                            </div>
                            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                                <label className="sb">
                                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
                                    <input
                                        placeholder="Buscar por cliente, e-mail ou oferta…"
                                        aria-label="Buscar vendas"
                                        value={busca}
                                        onChange={(e) => setBusca(e.target.value)}
                                    />
                                </label>
                                <button type="button" className="link" onClick={() => setModal("sales")} disabled={vendasFiltradas.length <= 6}>Ver todas</button>
                            </div>
                        </div>
                        <div className="th2" aria-hidden="true">
                            <span>Cliente</span>
                            <span className="o">Oferta</span>
                            <span className="m">Método</span>
                            <span className="d">Data</span>
                            <span className="st">Status</span>
                            <span className="t">Total</span>
                        </div>
                        {vendasFiltradas.slice(0, 6).map((s, i) => (
                            <button
                                key={i}
                                type="button"
                                className="tr2"
                                onClick={() => { setDetId(d.ultimasVendas.indexOf(s)); setModal("detail"); }}
                            >
                                <span className="c"><b>{s.nome}</b><span className="mu">{s.email}</span></span>
                                <span className="c o"><span>{s.oferta}</span></span>
                                <span className="m">{METODO_NOME[s.metodo] || s.metodo}</span>
                                <span className="d mu">{quando(s.pago_em)}</span>
                                <span className="st" style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 4 }}>
                                    <i className="pill">Aprovado</i>
                                    {s.recuperada && <i className="pill rec">Recuperado</i>}
                                </span>
                                <b className="t">{moeda(s.valor)}</b>
                            </button>
                        ))}
                        {semVendas && <div className="empty">Nenhuma venda encontrada para essa busca.</div>}
                    </div>

                    {/* Modal: todas as vendas */}
                    {modal === "sales" && (
                        <div className="ov" onClick={() => setModal(null)}>
                            <div className="dlg" role="dialog" aria-modal="true" aria-label="Todas as vendas" onClick={(e) => e.stopPropagation()}>
                                <div className="dh">
                                    <div>
                                        <h2>Últimas vendas</h2>
                                        <p className="mu" style={{ margin: "6px 0 0" }}>
                                            {vendasFiltradas.length} de {d.ultimasVendas.length} pagamentos aprovados mais recentes
                                        </p>
                                    </div>
                                    <button type="button" className="x" aria-label="Fechar" onClick={() => setModal(null)}>
                                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
                                    </button>
                                </div>
                                <label className="sb" style={{ marginTop: 18 }}>
                                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
                                    <input
                                        placeholder="Buscar por cliente, e-mail ou oferta…"
                                        aria-label="Buscar vendas"
                                        value={busca}
                                        onChange={(e) => setBusca(e.target.value)}
                                    />
                                </label>
                                <div style={{ marginTop: 16 }}>
                                    {vendasFiltradas.map((s) => (
                                        <button
                                            key={d.ultimasVendas.indexOf(s)}
                                            type="button"
                                            className="tr2"
                                            onClick={() => { setDetId(d.ultimasVendas.indexOf(s)); setModal("detail"); }}
                                        >
                                            <span className="c"><b>{s.nome}</b><span className="mu">{s.email}</span></span>
                                            <span className="c o"><span>{s.oferta}</span></span>
                                            <span className="m">{METODO_NOME[s.metodo] || s.metodo}</span>
                                            <span className="d mu">{quando(s.pago_em)}</span>
                                            <span className="st" style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 4 }}>
                                                <i className="pill">Aprovado</i>
                                                {s.recuperada && <i className="pill rec">Recuperado</i>}
                                            </span>
                                            <b className="t">{moeda(s.valor)}</b>
                                        </button>
                                    ))}
                                    {semVendas && <div className="empty">Nenhuma venda encontrada para essa busca.</div>}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Modal: detalhes da venda */}
                    {modal === "detail" && vendaSel && (
                        <div className="ov" onClick={() => setModal(null)}>
                            <div className="dlg sm" role="dialog" aria-modal="true" aria-label="Detalhes da venda" onClick={(e) => e.stopPropagation()}>
                                <div className="dh">
                                    <div>
                                        <h2>Detalhes da venda</h2>
                                        <p style={{ margin: "10px 0 0" }}><i className="pill">Aprovado</i></p>
                                    </div>
                                    <button type="button" className="x" aria-label="Fechar" onClick={() => setModal(null)}>
                                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
                                    </button>
                                </div>
                                <div style={{ fontSize: 34, fontWeight: 700, letterSpacing: "-.02em", color: "#087F55", margin: "20px 0 10px" }}>
                                    {moeda(vendaSel.valor)}
                                </div>
                                <div className="dl"><span>Cliente</span><b>{vendaSel.nome}</b></div>
                                <div className="dl"><span>E-mail</span><b>{vendaSel.email || "—"}</b></div>
                                <div className="dl"><span>Origem</span><b>{vendaSel.recuperada ? "Recuperação (lembrete no WhatsApp)" : "Direto pela página"}</b></div>
                                <div className="dl"><span>Oferta</span><b>{vendaSel.oferta}</b></div>
                                <div className="dl"><span>Método</span><b>{METODO_NOME[vendaSel.metodo] || vendaSel.metodo}</b></div>
                                <div className="dl"><span>Data</span><b>{quando(vendaSel.pago_em)}</b></div>
                            </div>
                        </div>
                    )}

                    {/* Toast pós-atualização */}
                    {toastDados && <div className="toast" role="status">Dados atualizados agora</div>}
                </>
            )}
        </div>
    );
}
