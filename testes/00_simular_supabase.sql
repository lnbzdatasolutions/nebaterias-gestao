-- SOMENTE PARA TESTE LOCAL. Não rodar no Supabase (lá isto já existe).
-- Simula os papéis anon/authenticated, auth.users e auth.uid().
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;

create schema if not exists auth;
create table if not exists auth.users (id uuid primary key, email text);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;

-- No Supabase, tabelas novas já nascem com permissão total para anon/authenticated.
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;

insert into auth.users values
  ('11111111-1111-1111-1111-111111111111', 'dono@loja.test'),
  ('22222222-2222-2222-2222-222222222222', 'esposa@loja.test')
on conflict do nothing;
