-- Scripts de recuperação POR SESSÃO: cada sessão (ex.: afiliada) pode ter o
-- próprio texto/áudio. Linhas com sessao='padrao' valem para todas as sessões
-- que não tenham script próprio. Rode no Supabase: SQL Editor > New query > Run

-- 1) Nova coluna (linhas existentes viram o script "padrao")
alter table public.templates_recuperacao
  add column if not exists sessao text not null default 'padrao';

-- 2) Chave vira (sessao, etapa): cada sessão tem um script por etapa
alter table public.templates_recuperacao
  drop constraint if exists templates_recuperacao_pkey;

alter table public.templates_recuperacao
  add constraint templates_recuperacao_pkey primary key (sessao, etapa);
