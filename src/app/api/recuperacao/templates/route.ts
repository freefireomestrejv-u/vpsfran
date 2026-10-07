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

// GET: lista os 2 templates (boasvindas + cobranca)
export async function GET(request: NextRequest) {
    try {
        const user = await getAuthenticatedUser(request);
        if (!user) {
            return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 401 });
        }
        const res = await sbFetch("/rest/v1/templates_recuperacao?select=etapa,texto,audio_url,blocos,atualizado_em");
        if (!res) {
            return NextResponse.json({ status: false, message: "Supabase não configurado (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)", error: "Supabase não configurado" }, { status: 500 });
        }
        if (!res.ok) throw new Error(`Supabase: HTTP ${res.status}`);
        const data = await res.json();
        return NextResponse.json({ status: true, message: "Templates retrieved", data });
    } catch (error: any) {
        return NextResponse.json({ status: false, message: error?.message || "Failed", error: error?.message || "Failed" }, { status: 500 });
    }
}

// PUT: salva etapa { etapa, texto?, audio_url?, blocos? } (só SUPERADMIN)
export async function PUT(request: NextRequest) {
    try {
        const user = await getAuthenticatedUser(request);
        if (!user || !isAdmin(user.role)) {
            return NextResponse.json({ status: false, message: "Forbidden", error: "Forbidden" }, { status: 403 });
        }
        const body = await request.json();
        const { etapa, texto, audio_url, blocos } = body;
        if (!["boasvindas", "cobranca", "abandono", "cartao"].includes(etapa)) {
            return NextResponse.json({ status: false, message: "etapa inválida", error: "etapa inválida" }, { status: 400 });
        }
        if (blocos !== undefined && !Array.isArray(blocos)) {
            return NextResponse.json({ status: false, message: "blocos deve ser array", error: "blocos deve ser array" }, { status: 400 });
        }
        const patch: any = { etapa, atualizado_em: new Date().toISOString() };
        if (texto !== undefined) patch.texto = texto;
        if (audio_url !== undefined) patch.audio_url = audio_url;
        if (blocos !== undefined) patch.blocos = blocos;
        const res = await sbFetch("/rest/v1/templates_recuperacao?on_conflict=etapa", {
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
