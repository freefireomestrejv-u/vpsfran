"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RefreshCw, Save, Trash2, Upload, Volume2 } from "lucide-react";
import { toast } from "sonner";
import { SessionGuard } from "@/components/dashboard/session-guard";

interface Template {
    etapa: string;
    texto: string;
    audio_url: string | null;
}

const VARS = ["{nome}", "{produto}", "{valor}", "{codigo}", "{link}", "{marca}"];

const ETAPAS: Record<string, { titulo: string; desc: string }> = {
    boasvindas: { titulo: "Boas-vindas (na hora)", desc: "Enviada ~10s após gerar o Pix." },
    cobranca: { titulo: "Cobrança (após a espera)", desc: "Enviada após o tempo de espera, só se não pagou." },
    abandono: { titulo: "Abandono (sem Pix)", desc: "Enviada após a espera quando o checkout não virou Pix." },
    cartao: { titulo: "Cartão recusado", desc: "Enviada após a espera quando o cartão não passa." },
};

function Bloco({ titulo, desc, tpl, salvando, onTexto, onSalvar, onAudio, onRemoverAudio }: {
    titulo: string; desc: string; tpl: Template;
    salvando: boolean; onTexto: (v: string) => void; onSalvar: () => void;
    onAudio: (f: File) => void; onRemoverAudio: () => void;
}) {
    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <Volume2 className="h-5 w-5 text-primary" /> {titulo}
                </CardTitle>
                <CardDescription>{desc}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="space-y-2">
                    <Label>Texto da mensagem</Label>
                    <Textarea
                        value={tpl.texto}
                        onChange={(e) => onTexto(e.target.value)}
                        className="min-h-[220px] font-mono text-sm"
                    />
                    <p className="text-xs text-muted-foreground">
                        Variáveis: {VARS.map(v => <code key={v} className="bg-muted px-1 rounded mr-1">{v}</code>)}
                    </p>
                </div>
                <div className="space-y-2 border-t border-border/50 pt-4">
                    <Label>Áudio fixo (nota de voz)</Label>
                    {tpl.audio_url ? (
                        <div className="flex items-center gap-2">
                            <audio src={tpl.audio_url} controls className="h-9 flex-1" preload="none" />
                            <Button variant="ghost" size="icon" className="text-destructive" onClick={onRemoverAudio} title="Remover áudio">
                                <Trash2 className="h-4 w-4" />
                            </Button>
                        </div>
                    ) : (
                        <p className="text-xs text-muted-foreground">Sem áudio — só o texto será enviado.</p>
                    )}
                    <div className="flex items-center gap-2">
                        <Input
                            type="file" accept="audio/*"
                            onChange={(e) => { const f = e.target.files?.[0]; if (f) onAudio(f); e.target.value = ""; }}
                        />
                    </div>
                    <p className="text-xs text-muted-foreground">Envie .ogg ou .mp3 (ideal: OGG). Vira nota de voz no WhatsApp.</p>
                </div>
                <Button onClick={onSalvar} disabled={salvando} className="w-full sm:w-auto">
                    {salvando ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                    Salvar {titulo.toLowerCase()}
                </Button>
            </CardContent>
        </Card>
    );
}

export default function RecuperacaoPage() {
    const [tpls, setTpls] = useState<Record<string, Template>>({});
    const [loading, setLoading] = useState(true);
    const [salvando, setSalvando] = useState<string | null>(null);

    const carregar = async () => {
        setLoading(true);
        try {
            const res = await fetch("/api/recuperacao/templates");
            const j = await res.json();
            if (!res.ok) throw new Error(j.message || "Falha ao carregar");
            const map: Record<string, Template> = {};
            for (const t of (j.data || [])) map[t.etapa] = t;
            setTpls(map);
        } catch (e: any) {
            toast.error(e.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { carregar(); }, []);

    const salvarTexto = async (etapa: string) => {
        setSalvando(etapa);
        try {
            const res = await fetch("/api/recuperacao/templates", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ etapa, texto: tpls[etapa]?.texto ?? "" }),
            });
            const j = await res.json();
            if (!res.ok) throw new Error(j.message || "Falha ao salvar");
            toast.success("Texto salvo! O worker usa na próxima venda.");
        } catch (e: any) {
            toast.error(e.message);
        } finally {
            setSalvando(null);
        }
    };

    const subirAudio = async (etapa: string, file: File) => {
        const fd = new FormData();
        fd.append("etapa", etapa);
        fd.append("file", file);
        try {
            toast.info(`Subindo áudio de ${etapa}...`);
            const res = await fetch("/api/recuperacao/audio", { method: "POST", body: fd });
            const j = await res.json();
            if (!res.ok) throw new Error(j.message || "Falha no upload");
            setTpls((p) => ({ ...p, [etapa]: { ...p[etapa], audio_url: j.data.audio_url } }));
            toast.success("Áudio salvo!");
        } catch (e: any) {
            toast.error(e.message);
        }
    };

    const removerAudio = async (etapa: string) => {
        try {
            const res = await fetch(`/api/recuperacao/audio?etapa=${etapa}`, { method: "DELETE" });
            const j = await res.json();
            if (!res.ok) throw new Error(j.message || "Falha ao remover");
            setTpls((p) => ({ ...p, [etapa]: { ...p[etapa], audio_url: null } }));
            toast.success("Áudio removido.");
        } catch (e: any) {
            toast.error(e.message);
        }
    };

    if (loading) return <div className="p-8 text-center text-muted-foreground">Carregando...</div>;

    return (
        <SessionGuard>
            <div className="space-y-6 max-w-4xl">
                <div>
                    <h2 className="text-xl sm:text-3xl font-bold tracking-tight">Recuperação de carrinho</h2>
                    <p className="text-muted-foreground text-sm mt-1">Textos e áudios que o worker envia. Vale na hora para as próximas vendas.</p>
                </div>
                {Object.keys(ETAPAS).filter((e) => tpls[e]).map((etapa) => (
                    <Bloco
                        key={etapa}
                        titulo={ETAPAS[etapa].titulo}
                        desc={ETAPAS[etapa].desc}
                        tpl={tpls[etapa] || { etapa, texto: "", audio_url: null }}
                        salvando={salvando === etapa}
                        onTexto={(v) => setTpls((p) => ({ ...p, [etapa]: { ...(p[etapa] || { etapa, texto: "", audio_url: null }), texto: v } }))}
                        onSalvar={() => salvarTexto(etapa)}
                        onAudio={(f) => subirAudio(etapa, f)}
                        onRemoverAudio={() => removerAudio(etapa)}
                    />
                ))}
                <Card className="border-primary/20 bg-primary/5">
                    <CardContent className="pt-4 text-xs text-muted-foreground space-y-1">
                        <p><Upload className="h-3 w-3 inline mr-1" /> O áudio sai como <strong>nota de voz</strong> logo após o texto (na cobrança, antes do código Pix).</p>
                        <p>Sem áudio cadastrado, só o texto é enviado — nada quebra.</p>
                    </CardContent>
                </Card>
            </div>
        </SessionGuard>
    );
}
