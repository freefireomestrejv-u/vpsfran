import { NextResponse, NextRequest } from "next/server";
import { getAuthenticatedUser, isAdmin } from "@/lib/api-auth";

function sb() {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return null;
    return { url: url.replace(/\/$/, ""), key };
}

async function sbFetch(path: string, init: RequestInit = {}) {
    const cfg = sb();
    if (!cfg) return null;
    const res = await fetch(`${cfg.url}${path}`, {
        ...init,
        headers: {
            apikey: cfg.key,
            Authorization: `Bearer ${cfg.key}`,
            "Content-Type": "application/json",
            ...(init.headers || {}),
        },
    });
    return res;
}

// Sessão válida: "padrao" ou sessionId do painel (letras, números e hífens)
function sessaoValida(valor: any): string | null {
    const s = String(valor || "").trim();
    if (!s || s === "padrao") return "padrao";
    return /^[A-Za-z0-9-]+$/.test(s) ? s : null;
}

// Tem conteúdo suficiente para valer como personalização da sessão
function temConteudo(r: any): boolean {
    return (Array.isArray(r.blocos) && r.blocos.length > 0)
        || String(r.texto || "").trim().length > 0
        || !!r.audio_url;
}

// GET: scripts da sessão pedida (?sessao=, padrão = "padrao").
// Para uma sessão, mescla com o padrão: linha da sessão vence quando existir.
export async function GET(request: NextRequest) {
    try {
        const user = await getAuthenticatedUser(request);
        if (!user) {
            return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 401 });
        }
        const sessao = sessaoValida(new URL(request.url).searchParams.get("sessao")) || "padrao";
        const filtro = sessao === "padrao"
            ? "sessao=eq.padrao"
            : `sessao=in.("padrao","${encodeURIComponent(sessao)}")`;
        const res = await sbFetch(`/rest/v1/templates_recuperacao?select=etapa,texto,audio_url,blocos,atualizado_em,sessao&${filtro}`);
        if (!res) {
            return NextResponse.json({ status: false, message: "Supabase não configurado (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)", error: "Supabase não configurado" }, { status: 500 });
        }
        if (!res.ok) throw new Error(`Supabase: HTTP ${res.status}`);
        const rows: any[] = await res.json();

        const porEtapa: Record<string, any> = {};
        for (const r of rows) {
            if ((r.sessao || "padrao") === "padrao") {
                porEtapa[r.etapa] = { etapa: r.etapa, texto: r.texto, audio_url: r.audio_url, blocos: r.blocos, atualizado_em: r.atualizado_em, origem: "padrao" };
            }
        }
        if (sessao !== "padrao") {
            for (const r of rows) {
                if (r.sessao === sessao && temConteudo(r)) {
                    porEtapa[r.etapa] = { etapa: r.etapa, texto: r.texto, audio_url: r.audio_url, blocos: r.blocos, atualizado_em: r.atualizado_em, origem: "sessao" };
                }
            }
        }
        return NextResponse.json({ status: true, message: "Templates retrieved", data: Object.values(porEtapa), sessao });
    } catch (error: any) {
        return NextResponse.json({ status: false, message: error?.message || "Failed", error: error?.message || "Failed" }, { status: 500 });
    }
}

// PUT: salva etapa { etapa, sessao?, texto?, audio_url?, blocos? } (só SUPERADMIN)
export async function PUT(request: NextRequest) {
    try {
        const user = await getAuthenticatedUser(request);
        if (!user || !isAdmin(user.role)) {
            return NextResponse.json({ status: false, message: "Forbidden", error: "Forbidden" }, { status: 403 });
        }
        const body = await request.json();
        const { etapa, texto, audio_url, blocos } = body;
        const sessao = sessaoValida(body.sessao);
        if (!sessao) {
            return NextResponse.json({ status: false, message: "sessao inválida", error: "sessao inválida" }, { status: 400 });
        }
        if (!["boasvindas", "cobranca", "abandono", "cartao"].includes(etapa)) {
            return NextResponse.json({ status: false, message: "etapa inválida", error: "etapa inválida" }, { status: 400 });
        }
        if (blocos !== undefined && !Array.isArray(blocos)) {
            return NextResponse.json({ status: false, message: "blocos deve ser array", error: "blocos deve ser array" }, { status: 400 });
        }
        const patch: any = { etapa, sessao, atualizado_em: new Date().toISOString() };
        if (texto !== undefined) patch.texto = texto;
        if (audio_url !== undefined) patch.audio_url = audio_url;
        if (blocos !== undefined) patch.blocos = blocos;
        const res = await sbFetch("/rest/v1/templates_recuperacao?on_conflict=sessao,etapa", {
            method: "POST",
            headers: { Prefer: "resolution=merge-duplicates,return=representation" },
            body: JSON.stringify(patch),
        });
        if (!res) {
            return NextResponse.json({ status: false, message: "Supabase não configurado", error: "Supabase não configurado" }, { status: 500 });
        }
        if (!res.ok) throw new Error(`Supabase: HTTP ${res.status}`);
        const data = await res.json();
        return NextResponse.json({ status: true, message: "Template salvo", data });
    } catch (error: any) {
        return NextResponse.json({ status: false, message: error?.message || "Failed", error: error?.message || "Failed" }, { status: 500 });
    }
}
