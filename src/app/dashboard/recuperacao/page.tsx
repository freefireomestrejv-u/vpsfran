"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RefreshCw, Save, Trash2, Volume2, Plus, ArrowUp, ArrowDown, Type, Music4, Hash, Upload, History, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { SessionGuard } from "@/components/dashboard/session-guard";

interface Bloco {
    id: string;
    tipo: "texto" | "audio" | "codigo";
    texto?: string;
    audio_url?: string | null;
}

interface Template {
    etapa: string;
    texto: string;
    audio_url: string | null;
    blocos?: Bloco[] | null;
}

const VARS = [
    { v: "{nome}", d: "primeiro nome" },
    { v: "{produto}", d: "ex. de Renew Veins" },
    { v: "{valor}", d: "ex. (R$ 319,00)" },
    { v: "{codigo}", d: "Pix copia e cola" },
    { v: "{link}", d: "link do checkout" },
    { v: "{marca}", d: "nome da loja" },
];

const ETAPAS: Record<string, { titulo: string; desc: string }> = {
    boasvindas: { titulo: "Boas-vindas (na hora)", desc: "Enviada ~10s após gerar o Pix." },
    cobranca: { titulo: "Cobrança (após a espera)", desc: "Enviada após o tempo de espera, só se não pagou." },
    abandono: { titulo: "Abandono (sem Pix)", desc: "Enviada após a espera quando o checkout não virou Pix." },
    cartao: { titulo: "Cartão recusado", desc: "Enviada após a espera quando o cartão não passa." },
};

const nid = () => Math.random().toString(36).slice(2, 9);

function blocosIniciais(t: Template, etapa: string): Bloco[] {
    if (Array.isArray(t.blocos) && t.blocos.length) return t.blocos;
    const out: Bloco[] = [];
    if (t.texto) out.push({ id: nid(), tipo: "texto", texto: t.texto });
    if (t.audio_url) out.push({ id: nid(), tipo: "audio", audio_url: t.audio_url });
    if (etapa === "cobranca") out.push({ id: nid(), tipo: "codigo" });
    return out.length ? out : [{ id: nid(), tipo: "texto", texto: "" }];
}

function AreaTexto({ value, onChange }: { value: string; onChange: (v: string) => void }) {
    const ref = useRef<HTMLTextAreaElement>(null);
    const [busca, setBusca] = useState<string | null>(null);

    const aoDigitar = (v: string) => {
        onChange(v);
        const el = ref.current;
        if (!el) { setBusca(null); return; }
        const pos = el.selectionStart || 0;
        const antes = v.slice(0, pos);
        const m = antes.match(/@(\w*)$/);
        setBusca(m ? m[1].toLowerCase() : null);
    };

    const inserir = (variavel: string) => {
        const el = ref.current;
        if (!el) { onChange(value + variavel); return; }
        const pos = el.selectionStart || 0;
        const antes = value.slice(0, pos).replace(/@\w*$/, "");
        const depois = value.slice(pos);
        const novo = antes + variavel + depois;
        onChange(novo);
        setBusca(null);
        requestAnimationFrame(() => {
            el.focus();
            const p = antes.length + variavel.length;
            el.setSelectionRange(p, p);
        });
    };

    const opcoes = busca === null ? [] : VARS.filter((x) => x.v.toLowerCase().includes(busca));
    return (
        <div className="relative">
            <Textarea
                ref={ref}
                value={value}
                onChange={(e) => aoDigitar(e.target.value)}
                onKeyDown={(e) => {
                    if (e.key === "Enter" && busca !== null && opcoes.length > 0) {
                        e.preventDefault();
                        inserir(opcoes[0].v);
                    }
                    if (e.key === "Escape") setBusca(null);
                }}
                onBlur={() => setTimeout(() => setBusca(null), 150)}
                className="min-h-[140px] font-mono text-sm"
                placeholder="Digite @ para variáveis..."
            />
            {busca !== null && opcoes.length > 0 && (
                <div className="absolute z-20 left-0 right-0 sm:right-auto sm:w-72 mt-1 rounded-lg border bg-popover shadow-xl p-1">
                    {opcoes.map((o) => (
                        <button
                            key={o.v}
                            onMouseDown={(e) => { e.preventDefault(); inserir(o.v); }}
                            className="w-full flex items-center gap-2 px-2.5 py-2 rounded-md text-sm hover:bg-muted text-left"
                        >
                            <code className="bg-muted px-1.5 py-0.5 rounded font-mono text-xs text-primary">{o.v}</code>
                            <span className="text-xs text-muted-foreground">{o.d}</span>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

export default function RecuperacaoPage() {
    const router = useRouter();
    const [tpls, setTpls] = useState<Record<string, Template>>({});
    const [blocos, setBlocos] = useState<Record<string, Bloco[]>>({});
    const [loading, setLoading] = useState(true);
    const [salvando, setSalvando] = useState<string | null>(null);
    const [subindo, setSubindo] = useState<string | null>(null);
    const [historico, setHistorico] = useState<any[]>([]);

    const carregar = async () => {
        setLoading(true);
        try {
            const res = await fetch("/api/recuperacao/templates");
            const j = await res.json();
            if (!res.ok) throw new Error(j.message || "Falha ao carregar");
            const map: Record<string, Template> = {};
            const bl: Record<string, Bloco[]> = {};
            for (const t of (j.data || [])) {
                map[t.etapa] = t;
                bl[t.etapa] = blocosIniciais(t, t.etapa);
            }
            setTpls(map);
            setBlocos(bl);
        } catch (e: any) {
            toast.error(e.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { carregar(); }, []);

    const carregarHistorico = async () => {
        try {
            const res = await fetch("/api/recuperacao/historico?limit=50");
            const j = await res.json();
            if (res.ok) setHistorico(j.data || []);
        } catch {
            // silencioso: histórico é extra
        }
    };

    useEffect(() => { carregarHistorico(); }, []);

    const setBloco = (etapa: string, fn: (b: Bloco[]) => Bloco[]) =>
        setBlocos((p) => ({ ...p, [etapa]: fn(p[etapa] || []) }));

    const mover = (etapa: string, i: number, dir: -1 | 1) =>
        setBloco(etapa, (b) => {
            const j = i + dir;
            if (j < 0 || j >= b.length) return b;
            const c = [...b];
            [c[i], c[j]] = [c[j], c[i]];
            return c;
        });

    const salvar = async (etapa: string) => {
        setSalvando(etapa);
        try {
            const lista = blocos[etapa] || [];
            const textos = lista.filter((b) => b.tipo === "texto").map((b) => b.texto || "").filter(Boolean);
            const primeiroAudio = lista.find((b) => b.tipo === "audio" && b.audio_url);
            const res = await fetch("/api/recuperacao/templates", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    etapa,
                    texto: textos.join("\n\n"),
                    audio_url: primeiroAudio?.audio_url || null,
                    blocos: lista,
                }),
            });
            const j = await res.json();
            if (!res.ok) throw new Error(j.message || "Falha ao salvar");
            toast.success("Salvo! Vale para as próximas vendas.");
        } catch (e: any) {
            toast.error(e.message);
        } finally {
            setSalvando(null);
        }
    };

    const subirAudio = async (etapa: string, id: string, file: File) => {
        const fd = new FormData();
        fd.append("etapa", etapa);
        fd.append("nome", `${etapa}-${id}`);
        fd.append("file", file);
        setSubindo(id);
        try {
            const res = await fetch("/api/recuperacao/audio", { method: "POST", body: fd });
            const j = await res.json();
            if (!res.ok) throw new Error(j.message || "Falha no upload");
            setBloco(etapa, (b) => b.map((x) => (x.id === id ? { ...x, audio_url: j.data.audio_url } : x)));
            toast.success("Áudio salvo no bloco!");
        } catch (e: any) {
            toast.error(e.message);
        } finally {
            setSubindo(null);
        }
    };

    if (loading) return <div className="p-8 text-center text-muted-foreground">Carregando...</div>;

    return (
        <SessionGuard>
            <div className="space-y-6 max-w-4xl">
                <div>
                    <h2 className="text-xl sm:text-3xl font-bold tracking-tight">Recuperação de carrinho</h2>
                    <p className="text-muted-foreground text-sm mt-1">Monte a sequência de cada etapa. Vale na hora para as próximas vendas.</p>
                </div>
                {Object.keys(ETAPAS).filter((e) => tpls[e]).map((etapa) => (
                    <Card key={etapa}>
                        <CardHeader>
                            <CardTitle>{ETAPAS[etapa].titulo}</CardTitle>
                            <CardDescription>{ETAPAS[etapa].desc}</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            {(blocos[etapa] || []).map((b, i, arr) => (
                                <div key={b.id} className="rounded-lg border p-3 space-y-2 bg-muted/20">
                                    <div className="flex items-center gap-1">
                                        <span className="text-xs font-bold text-muted-foreground mr-1 flex items-center gap-1">
                                            {b.tipo === "texto" ? <><Type className="h-3 w-3" /> Texto {i + 1}</> : b.tipo === "audio" ? <><Music4 className="h-3 w-3" /> Áudio {i + 1}</> : <><Hash className="h-3 w-3" /> Código Pix</>}
                                        </span>
                                        <span className="flex-1" />
                                        <Button variant="ghost" size="icon" className="h-7 w-7" disabled={i === 0} onClick={() => mover(etapa, i, -1)} title="Subir">
                                            <ArrowUp className="h-3.5 w-3.5" />
                                        </Button>
                                        <Button variant="ghost" size="icon" className="h-7 w-7" disabled={i === arr.length - 1} onClick={() => mover(etapa, i, 1)} title="Descer">
                                            <ArrowDown className="h-3.5 w-3.5" />
                                        </Button>
                                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => setBloco(etapa, (x) => x.filter((y) => y.id !== b.id))} title="Remover">
                                            <Trash2 className="h-3.5 w-3.5" />
                                        </Button>
                                    </div>
                                    {b.tipo === "texto" && (
                                        <AreaTexto
                                            value={b.texto || ""}
                                            onChange={(v) => setBloco(etapa, (x) => x.map((y) => (y.id === b.id ? { ...y, texto: v } : y)))}
                                        />
                                    )}
                                    {b.tipo === "audio" && (
                                        <div className="space-y-2">
                                            {b.audio_url ? (
                                                <div className="flex items-center gap-2">
                                                    <audio src={b.audio_url} controls className="h-9 flex-1" preload="none" />
                                                    <Button variant="ghost" size="icon" className="text-destructive" onClick={() => setBloco(etapa, (x) => x.map((y) => (y.id === b.id ? { ...y, audio_url: null } : y)))} title="Remover áudio">
                                                        <Trash2 className="h-4 w-4" />
                                                    </Button>
                                                </div>
                                            ) : (
                                                <Label className="flex items-center gap-2 text-xs text-muted-foreground border border-dashed rounded-lg p-3 cursor-pointer">
                                                    <Upload className="h-4 w-4" />
                                                    {subindo === b.id ? "Subindo..." : "Clique para subir o áudio (.ogg/.mp3)"}
                                                    <Input
                                                        type="file" accept="audio/*" className="hidden"
                                                        disabled={subindo === b.id}
                                                        onChange={(e) => { const f = e.target.files?.[0]; if (f) subirAudio(etapa, b.id, f); e.target.value = ""; }}
                                                    />
                                                </Label>
                                            )}
                                        </div>
                                    )}
                                    {b.tipo === "codigo" && (
                                        <p className="text-xs text-muted-foreground">Envia o código Pix copia e cola (só quando existir; na cobrança).</p>
                                    )}
                                </div>
                            ))}
                            <div className="flex flex-wrap gap-2 pt-1">
                                <Button variant="outline" size="sm" onClick={() => setBloco(etapa, (b) => [...b, { id: nid(), tipo: "texto", texto: "" }])}>
                                    <Plus className="h-3.5 w-3.5 mr-1" /> Texto
                                </Button>
                                <Button variant="outline" size="sm" onClick={() => setBloco(etapa, (b) => [...b, { id: nid(), tipo: "audio", audio_url: null }])}>
                                    <Plus className="h-3.5 w-3.5 mr-1" /> Áudio
                                </Button>
                                <Button variant="outline" size="sm" onClick={() => setBloco(etapa, (b) => [...b, { id: nid(), tipo: "codigo" }])}>
                                    <Plus className="h-3.5 w-3.5 mr-1" /> Código Pix
                                </Button>
                            </div>
                            <p className="text-xs text-muted-foreground">Digite <code className="bg-muted px-1 rounded">@</code> no texto para variáveis.</p>
                            <Button onClick={() => salvar(etapa)} disabled={salvando === etapa}>
                                {salvando === etapa ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                                Salvar {ETAPAS[etapa].titulo.toLowerCase()}
                            </Button>
                        </CardContent>
                    </Card>
                ))}
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <History className="h-5 w-5 text-primary" /> Histórico de enviadas
                        </CardTitle>
                        <CardDescription>Clique para abrir a conversa com o que foi enviado.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        {historico.length === 0 ? (
                            <p className="text-sm text-muted-foreground">Nenhuma mensagem enviada ainda.</p>
                        ) : (
                            <div className="space-y-2">
                                {historico.map((h: any) => (
                                    <button
                                        key={h.pedido_id}
                                        onClick={() => h.telefone && router.push(`/dashboard/chat/${h.telefone}`)}
                                        className="w-full flex items-center gap-3 p-3 rounded-lg border hover:bg-muted/40 transition-colors text-left"
                                    >
                                        <span className="text-xs font-bold px-2 py-1 rounded-full bg-primary/10 text-primary shrink-0">
                                            {h.titulo}
                                        </span>
                                        <span className="flex-1 min-w-0">
                                            <span className="block text-sm font-medium truncate">
                                                {h.nome || h.telefone}
                                                {h.produto ? ` • ${h.produto}` : ""}
                                            </span>
                                            <span className="block text-[11px] text-muted-foreground font-mono">
                                                {h.telefone} • {new Date(h.atualizado_em).toLocaleString("pt-BR")}
                                            </span>
                                        </span>
                                        <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                                    </button>
                                ))}
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>
        </SessionGuard>
    );
}
