-- Recuperação de carrinho: nova etapa "abandono" (checkout preenchido, sem Pix).
-- Rode no Supabase DEPOIS do recuperacao.sql.

alter table public.templates_recuperacao
  drop constraint if exists templates_recuperacao_etapa_check;

alter table public.templates_recuperacao
  add check (etapa in ('boasvindas', 'cobranca', 'abandono'));

-- Texto inicial. Variáveis: {nome} {produto} {valor} {link} {marca}
insert into public.templates_recuperacao (etapa, texto) values
('abandono',
'Oi, {nome}! Aqui é da {marca}.' || chr(10) || chr(10) ||
'Vi que você estava de olho em{produto}{valor} mas não concluiu a compra.' || chr(10) || chr(10) ||
'Quando quiser retomar, é por aqui: {link}' || chr(10) || chr(10) ||
'Qualquer dúvida, estou por aqui à disposição.')
on conflict (etapa) do nothing;
