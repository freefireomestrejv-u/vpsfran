import { NextResponse, NextRequest } from "next/server";
import { getAuthenticatedUser, isAdmin } from "@/lib/api-auth";

function sb() {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return null;
    return { url: url.replace(/\/$/, ""), key };
}

function sessaoValida(valor: any): string | null {
    const s = String(valor || "").trim();
    if (!s || s === "padrao") return "padrao";
    return /^[A-Za-z0-9-]+$/.test(s) ? s : null;
}

// Nome do arquivo: sessões personalizadas ganham prefixo próprio
// (evita que o áudio da afiliada sobrescreva o do padrão).
function arquivoDe(sessao: string, nome: string, etapa: string): string {
    const base = nome || etapa;
    return sessao === "padrao" ? `${base}.ogg` : `${sessao}-${base}.ogg`;
}

// POST: sobe o áudio de uma etapa (form-data: etapa, sessao?, nome?, file).
export async function POST(request: NextRequest) {
    try {
        const user = await getAuthenticatedUser(request);
        if (!user || !isAdmin(user.role)) {
            return NextResponse.json({ status: false, message: "Forbidden", error: "Forbidden" }, { status: 403 });
        }
        const cfg = sb();
        if (!cfg) {
            return NextResponse.json({ status: false, message: "Supabase não configurado", error: "Supabase não configurado" }, { status: 500 });
        }
        const form = await request.formData();
        const etapa = String(form.get("etapa") || "");
        const sessao = sessaoValida(form.get("sessao"));
        const nome = String(form.get("nome") || "").replace(/[^a-zA-Z0-9-_]/g, "").slice(0, 40);
        const file = form.get("file") as File | null;
        if (!["boasvindas", "cobranca", "abandono", "cartao"].includes(etapa) || !file) {
            return NextResponse.json({ status: false, message: "etapa e file são obrigatórios", error: "etapa e file são obrigatórios" }, { status: 400 });
        }
        if (!sessao) {
            return NextResponse.json({ status: false, message: "sessao inválida", error: "sessao inválida" }, { status: 400 });
        }
        const buf = Buffer.from(await file.arrayBuffer());
        const arquivo = arquivoDe(sessao, nome, etapa);
        const up = await fetch(`${cfg.url}/storage/v1/object/audios/${arquivo}`, {
            method: "POST",
            headers: {
                apikey: cfg.key,
                Authorization: `Bearer ${cfg.key}`,
                "Content-Type": file.type || "audio/ogg",
                "x-upsert": "true",
            },
            body: buf,
        });
        if (!up.ok) throw new Error(`Upload: HTTP ${up.status}`);
        const publicUrl = `${cfg.url}/storage/v1/object/public/audios/${arquivo}`;
        await fetch(`${cfg.url}/rest/v1/templates_recuperacao?sessao=eq.${sessao}&etapa=eq.${etapa}`, {
            method: "PATCH",
            headers: { apikey: cfg.key, Authorization: `Bearer ${cfg.key}`, "Content-Type": "application/json" },
            body: JSON.stringify({ audio_url: publicUrl, atualizado_em: new Date().toISOString() }),
        });
        return NextResponse.json({ status: true, message: "Áudio salvo", data: { etapa, sessao, audio_url: publicUrl } });
    } catch (error: any) {
        return NextResponse.json({ status: false, message: error?.message || "Failed", error: error?.message || "Failed" }, { status: 500 });
    }
}

// DELETE ?etapa=...&sessao=... — remove o áudio (mantém o texto)
export async function DELETE(request: NextRequest) {
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
        const etapa = sp.get("etapa") || "";
        const sessao = sessaoValida(sp.get("sessao"));
        if (!["boasvindas", "cobranca", "abandono", "cartao"].includes(etapa)) {
            return NextResponse.json({ status: false, message: "etapa inválida", error: "etapa inválida" }, { status: 400 });
        }
        if (!sessao) {
            return NextResponse.json({ status: false, message: "sessao inválida", error: "sessao inválida" }, { status: 400 });
        }
        await fetch(`${cfg.url}/storage/v1/object/audios/${arquivoDe(sessao, "", etapa)}`, {
            method: "DELETE",
            headers: { apikey: cfg.key, Authorization: `Bearer ${cfg.key}` },
        });
        await fetch(`${cfg.url}/rest/v1/templates_recuperacao?sessao=eq.${sessao}&etapa=eq.${etapa}`, {
            method: "PATCH",
            headers: { apikey: cfg.key, Authorization: `Bearer ${cfg.key}`, "Content-Type": "application/json" },
            body: JSON.stringify({ audio_url: null, atualizado_em: new Date().toISOString() }),
        });
        return NextResponse.json({ status: true, message: "Áudio removido", data: { etapa, sessao } });
    } catch (error: any) {
        return NextResponse.json({ status: false, message: error?.message || "Failed", error: error?.message || "Failed" }, { status: 500 });
    }
}
