-- =====================================================================
--  N E Baterias · Migração 002 — dados da nota fiscal na venda
--  Rodar DEPOIS de schema.sql e seed.sql (Supabase → SQL Editor). Pode rodar
--  em banco que já tem vendas: nada existente é alterado ou apagado.
--
--  O sistema NÃO emite nota. A nota continua sendo emitida fora (Tiranota).
--  Aqui só se registra a referência dela na venda: modelo, série, número,
--  chave de acesso, data, valor e, se quiser, o PDF.
--
--  Também nesta migração:
--   · atualizar_venda(): editar cliente, atendimento e observação de uma
--     venda já registrada (itens, valores e pagamentos NÃO se editam:
--     cancelar e refazer, para não bagunçar estoque e custo).
--   · CPF/CNPJ do cliente passa a aceitar letras (CNPJ alfanumérico da
--     Receita Federal para inscrições novas).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Validação da chave de acesso (44 dígitos, dígito verificador mód. 11)
-- ---------------------------------------------------------------------
-- Estrutura: UF(2) AAMM(4) CNPJ(14) modelo(2) série(3) número(9)
--            tipo emissão(1) código(8) DV(1)
create or replace function public.fn_chave_nfe_valida(p_chave text)
returns boolean
language plpgsql immutable
as $$
declare
  v_soma integer := 0;
  v_peso integer := 2;
  v_dv   integer;
  i      integer;
begin
  if p_chave is null or p_chave !~ '^\d{44}$' then
    return false;
  end if;
  for i in reverse 43..1 loop
    v_soma := v_soma + (substr(p_chave, i, 1))::integer * v_peso;
    v_peso := case when v_peso = 9 then 2 else v_peso + 1 end;
  end loop;
  v_dv := 11 - (v_soma % 11);
  if v_dv >= 10 then v_dv := 0; end if;
  return v_dv = (substr(p_chave, 44, 1))::integer;
end
$$;

-- ---------------------------------------------------------------------
-- 2. Tabela notas_fiscais (uma venda pode ter histórico: emitida → cancelada → nova)
-- ---------------------------------------------------------------------
create table public.notas_fiscais (
  id                     uuid primary key default gen_random_uuid(),
  venda_id               uuid not null references public.vendas(id) on delete restrict,
  modelo                 smallint not null check (modelo in (55, 65)),
  serie                  smallint not null check (serie between 0 and 999),
  numero                 integer not null check (numero between 1 and 999999999),
  chave                  text unique,
  data_emissao           date not null default ((now() at time zone 'America/Fortaleza')::date),
  valor                  numeric(12,2) check (valor >= 0),
  cpf_cnpj_destinatario  text,
  situacao               text not null default 'emitida' check (situacao in ('emitida', 'cancelada')),
  arquivo_path           text,
  obs                    text,
  motivo_cancelamento    text,
  cancelada_em           timestamptz,
  usuario_id             uuid references auth.users(id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint notas_fiscais_numero_uk unique (modelo, serie, numero),
  constraint notas_fiscais_chave_ck check (chave is null or chave ~ '^\d{44}$')
);
comment on table  public.notas_fiscais is 'Referência da nota emitida fora do sistema (Tiranota) para cada venda. O sistema não emite nota.';
comment on column public.notas_fiscais.modelo is '55 = NF-e · 65 = NFC-e';
comment on column public.notas_fiscais.chave is 'Chave de acesso de 44 dígitos. Ao informar, modelo, série e número são preenchidos a partir dela.';
comment on column public.notas_fiscais.arquivo_path is 'Caminho do PDF/XML no Supabase Storage (bucket notas-fiscais), opcional.';

-- só uma nota "emitida" por venda
create unique index notas_fiscais_uma_emitida_por_venda
  on public.notas_fiscais (venda_id) where situacao = 'emitida';
create index idx_notas_fiscais_venda on public.notas_fiscais (venda_id);
create index idx_notas_fiscais_data  on public.notas_fiscais (data_emissao desc);

-- Trigger: limpa a chave, valida, preenche modelo/série/número, valor e usuário.
create or replace function public.fn_nota_preparar()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_venda public.vendas%rowtype;
  v_mod   smallint;
  v_ser   smallint;
  v_num   integer;
begin
  -- chave: aceita colada com espaços, pontos ou traços
  new.chave := nullif(regexp_replace(coalesce(new.chave, ''), '\D', '', 'g'), '');
  if new.chave is not null then
    if length(new.chave) <> 44 then
      raise exception 'A chave de acesso tem % números; precisa ter 44', length(new.chave) using errcode = '22023';
    end if;
    if not public.fn_chave_nfe_valida(new.chave) then
      raise exception 'Chave de acesso inválida: confira se foi digitada ou colada inteira' using errcode = '22023';
    end if;
    v_mod := substr(new.chave, 21, 2)::smallint;
    v_ser := substr(new.chave, 23, 3)::smallint;
    v_num := substr(new.chave, 26, 9)::integer;
    if v_mod not in (55, 65) then
      raise exception 'A chave não é de NF-e nem de NFC-e (modelo %)', v_mod using errcode = '22023';
    end if;
    if tg_op = 'INSERT' and new.modelo is null then new.modelo := v_mod; end if;
    if tg_op = 'INSERT' and new.numero is null then new.numero := v_num; end if;
    if new.serie is null then new.serie := v_ser; end if;
    if new.modelo <> v_mod or new.serie <> v_ser or new.numero <> v_num then
      raise exception 'A chave é da nota % série % (modelo %), mas foi informado nº % série %',
        v_num, v_ser, v_mod, new.numero, new.serie using errcode = '22023';
    end if;
  end if;

  new.serie := coalesce(new.serie, 1);  -- sem chave e sem série: série 1

  select * into v_venda from public.vendas where id = new.venda_id;
  if not found then
    raise exception 'Venda não encontrada' using errcode = '22023';
  end if;
  if tg_op = 'INSERT' and v_venda.status = 'cancelada' then
    raise exception 'Esta venda está cancelada; não dá para registrar nota nela' using errcode = '22023';
  end if;

  new.valor := coalesce(new.valor, v_venda.total);
  new.cpf_cnpj_destinatario := nullif(upper(regexp_replace(coalesce(new.cpf_cnpj_destinatario, ''), '[^0-9A-Za-z]', '', 'g')), '');
  new.obs := nullif(trim(coalesce(new.obs, '')), '');

  if new.situacao = 'cancelada' then
    if length(trim(coalesce(new.motivo_cancelamento, ''))) < 3 then
      raise exception 'Informe o motivo do cancelamento da nota' using errcode = '22023';
    end if;
    new.cancelada_em := coalesce(new.cancelada_em, now());
  elsif tg_op = 'UPDATE' and old.situacao = 'cancelada' then
    raise exception 'Nota cancelada não volta a ficar emitida; registre uma nota nova' using errcode = '22023';
  end if;

  if tg_op = 'INSERT' then
    new.usuario_id := coalesce(new.usuario_id, auth.uid());
  else
    new.updated_at := now();
  end if;
  return new;
end
$$;

-- O Postgres confere NOT NULL depois do trigger BEFORE: com a chave, modelo/série/número podem vir vazios.
create trigger trg_notas_fiscais_preparar
  before insert or update on public.notas_fiscais
  for each row execute function public.fn_nota_preparar();

-- ---------------------------------------------------------------------
-- 3. Editar dados "leves" de uma venda já registrada
-- ---------------------------------------------------------------------
-- p = { "cliente_id": uuid | null, "tipo_atendimento": "balcao|entrega|socorro",
--       "local_atendimento": "...", "obs": "..." }
-- Só altera as chaves que vierem no JSON. "cliente_id": null desvincula o cliente.
create or replace function public.atualizar_venda(p_venda_id uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user  uuid := public.fn_exigir_login();
  v_venda public.vendas%rowtype;
begin
  select * into v_venda from public.vendas where id = p_venda_id for update;
  if not found then
    raise exception 'Venda não encontrada' using errcode = '22023';
  end if;
  if p ? 'itens' or p ? 'pagamentos' or p ? 'total' or p ? 'desconto_informado' then
    raise exception 'Itens, valores e pagamentos não se editam: cancele a venda e registre de novo' using errcode = '22023';
  end if;

  if p ? 'cliente_id' then
    if p->>'cliente_id' is not null and not exists (select 1 from public.clientes where id = (p->>'cliente_id')::uuid) then
      raise exception 'Cliente não encontrado' using errcode = '22023';
    end if;
    v_venda.cliente_id := (p->>'cliente_id')::uuid;
  end if;
  if p ? 'tipo_atendimento' then
    if p->>'tipo_atendimento' not in ('balcao', 'entrega', 'socorro') then
      raise exception 'tipo_atendimento deve ser balcao, entrega ou socorro' using errcode = '22023';
    end if;
    v_venda.tipo_atendimento := p->>'tipo_atendimento';
  end if;
  if p ? 'local_atendimento' then
    v_venda.local_atendimento := nullif(trim(coalesce(p->>'local_atendimento', '')), '');
  end if;
  if p ? 'obs' then
    v_venda.obs := nullif(trim(coalesce(p->>'obs', '')), '');
  end if;

  update public.vendas
     set cliente_id = v_venda.cliente_id,
         tipo_atendimento = v_venda.tipo_atendimento,
         local_atendimento = v_venda.local_atendimento,
         obs = v_venda.obs
   where id = p_venda_id;

  return jsonb_build_object('id', p_venda_id, 'numero', v_venda.numero, 'editado_por', v_user);
end
$$;

-- ---------------------------------------------------------------------
-- 4. CPF/CNPJ do cliente: manter letras (CNPJ alfanumérico)
-- ---------------------------------------------------------------------
create or replace function public.fn_normalizar_cliente()
returns trigger
language plpgsql
as $$
begin
  new.nome     := trim(new.nome);
  new.telefone := nullif(regexp_replace(coalesce(new.telefone, ''), '\D', '', 'g'), '');
  new.cpf_cnpj := nullif(upper(regexp_replace(coalesce(new.cpf_cnpj, ''), '[^0-9A-Za-z]', '', 'g')), '');
  new.placa    := nullif(upper(regexp_replace(coalesce(new.placa, ''), '[^A-Za-z0-9]', '', 'g')), '');
  return new;
end
$$;

-- ---------------------------------------------------------------------
-- 5. Views
-- ---------------------------------------------------------------------
-- 5.1 Lista de vendas ganha a situação da nota (colunas novas no fim).
--     situacao_nota: pendente | emitida | cancelar_nota | nao_se_aplica
--       cancelar_nota = venda cancelada que ainda tem nota emitida → cancelar no Tiranota.
create or replace view public.vw_vendas_lista with (security_invoker = true) as
select v.id, v.numero, v.data_hora,
       (v.data_hora at time zone 'America/Fortaleza')::date as data_local,
       v.cliente_id, cl.nome as cliente_nome, cl.telefone as cliente_telefone,
       v.subtotal, v.desconto_total, v.total, v.sucata_recebida,
       v.tipo_atendimento, v.local_atendimento, v.status,
       v.motivo_cancelamento, v.obs,
       i.qtd_baterias, i.itens_resumo, i.cmv,
       round(v.total - i.cmv, 2)                           as lucro_bruto,
       coalesce(pg.taxas, 0)                               as taxas,
       round(v.total - i.cmv - coalesce(pg.taxas, 0), 2)   as lucro_liquido,
       pg.pagamentos_resumo,
       nf.id                                               as nota_id,
       nf.modelo                                           as nota_modelo,
       nf.serie                                            as nota_serie,
       nf.numero                                           as nota_numero,
       nf.chave                                            as nota_chave,
       case when nf.id is not null and v.status = 'cancelada' then 'cancelar_nota'
            when nf.id is not null then 'emitida'
            when v.status = 'cancelada' then 'nao_se_aplica'
            else 'pendente' end                            as situacao_nota
  from public.vendas v
  left join public.clientes cl on cl.id = v.cliente_id
  cross join lateral (
        select sum(vi.quantidade)                                         as qtd_baterias,
               string_agg(vi.quantidade || 'x ' || pr.modelo, ', ' order by pr.modelo) as itens_resumo,
               round(sum(vi.quantidade * vi.custo_unitario), 2)           as cmv
          from public.venda_itens vi
          join public.produtos pr on pr.id = vi.produto_id
         where vi.venda_id = v.id) i
  left join lateral (
        select sum(vp.valor_taxa) as taxas,
               string_agg(f.nome || case when vp.parcelas > 1 then ' ' || vp.parcelas || 'x' else '' end,
                          ' + ' order by vp.valor desc) as pagamentos_resumo
          from public.venda_pagamentos vp
          join public.formas_pagamento f on f.id = vp.forma_pagamento_id
         where vp.venda_id = v.id) pg on true
  left join public.notas_fiscais nf on nf.venda_id = v.id and nf.situacao = 'emitida';

-- 5.2 Notas registradas (histórico completo, inclusive canceladas)
create view public.vw_notas_fiscais with (security_invoker = true) as
select nf.id, nf.venda_id, v.numero as venda_numero, v.data_hora as venda_data_hora,
       v.status as venda_status, v.total as venda_total,
       cl.nome as cliente_nome,
       nf.modelo, case nf.modelo when 55 then 'NF-e' else 'NFC-e' end as modelo_nome,
       nf.serie, nf.numero, nf.chave, nf.data_emissao, nf.valor,
       nf.valor <> v.total as valor_diferente_da_venda,
       nf.cpf_cnpj_destinatario, nf.situacao, nf.motivo_cancelamento, nf.cancelada_em,
       nf.arquivo_path, nf.obs, nf.created_at
  from public.notas_fiscais nf
  join public.vendas v on v.id = nf.venda_id
  left join public.clientes cl on cl.id = v.cliente_id;

-- 5.3 Contadores para o alerta da tela Início
create view public.vw_resumo_notas with (security_invoker = true) as
select count(*) filter (where situacao_nota = 'pendente')      as vendas_sem_nota,
       coalesce(sum(total) filter (where situacao_nota = 'pendente'), 0) as valor_sem_nota,
       count(*) filter (where situacao_nota = 'cancelar_nota') as notas_para_cancelar
  from public.vw_vendas_lista;

-- ---------------------------------------------------------------------
-- 6. Segurança
-- ---------------------------------------------------------------------
alter table public.notas_fiscais enable row level security;
create policy acesso_autenticado on public.notas_fiscais for all to authenticated using (true) with check (true);

revoke all on public.notas_fiscais from anon, authenticated;
revoke all on public.vw_notas_fiscais, public.vw_resumo_notas from anon, authenticated;
grant select on public.notas_fiscais, public.vw_notas_fiscais, public.vw_resumo_notas, public.vw_vendas_lista to authenticated;
grant insert (venda_id, modelo, serie, numero, chave, data_emissao, valor, cpf_cnpj_destinatario, arquivo_path, obs)
      on public.notas_fiscais to authenticated;
grant update (modelo, serie, numero, chave, data_emissao, valor, cpf_cnpj_destinatario, arquivo_path, obs,
              situacao, motivo_cancelamento)
      on public.notas_fiscais to authenticated;
-- sem DELETE: nota errada se corrige (update) ou se cancela (situacao = 'cancelada')

revoke execute on function public.fn_chave_nfe_valida(text), public.fn_nota_preparar(),
       public.atualizar_venda(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.fn_chave_nfe_valida(text), public.atualizar_venda(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- 7. (Opcional) PDF da nota no Supabase Storage — rodar só no Supabase
-- ---------------------------------------------------------------------
-- insert into storage.buckets (id, name, public) values ('notas-fiscais', 'notas-fiscais', false)
--   on conflict (id) do nothing;
-- create policy notas_ler    on storage.objects for select to authenticated using (bucket_id = 'notas-fiscais');
-- create policy notas_gravar on storage.objects for insert to authenticated with check (bucket_id = 'notas-fiscais');
-- Caminho sugerido: notas-fiscais/<ano>/<numero-da-venda>-<numero-da-nota>.pdf → gravar em arquivo_path.

-- Fim da migração 002
