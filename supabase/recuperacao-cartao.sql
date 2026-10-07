-- Recuperação de carrinho: nova etapa "cartao" (cartão recusado).
-- Rode no Supabase DEPOIS do recuperacao-abandono.sql.

alter table public.templates_recuperacao
  drop constraint if exists templates_recuperacao_etapa_check;

alter table public.templates_recuperacao
  add check (etapa in ('boasvindas', 'cobranca', 'abandono', 'cartao'));

-- Texto inicial. Variáveis: {nome} {produto} {valor} {link} {marca}
insert into public.templates_recuperacao (etapa, texto) values
('cartao',
'Oi, {nome}! Aqui é da {marca}.' || chr(10) || chr(10) ||
'Vi que sua tentativa no cartão{produto}{valor} não passou.' || chr(10) || chr(10) ||
'Pode ser limite ou bloqueio do banco. Tente outro cartão ou finalize por aqui: {link}' || chr(10) || chr(10) ||
'Qualquer dúvida, estou por aqui à disposição.')
on conflict (etapa) do nothing;
