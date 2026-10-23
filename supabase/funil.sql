-- ============================================================
-- Funil de vendas — tabela de visitas da landing
-- Execute no SQL Editor do Supabase (Dashboard > SQL Editor).
-- Idempotente: pode rodar mais de uma vez sem efeitos colaterais.
-- ============================================================

-- Visita = um carregamento de página rastreado na landing.
-- O snippet (tracking-visitas/snippet-visitas.html) insere via REST
-- com a chave ANON do projeto — por isso o RLS libera só INSERT.
create table if not exists public.visitas (
    id            bigint generated always as identity primary key,
    recebido_em   timestamptz not null default now(),
    pagina        text,            -- URL da página carregada (sem query)
    referrer      text,
    utm_source    text,
    utm_medium    text,
    utm_campaign  text,
    utm_content   text,
    utm_term      text,
    fbclid        text,
    gclid         text,
    b1            text,
    b2            text,
    b3            text,
    session_id    text             -- agrupa toda a navegação do mesmo visitante
);

-- Índice para os filtros por período do painel
create index if not exists visitas_recebido_em_idx
    on public.visitas (recebido_em desc);

-- Segurança (RLS)
alter table public.visitas enable row level security;

-- Anônimo (o snippet da landing) pode APENAS inserir visitas.
drop policy if exists "visitas_insert_anon" on public.visitas;
create policy "visitas_insert_anon"
    on public.visitas for insert
    to anon, authenticated
    with check (true);

-- Leitura fica só para o servidor (service role bypassa RLS).
-- Nenhuma policy de SELECT/DELETE/UPDATE = usuário final não lê nada.
