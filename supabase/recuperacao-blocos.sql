-- Recuperação de carrinho: sequência de blocos por etapa (vários textos/áudios em ordem).
-- Rode no Supabase DEPOIS do recuperacao-cartao.sql.
-- Formato: [{"id":"...","tipo":"texto","texto":"..."},{"id":"...","tipo":"audio","audio_url":"..."},{"id":"...","tipo":"codigo"}]
-- Se blocos for nulo, o worker usa o comportamento antigo (texto + audio_url + código auto).

alter table public.templates_recuperacao
  add column if not exists blocos jsonb;
