-- Recuperação de carrinho: textos + áudios editáveis pela aba "Recuperação".
-- Rode no Supabase: SQL Editor > New query > Run

create table if not exists public.templates_recuperacao (
  etapa       text primary key check (etapa in ('boasvindas', 'cobranca')),
  texto       text not null default '',
  audio_url   text,
  atualizado_em timestamptz not null default now()
);

alter table public.templates_recuperacao enable row level security;
-- Sem políticas: só a service role (aba do painel via API + worker) acessa.

-- Textos iniciais (iguais aos que o worker já usava).
-- Variáveis: {nome} {produto} {valor} {codigo} {link} {marca}
insert into public.templates_recuperacao (etapa, texto) values
('boasvindas',
'Oi, {nome}! Aqui é da {marca}.' || chr(10) || chr(10) ||
'Vi que você gerou o QR Code{produto}{valor}. Fico muito feliz que confiou no nosso trabalho!' || chr(10) || chr(10) ||
'Qualquer dúvida, estou por aqui à disposição. Assim que o pagamento for confirmado, te aviso.'),
('cobranca',
'Oi, {nome}! Aqui é da {marca}.' || chr(10) || chr(10) ||
'Vi que você gerou o Pix{produto}{valor}, mas o pagamento ainda não caiu.' || chr(10) || chr(10) ||
'Se ainda quiser, segue o Pix Copia e Cola:' || chr(10) || chr(10) ||
'Se já pagou, pode ignorar esta mensagem. Para não receber mais avisos, responda SAIR.')
on conflict (etapa) do nothing;

-- Bucket público para os 2 áudios fixos (boasvindas.ogg / cobranca.ogg)
insert into storage.buckets (id, name, public)
values ('audios', 'audios', true)
on conflict (id) do nothing;

drop policy if exists "Leitura publica audios" on storage.objects;
create policy "Leitura publica audios"
  on storage.objects for select using (bucket_id = 'audios');
