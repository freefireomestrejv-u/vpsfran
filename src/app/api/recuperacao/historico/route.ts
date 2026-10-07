import { NextResponse, NextRequest } from "next/server";
import { getAuthenticatedUser, isAdmin } from "@/lib/api-auth";

function sb() {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return null;
    return { url: url.replace(/\/$/, ""), key };
}

function etapaDe(pedidoId: string): { etapa: string; titulo: string } {
    const id = String(pedidoId || "");
    if (id.endsWith("#boasvindas")) return { etapa: "boasvindas", titulo: "Boas-vindas" };
    if (id.startsWith("abandono:")) return { etapa: "abandono", titulo: "Carrinho abandonado" };
    if (id.endsWith("#cartao")) return { etapa: "cartao", titulo: "Cartão recusado" };
    return { etapa: "cobranca", titulo: "Pix não pago" };
}

// GET: últimas mensagens de recuperação enviadas (só SUPERADMIN: tem telefone de cliente)
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
        const limite = Math.min(Number(new URL(request.url).searchParams.get("limit") || 50), 200);
        const res = await fetch(
            `${cfg.url}/rest/v1/lembretes?select=pedido_id,nome,telefone,produto,valor,status,atualizado_em&status=eq.enviado&order=atualizado_em.desc&limit=${limite}`,
            { headers: { apikey: cfg.key, Authorization: `Bearer ${cfg.key}` } }
        );
        if (!res.ok) throw new Error(`Supabase: HTTP ${res.status}`);
        const rows = await res.json();
        const data = (rows || []).map((r: any) => ({ ...r, ...etapaDe(r.pedido_id) }));
        return NextResponse.json({ status: true, message: "Histórico retrieved", data });
    } catch (error: any) {
        return NextResponse.json({ status: false, message: error?.message || "Failed", error: error?.message || "Failed" }, { status: 500 });
    }
}
