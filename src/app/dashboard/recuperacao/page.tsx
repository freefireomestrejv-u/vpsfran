"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RefreshCw, Save, Trash2, Plus, ArrowUp, ArrowDown, Type, Music4, Hash, Upload, History, ChevronRight, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { SessionGuard } from "@/components/dashboard/session-guard";
import { cn } from "@/lib/utils";

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
    boasvindas: { titulo: "Boas-vindas", desc: "Enviada ~10s após gerar o Pix." },
    cobranca: { titulo: "Cobrança", desc: "Enviada após o tempo de espera, só se não pagou." },
    abandono: { titulo: "Abandono", desc: "Enviada após a espera quando o checkout não virou Pix." },
    cartao: { titulo: "Cartão recusado", desc: "Enviada após a espera quando o cartão não passa." },
};

const TIPO_NOME: Record<Bloco["tipo"], string> = { texto: "Texto", audio: "Áudio", codigo: "Código Pix" };

const TIPO_COR_ETIQUETA: Record<string, string> = {
    "Boas-vindas": "bg-emerald-100 text-emerald-800 border border-emerald-200",
    "Pix não pago": "bg-blue-100 text-blue-800 border border-blue-200",
    "Carrinho abandonado": "bg-amber-100 text-amber-800 border border-amber-200",
    "Cartão recusado": "bg-rose-100 text-rose-800 border border-rose-200",
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

function previaBloco(b: Bloco): string {
    if (b.tipo === "texto") {
        const t = (b.texto || "").replace(/\s+/g, " ").trim();
        return t || "Texto vazio — clique para escrever";
    }
    if (b.tipo === "audio") return b.audio_url ? "Áudio pronto para envio" : "Sem arquivo — clique para subir";
    return "Envia o Pix copia e cola (só se existir)";
}

function AreaTexto({ value, onChange, id }: { value: string; onChange: (v: string) => void; id: string }) {
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
                id={id}
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
                className="min-h-[96px] font-mono text-sm"
                placeholder="Digite @ para variáveis..."
                aria-label="Texto da mensagem"
            />
            {busca !== null && opcoes.length > 0 && (
                <div className="absolute z-20 left-0 right-0 sm:right-auto sm:w-72 mt-1 rounded-lg border bg-popover shadow-xl p-1" role="listbox" aria-label="Variáveis disponíveis">
                    {opcoes.map((o) => (
                        <button
                            key={o.v}
                            onMouseDown={(e) => { e.preventDefault(); inserir(o.v); }}
                            className="w-full flex items-center gap-2 px-2.5 py-2 rounded-md text-sm hover:bg-muted text-left"
                            role="option"
                            aria-selected="false"
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

function diaGrupo(iso: string): string {
    const d = new Date(iso);
    const hoje = new Date();
    const ontem = new Date();
    ontem.setDate(hoje.getDate() - 1);
    const dia = (x: Date) => x.toDateString();
    if (dia(d) === dia(hoje)) return "Hoje";
    if (dia(d) === dia(ontem)) return "Ontem";
    return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export default function RecuperacaoPage() {
    const router = useRouter();
    const [tpls, setTpls] = useState<Record<string, Template>>({});
    const [blocos, setBlocos] = useState<Record<string, Bloco[]>>({});
    const [loading, setLoading] = useState(true);
    const [salvando, setSalvando] = useState<string | null>(null);
    const [subindo, setSubindo] = useState<string | null>(null);
    const [historico, setHistorico] = useState<any[]>([]);
    const [aba, setAba] = useState<string>("cobranca");
    const [expandido, setExpandido] = useState<Record<string, number | null>>({});
    const [historicoAberto, setHistoricoAberto] = useState(false);

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

    const alternarPasso = (etapa: string, i: number) =>
        setExpandido((p) => ({ ...p, [etapa]: p[etapa] === i ? null : i }));

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

    const etapasVisiveis = Object.keys(ETAPAS).filter((e) => tpls[e]);
    const abaAtiva = etapasVisiveis.includes(aba) ? aba : etapasVisiveis[0];
    const resumoEtapa = (etapa: string) => {
        const lista = blocos[etapa] || [];
        if (!lista.length) return "sem passos";
        const tipos = lista.map((b) => TIPO_NOME[b.tipo]).join(", ");
        return `${lista.length} ${lista.length === 1 ? "passo" : "passos"} · ${tipos}`;
    };

    const historicoVisivel = historicoAberto ? historico : historico.slice(0, 8);

    return (
        <SessionGuard>
            <div className="space-y-8 max-w-3xl">
                <div>
                    <h2 className="text-xl sm:text-3xl font-bold tracking-tight">Recuperação de carrinho</h2>
                    <p className="text-muted-foreground text-sm mt-1">Monte a sequência de cada etapa. Vale na hora para as próximas vendas.</p>
                </div>

                <div className="flex gap-1 bg-muted/60 p-1 rounded-xl w-full sm:w-fit overflow-x-auto" role="tablist" aria-label="Etapas da recuperação">
                    {etapasVisiveis.map((etapa) => (
                        <button
                            key={etapa}
                            role="tab"
                            aria-selected={abaAtiva === etapa}
                            aria-controls={`painel-${etapa}`}
                            onClick={() => setAba(etapa)}
                            className={cn(
                                "flex-1 sm:flex-none flex flex-col items-start gap-0.5 px-4 py-2 rounded-lg text-left transition-colors min-w-0",
                                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                                abaAtiva === etapa ? "bg-background shadow-sm" : "hover:bg-background/60"
                            )}
                        >
                            <span className={cn("text-sm font-semibold whitespace-nowrap", abaAtiva === etapa ? "text-primary" : "text-foreground")}>
                                {ETAPAS[etapa].titulo}
                            </span>
                            <span className="text-[11px] text-muted-foreground whitespace-nowrap">{resumoEtapa(etapa)}</span>
                        </button>
                    ))}
                </div>

                {etapasVisiveis.map((etapa) => (
                    <section
                        key={etapa}
                        id={`painel-${etapa}`}
                        role="tabpanel"
                        aria-label={ETAPAS[etapa].titulo}
                        hidden={abaAtiva !== etapa}
                        className="space-y-4"
                    >
                        <p className="text-sm text-muted-foreground">{ETAPAS[etapa].desc}</p>

                        {(blocos[etapa] || []).length === 0 && (
                            <div className="rounded-xl border border-dashed p-6 text-center">
                                <p className="text-sm font-medium">Nenhum passo ainda.</p>
                                <p className="text-xs text-muted-foreground mt-1">Adicione um texto, áudio ou código Pix abaixo.</p>
                            </div>
                        )}

                        {(blocos[etapa] || []).map((b, i, arr) => {
                            const aberto = (expandido[etapa] ?? 0) === i;
                            const painelId = `passo-${etapa}-${b.id}`;
                            return (
                                <div key={b.id} className="rounded-xl border border-border/60 bg-background overflow-hidden">
                                    <div
                                        role="button" tabIndex={0}
                                        onClick={() => alternarPasso(etapa, i)}
                                        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); alternarPasso(etapa, i); } }}
                                        aria-expanded={aberto}
                                        aria-controls={painelId}
                                        className="w-full flex items-center gap-3 px-4 py-3 text-left min-h-[52px] hover:bg-muted/40 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
                                    >
                                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                                            {b.tipo === "texto" ? <Type className="h-4 w-4" /> : b.tipo === "audio" ? <Music4 className="h-4 w-4" /> : <Hash className="h-4 w-4" />}
                                        </span>
                                        <span className="flex-1 min-w-0">
                                            <span className="block text-sm font-semibold">
                                                {TIPO_NOME[b.tipo]} {i + 1}
                                            </span>
                                            <span className="block text-xs text-muted-foreground truncate">{previaBloco(b)}</span>
                                        </span>
                                        <span className="flex items-center gap-0.5 shrink-0">
                                            <button
                                                type="button"
                                                aria-label="Mover para cima" disabled={i === 0}
                                                onClick={(e) => { e.stopPropagation(); mover(etapa, i, -1); }}
                                                onKeyDown={(e) => e.stopPropagation()}
                                                className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-30"
                                            >
                                                <ArrowUp className="h-4 w-4" />
                                            </button>
                                            <button
                                                type="button"
                                                aria-label="Mover para baixo" disabled={i === arr.length - 1}
                                                onClick={(e) => { e.stopPropagation(); mover(etapa, i, 1); }}
                                                onKeyDown={(e) => e.stopPropagation()}
                                                className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-30"
                                            >
                                                <ArrowDown className="h-4 w-4" />
                                            </button>
                                            <button
                                                type="button"
                                                aria-label={`Excluir ${TIPO_NOME[b.tipo]} ${i + 1}`}
                                                onClick={(e) => { e.stopPropagation(); setBloco(etapa, (x) => x.filter((y) => y.id !== b.id)); }}
                                                onKeyDown={(e) => e.stopPropagation()}
                                                className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive ml-1"
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </button>
                                        </span>
                                        <ChevronDown className={cn("h-4 w-4 text-muted-foreground shrink-0 transition-transform", aberto && "rotate-180")} />
                                    </div>
                                    <div id={painelId} hidden={!aberto} className="px-4 pb-4">
                                        {b.tipo === "texto" && (
                                            <AreaTexto
                                                value={b.texto || ""}
                                                onChange={(v) => setBloco(etapa, (x) => x.map((y) => (y.id === b.id ? { ...y, texto: v } : y)))}
                                                id={`texto-${etapa}-${b.id}`}
                                            />
                                        )}
                                        {b.tipo === "audio" && (
                                            <div className="space-y-2">
                                                {b.audio_url ? (
                                                    <div className="flex items-center gap-2">
                                                        <audio src={b.audio_url} controls className="h-9 flex-1" preload="none" />
                                                        <Button variant="ghost" size="icon" className="text-destructive h-9 w-9" onClick={() => setBloco(etapa, (x) => x.map((y) => (y.id === b.id ? { ...y, audio_url: null } : y)))} title="Remover áudio" aria-label="Remover áudio">
                                                            <Trash2 className="h-4 w-4" />
                                                        </Button>
                                                    </div>
                                                ) : (
                                                    <Label className="flex items-center gap-2 text-xs text-muted-foreground border border-dashed rounded-lg p-3 cursor-pointer min-h-[52px]">
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
                                            <p className="text-xs text-muted-foreground">Envia o código Pix copia e cola (só quando existir).</p>
                                        )}
                                    </div>
                                </div>
                            );
                        })}

                        <div className="rounded-xl border border-dashed p-3">
                            <p className="text-xs font-semibold text-muted-foreground mb-2 px-1">Adicionar passo</p>
                            <div className="flex flex-wrap gap-2">
                                <Button variant="outline" size="sm" className="h-9" onClick={() => setBloco(etapa, (b) => [...b, { id: nid(), tipo: "texto", texto: "" }])}>
                                    <Plus className="h-3.5 w-3.5 mr-1" /> Texto
                                </Button>
                                <Button variant="outline" size="sm" className="h-9" onClick={() => setBloco(etapa, (b) => [...b, { id: nid(), tipo: "audio", audio_url: null }])}>
                                    <Plus className="h-3.5 w-3.5 mr-1" /> Áudio
                                </Button>
                                <Button variant="outline" size="sm" className="h-9" onClick={() => setBloco(etapa, (b) => [...b, { id: nid(), tipo: "codigo" }])}>
                                    <Plus className="h-3.5 w-3.5 mr-1" /> Código Pix
                                </Button>
                            </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-1.5" aria-label="Variáveis disponíveis">
                            <span className="text-xs text-muted-foreground mr-1">Digite @ no texto. Variáveis:</span>
                            {VARS.map((v) => (
                                <code key={v.v} title={v.d} className="bg-muted px-1.5 py-0.5 rounded font-mono text-[11px] text-primary">{v.v}</code>
                            ))}
                        </div>

                        <div className="pt-1">
                            <Button onClick={() => salvar(etapa)} disabled={salvando === etapa} className="w-full sm:w-auto h-11 px-6">
                                {salvando === etapa ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                                Salvar {ETAPAS[etapa].titulo.toLowerCase()}
                            </Button>
                        </div>
                    </section>
                ))}

                <section aria-label="Histórico de enviadas" className="space-y-3">
                    <div>
                        <h3 className="text-lg font-bold tracking-tight flex items-center gap-2">
                            <History className="h-5 w-5 text-primary" /> Histórico de enviadas
                        </h3>
                        <p className="text-sm text-muted-foreground">Clique para abrir a conversa com o que foi enviado.</p>
                    </div>
                    {historico.length === 0 ? (
                        <p className="text-sm text-muted-foreground">Nenhuma mensagem enviada ainda.</p>
                    ) : (
                        <>
                            <div className="space-y-2">
                                {historicoVisivel.reduce((grupos: { dia: string; itens: any[] }[], h: any) => {
                                    const dia = diaGrupo(h.atualizado_em);
                                    const g = grupos.find((x) => x.dia === dia);
                                    if (g) g.itens.push(h);
                                    else grupos.push({ dia, itens: [h] });
                                    return grupos;
                                }, []).map((g) => (
                                    <div key={g.dia} className="space-y-2">
                                        <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground pt-2">{g.dia}</p>
                                        {g.itens.map((h: any) => (
                                            <button
                                                key={h.pedido_id}
                                                onClick={() => h.telefone && router.push(`/dashboard/chat/${h.telefone}`)}
                                                className="w-full flex items-center gap-3 p-3 rounded-xl border border-border/60 bg-background hover:bg-muted/40 transition-colors text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                                            >
                                                <span className={`text-xs font-bold px-2 py-1 rounded-full shrink-0 ${TIPO_COR_ETIQUETA[h.titulo] || "bg-primary/10 text-primary"}`}>
                                                    {h.titulo}
                                                </span>
                                                <span className="flex-1 min-w-0">
                                                    <span className="block text-sm font-semibold truncate">
                                                        {h.nome || h.telefone}
                                                    </span>
                                                    <span className="block text-xs text-muted-foreground truncate">
                                                        {h.produto || "—"}
                                                    </span>
                                                    <span className="block text-[11px] text-muted-foreground font-mono">
                                                        {h.telefone} • {new Date(h.atualizado_em).toLocaleString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                                                    </span>
                                                </span>
                                                <ChevronRight className="h-4 w-4 text-muted-foreground/50 shrink-0" />
                                            </button>
                                        ))}
                                    </div>
                                ))}
                            </div>
                            {historico.length > 8 && (
                                <Button variant="outline" size="sm" className="w-full h-10" onClick={() => setHistoricoAberto((v) => !v)} aria-expanded={historicoAberto}>
                                    {historicoAberto ? "Mostrar menos" : `Ver mais (${historico.length - 8} restantes)`}
                                </Button>
                            )}
                        </>
                    )}
                </section>
            </div>
        </SessionGuard>
    );
}
