import { NextResponse, NextRequest } from "next/server";
import { getAuthenticatedUser, isAdmin } from "@/lib/api-auth";

function sb() {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return null;
    return { url: url.replace(/\/$/, ""), key };
}

// POST: sobe o áudio fixo de uma etapa (form-data: etapa, file). Vira {etapa}.ogg público.
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
        const file = form.get("file") as File | null;
        if ((etapa !== "boasvindas" && etapa !== "cobranca") || !file) {
            return NextResponse.json({ status: false, message: "etapa e file são obrigatórios", error: "etapa e file são obrigatórios" }, { status: 400 });
        }
        const buf = Buffer.from(await file.arrayBuffer());
        const up = await fetch(`${cfg.url}/storage/v1/object/audios/${etapa}.ogg`, {
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
        const publicUrl = `${cfg.url}/storage/v1/object/public/audios/${etapa}.ogg`;
        await fetch(`${cfg.url}/rest/v1/templates_recuperacao?etapa=eq.${etapa}`, {
            method: "PATCH",
            headers: { apikey: cfg.key, Authorization: `Bearer ${cfg.key}`, "Content-Type": "application/json" },
            body: JSON.stringify({ audio_url: publicUrl, atualizado_em: new Date().toISOString() }),
        });
        return NextResponse.json({ status: true, message: "Áudio salvo", data: { etapa, audio_url: publicUrl } });
    } catch (error: any) {
        return NextResponse.json({ status: false, message: error?.message || "Failed", error: error?.message || "Failed" }, { status: 500 });
    }
}

// DELETE ?etapa=boasvindas|cobranca — remove o áudio (mantém o texto)
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
        const etapa = new URL(request.url).searchParams.get("etapa") || "";
        if (etapa !== "boasvindas" && etapa !== "cobranca") {
            return NextResponse.json({ status: false, message: "etapa inválida", error: "etapa inválida" }, { status: 400 });
        }
        await fetch(`${cfg.url}/storage/v1/object/audios/${etapa}.ogg`, {
            method: "DELETE",
            headers: { apikey: cfg.key, Authorization: `Bearer ${cfg.key}` },
        });
        await fetch(`${cfg.url}/rest/v1/templates_recuperacao?etapa=eq.${etapa}`, {
            method: "PATCH",
            headers: { apikey: cfg.key, Authorization: `Bearer ${cfg.key}`, "Content-Type": "application/json" },
            body: JSON.stringify({ audio_url: null, atualizado_em: new Date().toISOString() }),
        });
        return NextResponse.json({ status: true, message: "Áudio removido", data: { etapa } });
    } catch (error: any) {
        return NextResponse.json({ status: false, message: error?.message || "Failed", error: error?.message || "Failed" }, { status: 500 });
    }
}
