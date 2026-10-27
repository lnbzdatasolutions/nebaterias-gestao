-- =====================================================================
--  Sistema de Gestão · N E Baterias (Fortaleza-CE)
--  Projeto Supabase sugerido: nebaterias-gestao
--  Arquivo : supabase/schema.sql
--  Banco   : PostgreSQL 15+ (Supabase), schema "public"
--  Como usar: Supabase → SQL Editor → colar e rodar UMA vez, em projeto novo.
--             Depois rodar supabase/seed.sql.
--
--  Convenções
--    · Tabelas no plural, snake_case, em português (produtos, venda_itens).
--    · Chaves primárias: id uuid (gen_random_uuid()).
--    · Chave estrangeira: <tabela_no_singular>_id (produto_id, venda_id).
--    · Dinheiro: numeric(12,2). Custo unitário: numeric(12,4).
--    · Datas/horas: timestamptz em UTC; relatórios convertem para America/Fortaleza.
--    · Views: prefixo vw_. Funções internas: prefixo fn_.
--      Funções chamadas pelo app (RPC): verbo no infinitivo (registrar_venda).
--    · Vendas, compras e movimentos de estoque SÓ são gravados pelas funções
--      RPC. O app não tem permissão de INSERT/UPDATE direto nessas tabelas.
-- =====================================================================

create schema if not exists extensions;
create extension if not exists unaccent with schema extensions;
grant usage on schema extensions to authenticated;   -- no Supabase já vem liberado; aqui por garantia

-- ---------------------------------------------------------------------
-- 1. Funções utilitárias
-- ---------------------------------------------------------------------

-- Texto em minúsculas e sem acento, para busca ("Ônibus" → "onibus").
create or replace function public.fn_normalizar(t text)
returns text
language sql immutable parallel safe
set search_path = public, extensions
as $$
  select lower(extensions.unaccent('extensions.unaccent'::regdictionary, coalesce(t, '')))
$$;

-- Atualiza updated_at em toda alteração.
create or replace function public.fn_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

-- Garante que existe usuário logado; devolve o id dele.
create or replace function public.fn_exigir_login()
returns uuid
language plpgsql stable
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'Usuário não autenticado' using errcode = '42501';
  end if;
  return v_user;
end
$$;

-- Data "de hoje" no horário da loja.
create or replace function public.fn_hoje()
returns date
language sql stable
as $$
  select (now() at time zone 'America/Fortaleza')::date
$$;

-- ---------------------------------------------------------------------
-- 2. Tabelas de cadastro
-- ---------------------------------------------------------------------

-- 2.1 Configuração da loja (uma única linha, id = 1)
create table public.loja_config (
  id                     smallint primary key default 1 check (id = 1),
  nome_loja              text not null default 'Minha Loja de Baterias',
  telefone               text,
  endereco               text,
  instagram              text,
  site                   text,
  garantia_padrao_meses  smallint not null default 12
                         check (garantia_padrao_meses between 0 and 120),
  rodape_comprovante     text,
  updated_at             timestamptz not null default now()
);
comment on table public.loja_config is 'Dados da loja usados no comprovante e valores padrão. Sempre 1 linha (id = 1).';

-- 2.2 Produtos (baterias)
create table public.produtos (
  id                      uuid primary key default gen_random_uuid(),
  modelo                  text not null check (length(trim(modelo)) > 0),
  linha                   text not null,
  marca                   text not null default 'Moura',
  tipo_veiculo            text,
  aplicacoes              text,
  amperagem_ah            smallint check (amperagem_ah > 0),
  preco_venda             numeric(12,2) check (preco_venda >= 0),
  preco_venda_sem_sucata  numeric(12,2) check (preco_venda_sem_sucata >= 0),
  custo_medio             numeric(12,4) not null default 0 check (custo_medio >= 0),
  estoque_atual           integer not null default 0,
  estoque_minimo          integer not null default 1 check (estoque_minimo >= 0),
  garantia_meses          smallint check (garantia_meses between 0 and 120),
  ativo                   boolean not null default true,
  busca                   text generated always as (
                            public.fn_normalizar(
                              marca || ' ' || modelo || ' ' || linha || ' ' ||
                              coalesce(tipo_veiculo, '') || ' ' || coalesce(aplicacoes, ''))
                          ) stored,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint produtos_marca_modelo_uk unique (marca, modelo)
);
comment on table  public.produtos is 'Catálogo de baterias. estoque_atual e custo_medio são mantidos pelo banco (não editar pelo app).';
comment on column public.produtos.estoque_atual is 'Saldo atual. Atualizado pelo trigger de movimentos_estoque.';
comment on column public.produtos.custo_medio   is 'Custo médio ponderado. Recalculado a cada compra por registrar_compra().';
comment on column public.produtos.garantia_meses is 'Nulo = usa loja_config.garantia_padrao_meses.';
comment on column public.produtos.busca is 'Texto normalizado para busca por modelo, linha ou carro.';

-- 2.3 Fornecedores (revendedores Moura etc.)
create table public.fornecedores (
  id          uuid primary key default gen_random_uuid(),
  nome        text not null check (length(trim(nome)) > 0),
  telefone    text,
  cidade      text,
  obs         text,
  ativo       boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- 2.4 Clientes
create table public.clientes (
  id          uuid primary key default gen_random_uuid(),
  nome        text not null check (length(trim(nome)) > 0),
  telefone    text,          -- só dígitos, com DDD (normalizado pelo trigger)
  cpf_cnpj    text,          -- só dígitos (normalizado pelo trigger)
  veiculo     text,
  placa       text,          -- maiúsculas, sem hífen (normalizado pelo trigger)
  obs         text,
  busca       text generated always as (
                public.fn_normalizar(
                  nome || ' ' || coalesce(telefone, '') || ' ' ||
                  coalesce(placa, '') || ' ' || coalesce(veiculo, ''))
              ) stored,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create or replace function public.fn_normalizar_cliente()
returns trigger
language plpgsql
as $$
begin
  new.nome     := trim(new.nome);
  new.telefone := nullif(regexp_replace(coalesce(new.telefone, ''), '\D', '', 'g'), '');
  new.cpf_cnpj := nullif(regexp_replace(coalesce(new.cpf_cnpj, ''), '\D', '', 'g'), '');
  new.placa    := nullif(upper(regexp_replace(coalesce(new.placa, ''), '[^A-Za-z0-9]', '', 'g')), '');
  return new;
end
$$;

-- 2.5 Formas de pagamento
create table public.formas_pagamento (
  id                uuid primary key default gen_random_uuid(),
  nome              text not null unique,
  taxa_percentual   numeric(5,2) not null default 0 check (taxa_percentual between 0 and 100),
  permite_parcelas  boolean not null default false,
  ativo             boolean not null default true,
  ordem             smallint not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
comment on column public.formas_pagamento.taxa_percentual is 'Taxa da maquininha (%). Gravada em cada pagamento no momento da venda.';

-- ---------------------------------------------------------------------
-- 3. Tabelas de movimento (gravadas só pelas funções RPC)
-- ---------------------------------------------------------------------

-- 3.1 Compras (entradas de mercadoria)
create table public.compras (
  id                    uuid primary key default gen_random_uuid(),
  numero                bigint generated always as identity unique,
  fornecedor_id         uuid references public.fornecedores(id) on delete restrict,
  data_compra           date not null default ((now() at time zone 'America/Fortaleza')::date),
  numero_nota           text,
  valor_produtos        numeric(12,2) not null check (valor_produtos >= 0),
  frete                 numeric(12,2) not null default 0 check (frete >= 0),
  outros_custos         numeric(12,2) not null default 0 check (outros_custos >= 0),
  qtd_sucata_entregue   integer not null default 0 check (qtd_sucata_entregue >= 0),
  abatimento_sucata     numeric(12,2) not null default 0 check (abatimento_sucata >= 0),
  total                 numeric(12,2) not null check (total >= 0),
  status                text not null default 'concluida' check (status in ('concluida', 'cancelada')),
  obs                   text,
  motivo_cancelamento   text,
  cancelada_em          timestamptz,
  usuario_id            uuid references auth.users(id) on delete set null,
  created_at            timestamptz not null default now(),
  constraint compras_total_ck check (total = valor_produtos + frete + outros_custos - abatimento_sucata)
);
comment on column public.compras.valor_produtos is 'Soma de quantidade × (preço de tabela − desconto) dos itens.';
comment on column public.compras.total is 'Valor pago: valor_produtos + frete + outros_custos − abatimento_sucata.';

create table public.compra_itens (
  id                    uuid primary key default gen_random_uuid(),
  compra_id             uuid not null references public.compras(id) on delete restrict,
  produto_id            uuid not null references public.produtos(id) on delete restrict,
  quantidade            integer not null check (quantidade > 0),
  preco_tabela          numeric(12,2) not null check (preco_tabela >= 0),
  desconto_unitario     numeric(12,2) not null default 0 check (desconto_unitario >= 0),
  rateio_custos         numeric(12,2) not null default 0,
  rateio_abatimento     numeric(12,2) not null default 0,
  custo_unitario_final  numeric(12,4) not null check (custo_unitario_final >= 0),
  subtotal              numeric(12,2) not null check (subtotal >= 0),
  constraint compra_itens_desconto_ck check (desconto_unitario <= preco_tabela)
);
comment on column public.compra_itens.subtotal is 'Custo total da linha: qtd × (tabela − desconto) + rateio_custos − rateio_abatimento.';

-- 3.2 Vendas
create table public.vendas (
  id                   uuid primary key default gen_random_uuid(),
  numero               bigint generated always as identity unique,
  data_hora            timestamptz not null default now(),
  cliente_id           uuid references public.clientes(id) on delete restrict,
  subtotal             numeric(12,2) not null check (subtotal >= 0),
  desconto_tipo        text not null default 'valor' check (desconto_tipo in ('valor', 'percentual')),
  desconto_informado   numeric(12,2) not null default 0 check (desconto_informado >= 0),
  desconto_total       numeric(12,2) not null default 0,
  total                numeric(12,2) not null check (total >= 0),
  sucata_recebida      boolean not null default true,
  tipo_atendimento     text not null default 'balcao'
                       check (tipo_atendimento in ('balcao', 'entrega', 'socorro')),
  local_atendimento    text,
  status               text not null default 'concluida' check (status in ('concluida', 'cancelada')),
  obs                  text,
  motivo_cancelamento  text,
  cancelada_em         timestamptz,
  usuario_id           uuid references auth.users(id) on delete set null,
  created_at           timestamptz not null default now(),
  constraint vendas_desconto_ck check (desconto_total between 0 and subtotal),
  constraint vendas_total_ck    check (total = subtotal - desconto_total)
);
comment on column public.vendas.desconto_informado is 'O que foi digitado: R$ (tipo valor) ou % (tipo percentual).';
comment on column public.vendas.desconto_total     is 'Desconto efetivo em R$.';
comment on column public.vendas.tipo_atendimento   is 'balcao = na loja; entrega = levado e instalado no cliente; socorro = atendimento emergencial no local.';
comment on column public.vendas.local_atendimento  is 'Bairro ou endereço, quando entrega ou socorro.';

create table public.venda_itens (
  id                uuid primary key default gen_random_uuid(),
  venda_id          uuid not null references public.vendas(id) on delete restrict,
  produto_id        uuid not null references public.produtos(id) on delete restrict,
  quantidade        integer not null check (quantidade > 0),
  preco_unitario    numeric(12,2) not null check (preco_unitario >= 0),
  desconto_rateado  numeric(12,2) not null default 0 check (desconto_rateado >= 0),
  total_item        numeric(12,2) not null check (total_item >= 0),
  custo_unitario    numeric(12,4) not null check (custo_unitario >= 0),
  garantia_ate      date
);
comment on column public.venda_itens.custo_unitario is 'Custo médio do produto no instante da venda (foto). Base da margem histórica.';

create table public.venda_pagamentos (
  id                  uuid primary key default gen_random_uuid(),
  venda_id            uuid not null references public.vendas(id) on delete restrict,
  forma_pagamento_id  uuid not null references public.formas_pagamento(id) on delete restrict,
  valor               numeric(12,2) not null check (valor > 0),
  parcelas            smallint not null default 1 check (parcelas between 1 and 24),
  taxa_percentual     numeric(5,2) not null default 0,
  valor_taxa          numeric(12,2) not null default 0
);

-- 3.3 Movimentos de estoque (fonte única do saldo)
create table public.movimentos_estoque (
  id              uuid primary key default gen_random_uuid(),
  produto_id      uuid not null references public.produtos(id) on delete restrict,
  data_hora       timestamptz not null default now(),
  tipo            text not null check (tipo in ('ENTRADA', 'SAIDA', 'AJUSTE', 'ESTORNO')),
  quantidade      integer not null check (quantidade <> 0),
  custo_unitario  numeric(12,4),
  origem_tipo     text not null check (origem_tipo in ('compra', 'venda', 'ajuste')),
  origem_id       uuid,
  motivo          text,
  usuario_id      uuid references auth.users(id) on delete set null,
  constraint movimentos_sinal_ck check (
    (tipo = 'ENTRADA' and quantidade > 0) or
    (tipo = 'SAIDA'   and quantidade < 0) or
    (tipo in ('AJUSTE', 'ESTORNO'))
  )
);
comment on column public.movimentos_estoque.quantidade is 'Positiva = entra no estoque; negativa = sai.';

-- Trigger: todo movimento atualiza o saldo do produto.
create or replace function public.fn_aplicar_movimento()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.produtos
     set estoque_atual = estoque_atual + new.quantidade,
         updated_at    = now()
   where id = new.produto_id;
  return new;
end
$$;

-- ---------------------------------------------------------------------
-- 4. Triggers e índices
-- ---------------------------------------------------------------------
create trigger trg_loja_config_updated   before update on public.loja_config      for each row execute function public.fn_set_updated_at();
create trigger trg_produtos_updated      before update on public.produtos         for each row execute function public.fn_set_updated_at();
create trigger trg_fornecedores_updated  before update on public.fornecedores     for each row execute function public.fn_set_updated_at();
create trigger trg_clientes_updated      before update on public.clientes         for each row execute function public.fn_set_updated_at();
create trigger trg_formas_pag_updated    before update on public.formas_pagamento for each row execute function public.fn_set_updated_at();
create trigger trg_clientes_normalizar   before insert or update on public.clientes for each row execute function public.fn_normalizar_cliente();
create trigger trg_movimentos_aplicar    after insert on public.movimentos_estoque  for each row execute function public.fn_aplicar_movimento();

create index idx_produtos_ativo_linha     on public.produtos (ativo, linha);
create index idx_clientes_telefone        on public.clientes (telefone);
create index idx_clientes_placa           on public.clientes (placa);
create index idx_compras_data             on public.compras (data_compra desc);
create index idx_compras_fornecedor       on public.compras (fornecedor_id);
create index idx_compra_itens_compra      on public.compra_itens (compra_id);
create index idx_compra_itens_produto     on public.compra_itens (produto_id);
create index idx_vendas_data              on public.vendas (data_hora desc);
create index idx_vendas_cliente           on public.vendas (cliente_id);
create index idx_vendas_status_data       on public.vendas (status, data_hora);
create index idx_venda_itens_venda        on public.venda_itens (venda_id);
create index idx_venda_itens_produto      on public.venda_itens (produto_id);
create index idx_venda_pag_venda          on public.venda_pagamentos (venda_id);
create index idx_venda_pag_forma          on public.venda_pagamentos (forma_pagamento_id);
create index idx_movimentos_produto_data  on public.movimentos_estoque (produto_id, data_hora desc);
create index idx_movimentos_origem        on public.movimentos_estoque (origem_tipo, origem_id);

-- ---------------------------------------------------------------------
-- 5. Funções RPC de operação (chamadas pelo app com supabase.rpc)
-- ---------------------------------------------------------------------

-- 5.1 Registrar compra
-- p = {
--   "fornecedor_id": uuid | null,
--   "data_compra": "2026-10-27" (opcional, padrão hoje),
--   "numero_nota": "123" (opcional),
--   "frete": 0, "outros_custos": 0,
--   "qtd_sucata_entregue": 0, "abatimento_sucata": 0,
--   "obs": "...",
--   "itens": [ { "produto_id": uuid, "quantidade": 2,
--                "preco_tabela": 320.00, "desconto_unitario": 20.00 } ]
-- }
create or replace function public.registrar_compra(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user           uuid := public.fn_exigir_login();
  v_frete          numeric := coalesce((p->>'frete')::numeric, 0);
  v_outros         numeric := coalesce((p->>'outros_custos')::numeric, 0);
  v_abat           numeric := coalesce((p->>'abatimento_sucata')::numeric, 0);
  v_qtd_sucata     integer := coalesce((p->>'qtd_sucata_entregue')::integer, 0);
  v_data           date    := coalesce((p->>'data_compra')::date, public.fn_hoje());
  v_custos         numeric;
  v_valor_produtos numeric := 0;
  v_base_total     numeric := 0;
  v_qtd_total      integer := 0;
  v_n              integer;
  v_i              integer := 0;
  v_rc_acum        numeric := 0;
  v_ra_acum        numeric := 0;
  v_compra_id      uuid;
  v_numero         bigint;
  v_total          numeric;
  it               record;
  v_base           numeric;
  v_rc             numeric;
  v_ra             numeric;
  v_linha          numeric;
  v_custo_final    numeric;
  v_prod           public.produtos%rowtype;
  v_novo_cm        numeric;
begin
  if jsonb_typeof(p->'itens') is distinct from 'array' or jsonb_array_length(p->'itens') = 0 then
    raise exception 'A compra precisa de pelo menos 1 item' using errcode = '22023';
  end if;
  if v_frete < 0 or v_outros < 0 or v_abat < 0 or v_qtd_sucata < 0 then
    raise exception 'Frete, outros custos e abatimento não podem ser negativos' using errcode = '22023';
  end if;
  if v_data > public.fn_hoje() then
    raise exception 'A data da compra não pode ser futura' using errcode = '22023';
  end if;
  if p->>'fornecedor_id' is not null
     and not exists (select 1 from public.fornecedores where id = (p->>'fornecedor_id')::uuid) then
    raise exception 'Fornecedor não encontrado' using errcode = '22023';
  end if;

  -- 1ª passada: validar itens e somar a base do rateio
  for it in
    select x.produto_id, x.quantidade, x.preco_tabela, coalesce(x.desconto_unitario, 0) as desconto_unitario
      from jsonb_to_recordset(p->'itens')
           as x(produto_id uuid, quantidade integer, preco_tabela numeric, desconto_unitario numeric)
  loop
    if it.produto_id is null or not exists (select 1 from public.produtos where id = it.produto_id) then
      raise exception 'Produto não encontrado em um dos itens' using errcode = '22023';
    end if;
    if coalesce(it.quantidade, 0) <= 0 then
      raise exception 'Quantidade deve ser maior que zero' using errcode = '22023';
    end if;
    if coalesce(it.preco_tabela, -1) < 0 or it.desconto_unitario < 0 or it.desconto_unitario > it.preco_tabela then
      raise exception 'Preço de tabela ou desconto inválido' using errcode = '22023';
    end if;
    v_valor_produtos := v_valor_produtos + it.quantidade * (it.preco_tabela - it.desconto_unitario);
    v_qtd_total      := v_qtd_total + it.quantidade;
  end loop;

  v_valor_produtos := round(v_valor_produtos, 2);
  v_custos         := v_frete + v_outros;
  v_total          := v_valor_produtos + v_custos - v_abat;
  if v_total < 0 then
    raise exception 'O abatimento de sucata é maior que o valor da compra' using errcode = '22023';
  end if;

  -- base do rateio: valor de cada linha; se tudo for zero, rateia por quantidade
  v_base_total := case when v_valor_produtos > 0 then v_valor_produtos else v_qtd_total end;
  v_n := jsonb_array_length(p->'itens');

  insert into public.compras (fornecedor_id, data_compra, numero_nota, valor_produtos, frete,
                              outros_custos, qtd_sucata_entregue, abatimento_sucata, total, obs, usuario_id)
  values ((p->>'fornecedor_id')::uuid, v_data, nullif(trim(p->>'numero_nota'), ''), v_valor_produtos,
          v_frete, v_outros, v_qtd_sucata, v_abat, v_total, nullif(trim(p->>'obs'), ''), v_user)
  returning id, numero into v_compra_id, v_numero;

  -- 2ª passada: rateio, custo final, custo médio e movimento
  for it in
    select (e.item->>'produto_id')::uuid                       as produto_id,
           (e.item->>'quantidade')::integer                    as quantidade,
           (e.item->>'preco_tabela')::numeric                  as preco_tabela,
           coalesce((e.item->>'desconto_unitario')::numeric, 0) as desconto_unitario
      from jsonb_array_elements(p->'itens') with ordinality as e(item, ord)
     order by e.ord
  loop
    v_i    := v_i + 1;
    v_base := case when v_valor_produtos > 0
                   then it.quantidade * (it.preco_tabela - it.desconto_unitario)
                   else it.quantidade end;
    if v_i < v_n then
      v_rc := round(v_custos * v_base / v_base_total, 2);
      v_ra := round(v_abat   * v_base / v_base_total, 2);
    else  -- última linha recebe o resto, para a soma fechar exata
      v_rc := v_custos - v_rc_acum;
      v_ra := v_abat   - v_ra_acum;
    end if;
    v_rc_acum := v_rc_acum + v_rc;
    v_ra_acum := v_ra_acum + v_ra;

    v_linha := it.quantidade * (it.preco_tabela - it.desconto_unitario) + v_rc - v_ra;
    if v_linha < 0 then
      raise exception 'O abatimento deixou o custo de um item negativo' using errcode = '22023';
    end if;
    v_custo_final := round(v_linha / it.quantidade, 4);

    insert into public.compra_itens (compra_id, produto_id, quantidade, preco_tabela, desconto_unitario,
                                     rateio_custos, rateio_abatimento, custo_unitario_final, subtotal)
    values (v_compra_id, it.produto_id, it.quantidade, it.preco_tabela, it.desconto_unitario,
            v_rc, v_ra, v_custo_final, round(v_linha, 2));

    -- custo médio ponderado (com o saldo ANTES desta entrada)
    select * into v_prod from public.produtos where id = it.produto_id for update;
    if v_prod.estoque_atual <= 0 then
      v_novo_cm := v_custo_final;
    else
      v_novo_cm := round((v_prod.estoque_atual * v_prod.custo_medio + it.quantidade * v_custo_final)
                         / (v_prod.estoque_atual + it.quantidade), 4);
    end if;
    update public.produtos set custo_medio = v_novo_cm where id = it.produto_id;

    insert into public.movimentos_estoque (produto_id, tipo, quantidade, custo_unitario,
                                           origem_tipo, origem_id, usuario_id)
    values (it.produto_id, 'ENTRADA', it.quantidade, v_custo_final, 'compra', v_compra_id, v_user);
  end loop;

  return jsonb_build_object('id', v_compra_id, 'numero', v_numero, 'total', v_total);
end
$$;

-- 5.2 Registrar venda
-- p = {
--   "cliente_id": uuid | null,
--   "data_hora": "2026-10-27T14:30:00-03:00" (opcional, padrão agora),
--   "desconto_tipo": "valor" | "percentual",
--   "desconto_informado": 10,
--   "sucata_recebida": true,
--   "tipo_atendimento": "balcao" | "entrega" | "socorro",
--   "local_atendimento": "Aldeota" (opcional),
--   "obs": "...",
--   "itens": [ { "produto_id": uuid, "quantidade": 1, "preco_unitario": 450.00 } ],
--   "pagamentos": [ { "forma_pagamento_id": uuid, "valor": 405.00, "parcelas": 1 } ]
-- }
-- p_permitir_estoque_negativo: false na 1ª tentativa. Se faltar estoque, a função
-- devolve erro 'ESTOQUE_INSUFICIENTE' (detalhe em error.details). O app pergunta
-- ao usuário e, se ele confirmar, chama de novo com true.
create or replace function public.registrar_venda(p jsonb, p_permitir_estoque_negativo boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user        uuid := public.fn_exigir_login();
  v_data_hora   timestamptz := coalesce((p->>'data_hora')::timestamptz, now());
  v_tipo        text := coalesce(p->>'desconto_tipo', 'valor');
  v_informado   numeric := coalesce((p->>'desconto_informado')::numeric, 0);
  v_cliente     uuid := (p->>'cliente_id')::uuid;
  v_atend       text := coalesce(p->>'tipo_atendimento', 'balcao');
  v_subtotal    numeric := 0;
  v_desconto    numeric;
  v_total       numeric;
  v_soma_pag    numeric := 0;
  v_n           integer;
  v_i           integer := 0;
  v_desc_acum   numeric := 0;
  v_venda_id    uuid;
  v_numero      bigint;
  v_cmv         numeric := 0;
  v_garantia_pd smallint;
  v_faltas      jsonb;
  it            record;
  pg            record;
  v_prod        public.produtos%rowtype;
  v_forma       public.formas_pagamento%rowtype;
  v_bruto       numeric;
  v_desc_item   numeric;
begin
  if jsonb_typeof(p->'itens') is distinct from 'array' or jsonb_array_length(p->'itens') = 0 then
    raise exception 'A venda precisa de pelo menos 1 item' using errcode = '22023';
  end if;
  if v_tipo not in ('valor', 'percentual') then
    raise exception 'desconto_tipo deve ser "valor" ou "percentual"' using errcode = '22023';
  end if;
  if v_atend not in ('balcao', 'entrega', 'socorro') then
    raise exception 'tipo_atendimento deve ser balcao, entrega ou socorro' using errcode = '22023';
  end if;
  if v_data_hora > now() + interval '5 minutes' then
    raise exception 'A data da venda não pode ser futura' using errcode = '22023';
  end if;
  if v_cliente is not null and not exists (select 1 from public.clientes where id = v_cliente) then
    raise exception 'Cliente não encontrado' using errcode = '22023';
  end if;

  -- validar itens e calcular subtotal
  for it in
    select x.produto_id, x.quantidade, x.preco_unitario
      from jsonb_to_recordset(p->'itens') as x(produto_id uuid, quantidade integer, preco_unitario numeric)
  loop
    if it.produto_id is null or not exists (select 1 from public.produtos where id = it.produto_id and ativo) then
      raise exception 'Produto não encontrado ou inativo em um dos itens' using errcode = '22023';
    end if;
    if coalesce(it.quantidade, 0) <= 0 then
      raise exception 'Quantidade deve ser maior que zero' using errcode = '22023';
    end if;
    if coalesce(it.preco_unitario, -1) < 0 then
      raise exception 'Preço unitário inválido' using errcode = '22023';
    end if;
    v_subtotal := v_subtotal + it.quantidade * it.preco_unitario;
  end loop;
  v_subtotal := round(v_subtotal, 2);

  -- desconto
  if v_informado < 0 then
    raise exception 'Desconto não pode ser negativo' using errcode = '22023';
  end if;
  if v_tipo = 'percentual' then
    if v_informado > 100 then
      raise exception 'Desconto percentual acima de 100%%' using errcode = '22023';
    end if;
    v_desconto := round(v_subtotal * v_informado / 100, 2);
  else
    v_desconto := round(v_informado, 2);
  end if;
  if v_desconto > v_subtotal then
    raise exception 'Desconto maior que o valor da venda' using errcode = '22023';
  end if;
  v_total := v_subtotal - v_desconto;

  -- pagamentos: soma deve fechar com o total
  if v_total > 0 and (jsonb_typeof(p->'pagamentos') is distinct from 'array' or jsonb_array_length(p->'pagamentos') = 0) then
    raise exception 'Informe a forma de pagamento' using errcode = '22023';
  end if;
  for pg in
    select x.forma_pagamento_id, x.valor, coalesce(x.parcelas, 1) as parcelas
      from jsonb_to_recordset(coalesce(p->'pagamentos', '[]'::jsonb))
           as x(forma_pagamento_id uuid, valor numeric, parcelas integer)
  loop
    select * into v_forma from public.formas_pagamento where id = pg.forma_pagamento_id and ativo;
    if not found then
      raise exception 'Forma de pagamento não encontrada ou inativa' using errcode = '22023';
    end if;
    if coalesce(pg.valor, 0) <= 0 then
      raise exception 'Valor de pagamento deve ser maior que zero' using errcode = '22023';
    end if;
    if pg.parcelas < 1 or pg.parcelas > 24 or (pg.parcelas > 1 and not v_forma.permite_parcelas) then
      raise exception 'Parcelamento inválido para %', v_forma.nome using errcode = '22023';
    end if;
    v_soma_pag := v_soma_pag + pg.valor;
  end loop;
  if round(v_soma_pag, 2) <> v_total then
    raise exception 'A soma dos pagamentos (R$ %) é diferente do total da venda (R$ %)',
      replace(to_char(v_soma_pag, 'FM999999990.00'), '.', ','),
      replace(to_char(v_total, 'FM999999990.00'), '.', ',')
      using errcode = '22023';
  end if;

  -- estoque: trava os produtos e confere saldo
  perform 1 from public.produtos
   where id in (select (e->>'produto_id')::uuid from jsonb_array_elements(p->'itens') e)
   order by id
   for update;

  select jsonb_agg(jsonb_build_object('produto_id', pr.id, 'modelo', pr.modelo,
                                      'estoque_atual', pr.estoque_atual, 'quantidade_pedida', q.qtd))
    into v_faltas
    from (select (e->>'produto_id')::uuid as produto_id, sum((e->>'quantidade')::integer) as qtd
            from jsonb_array_elements(p->'itens') e group by 1) q
    join public.produtos pr on pr.id = q.produto_id
   where pr.estoque_atual < q.qtd;

  if v_faltas is not null and not p_permitir_estoque_negativo then
    raise exception 'ESTOQUE_INSUFICIENTE' using errcode = 'P0001', detail = v_faltas::text,
      hint = 'Confirme com o usuário e chame de novo com p_permitir_estoque_negativo = true';
  end if;

  select garantia_padrao_meses into v_garantia_pd from public.loja_config where id = 1;

  insert into public.vendas (data_hora, cliente_id, subtotal, desconto_tipo, desconto_informado,
                             desconto_total, total, sucata_recebida, tipo_atendimento,
                             local_atendimento, obs, usuario_id)
  values (v_data_hora, v_cliente, v_subtotal, v_tipo, v_informado, v_desconto, v_total,
          coalesce((p->>'sucata_recebida')::boolean, true), v_atend,
          nullif(trim(p->>'local_atendimento'), ''), nullif(trim(p->>'obs'), ''), v_user)
  returning id, numero into v_venda_id, v_numero;

  -- itens: rateio do desconto proporcional ao valor de cada linha
  v_n := jsonb_array_length(p->'itens');
  for it in
    select (e.item->>'produto_id')::uuid        as produto_id,
           (e.item->>'quantidade')::integer     as quantidade,
           (e.item->>'preco_unitario')::numeric as preco_unitario
      from jsonb_array_elements(p->'itens') with ordinality as e(item, ord)
     order by e.ord
  loop
    v_i := v_i + 1;
    v_bruto := round(it.quantidade * it.preco_unitario, 2);
    if v_i < v_n then
      v_desc_item := case when v_subtotal > 0 then round(v_desconto * v_bruto / v_subtotal, 2) else 0 end;
    else
      v_desc_item := v_desconto - v_desc_acum;
    end if;
    v_desc_acum := v_desc_acum + v_desc_item;

    select * into v_prod from public.produtos where id = it.produto_id;

    insert into public.venda_itens (venda_id, produto_id, quantidade, preco_unitario, desconto_rateado,
                                    total_item, custo_unitario, garantia_ate)
    values (v_venda_id, it.produto_id, it.quantidade, it.preco_unitario, v_desc_item,
            v_bruto - v_desc_item, v_prod.custo_medio,
            ((v_data_hora at time zone 'America/Fortaleza')::date
               + make_interval(months => coalesce(v_prod.garantia_meses, v_garantia_pd)))::date);

    v_cmv := v_cmv + it.quantidade * v_prod.custo_medio;

    insert into public.movimentos_estoque (produto_id, data_hora, tipo, quantidade, custo_unitario,
                                           origem_tipo, origem_id, usuario_id)
    values (it.produto_id, v_data_hora, 'SAIDA', -it.quantidade, v_prod.custo_medio, 'venda', v_venda_id, v_user);
  end loop;

  -- pagamentos com a taxa do momento
  insert into public.venda_pagamentos (venda_id, forma_pagamento_id, valor, parcelas, taxa_percentual, valor_taxa)
  select v_venda_id, x.forma_pagamento_id, x.valor, coalesce(x.parcelas, 1), f.taxa_percentual,
         round(x.valor * f.taxa_percentual / 100, 2)
    from jsonb_to_recordset(coalesce(p->'pagamentos', '[]'::jsonb))
         as x(forma_pagamento_id uuid, valor numeric, parcelas integer)
    join public.formas_pagamento f on f.id = x.forma_pagamento_id;

  return jsonb_build_object('id', v_venda_id, 'numero', v_numero, 'total', v_total,
                            'lucro_bruto', round(v_total - v_cmv, 2),
                            'estoque_negativo', v_faltas is not null);
end
$$;

-- 5.3 Cancelar venda (devolve o estoque)
create or replace function public.cancelar_venda(p_venda_id uuid, p_motivo text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user   uuid := public.fn_exigir_login();
  v_status text;
  v_numero bigint;
begin
  if length(trim(coalesce(p_motivo, ''))) < 3 then
    raise exception 'Informe o motivo do cancelamento' using errcode = '22023';
  end if;
  select status, numero into v_status, v_numero from public.vendas where id = p_venda_id for update;
  if not found then
    raise exception 'Venda não encontrada' using errcode = '22023';
  end if;
  if v_status = 'cancelada' then
    raise exception 'Esta venda já está cancelada' using errcode = '22023';
  end if;

  update public.vendas
     set status = 'cancelada', motivo_cancelamento = trim(p_motivo), cancelada_em = now()
   where id = p_venda_id;

  insert into public.movimentos_estoque (produto_id, tipo, quantidade, custo_unitario, origem_tipo,
                                         origem_id, motivo, usuario_id)
  select vi.produto_id, 'ESTORNO', vi.quantidade, vi.custo_unitario, 'venda', p_venda_id,
         'Cancelamento da venda nº ' || v_numero, v_user
    from public.venda_itens vi
   where vi.venda_id = p_venda_id;

  return jsonb_build_object('id', p_venda_id, 'numero', v_numero, 'status', 'cancelada');
end
$$;

-- 5.4 Cancelar compra (retira do estoque; não recalcula o custo médio)
create or replace function public.cancelar_compra(p_compra_id uuid, p_motivo text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user   uuid := public.fn_exigir_login();
  v_status text;
  v_numero bigint;
begin
  if length(trim(coalesce(p_motivo, ''))) < 3 then
    raise exception 'Informe o motivo do cancelamento' using errcode = '22023';
  end if;
  select status, numero into v_status, v_numero from public.compras where id = p_compra_id for update;
  if not found then
    raise exception 'Compra não encontrada' using errcode = '22023';
  end if;
  if v_status = 'cancelada' then
    raise exception 'Esta compra já está cancelada' using errcode = '22023';
  end if;

  update public.compras
     set status = 'cancelada', motivo_cancelamento = trim(p_motivo), cancelada_em = now()
   where id = p_compra_id;

  insert into public.movimentos_estoque (produto_id, tipo, quantidade, custo_unitario, origem_tipo,
                                         origem_id, motivo, usuario_id)
  select ci.produto_id, 'ESTORNO', -ci.quantidade, ci.custo_unitario_final, 'compra', p_compra_id,
         'Cancelamento da compra nº ' || v_numero, v_user
    from public.compra_itens ci
   where ci.compra_id = p_compra_id;

  return jsonb_build_object('id', p_compra_id, 'numero', v_numero, 'status', 'cancelada');
end
$$;

-- 5.5 Ajuste manual de estoque (contagem, garantia/troca, avaria...)
-- p_quantidade: diferença a aplicar (+2 entra, -1 sai).
create or replace function public.ajustar_estoque(p_produto_id uuid, p_quantidade integer, p_motivo text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user  uuid := public.fn_exigir_login();
  v_prod  public.produtos%rowtype;
begin
  if coalesce(p_quantidade, 0) = 0 then
    raise exception 'Informe uma quantidade diferente de zero' using errcode = '22023';
  end if;
  if length(trim(coalesce(p_motivo, ''))) < 3 then
    raise exception 'Informe o motivo do ajuste' using errcode = '22023';
  end if;
  select * into v_prod from public.produtos where id = p_produto_id for update;
  if not found then
    raise exception 'Produto não encontrado' using errcode = '22023';
  end if;

  insert into public.movimentos_estoque (produto_id, tipo, quantidade, custo_unitario, origem_tipo, motivo, usuario_id)
  values (p_produto_id, 'AJUSTE', p_quantidade, v_prod.custo_medio, 'ajuste', trim(p_motivo), v_user);

  return jsonb_build_object('produto_id', p_produto_id,
                            'estoque_anterior', v_prod.estoque_atual,
                            'estoque_atual', v_prod.estoque_atual + p_quantidade);
end
$$;

-- 5.6 Ping (usado pela rotina agendada que evita a pausa do plano Free)
create or replace function public.ping()
returns text
language sql
security definer
set search_path = public
as $$
  select 'ok ' || to_char(now() at time zone 'America/Fortaleza', 'YYYY-MM-DD HH24:MI')
$$;

-- ---------------------------------------------------------------------
-- 6. Views (todas com security_invoker: respeitam o RLS de quem consulta)
-- ---------------------------------------------------------------------

-- 6.1 Produtos com indicadores de estoque e preço (tela Estoque)
create view public.vw_produtos_estoque with (security_invoker = true) as
select p.id, p.modelo, p.linha, p.marca, p.tipo_veiculo, p.aplicacoes, p.amperagem_ah,
       p.preco_venda, p.preco_venda_sem_sucata,
       round(p.custo_medio, 2)                                         as custo_medio,
       p.estoque_atual, p.estoque_minimo,
       p.estoque_atual <= p.estoque_minimo                             as abaixo_minimo,
       coalesce(p.garantia_meses, c.garantia_padrao_meses)             as garantia_meses,
       case when p.custo_medio > 0 and p.preco_venda is not null
            then round((p.preco_venda / p.custo_medio - 1) * 100, 1) end as markup_pct,
       case when p.preco_venda > 0
            then round((p.preco_venda - p.custo_medio) / p.preco_venda * 100, 1) end as margem_pct,
       round(greatest(p.estoque_atual, 0) * p.custo_medio, 2)          as valor_estoque_custo,
       p.ativo, p.busca, p.updated_at
  from public.produtos p
  left join public.loja_config c on c.id = 1;

-- 6.2 Estoque baixo (alerta na tela Início e no Painel)
create view public.vw_estoque_baixo with (security_invoker = true) as
select id, modelo, linha, aplicacoes, estoque_atual, estoque_minimo, preco_venda
  from public.vw_produtos_estoque
 where ativo and abaixo_minimo
 order by estoque_atual, modelo;

-- 6.3 Valor do estoque (1 linha)
create view public.vw_valor_estoque with (security_invoker = true) as
select coalesce(sum(greatest(estoque_atual, 0)), 0)                              as unidades,
       coalesce(round(sum(greatest(estoque_atual, 0) * custo_medio), 2), 0)      as valor_custo,
       coalesce(round(sum(greatest(estoque_atual, 0) * coalesce(preco_venda, 0)), 2), 0) as valor_venda_potencial
  from public.produtos
 where ativo;

-- 6.4 Lista de vendas (Histórico, Início, histórico do cliente)
create view public.vw_vendas_lista with (security_invoker = true) as
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
       pg.pagamentos_resumo
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
         where vp.venda_id = v.id) pg on true;

-- 6.5 Itens vendidos com custo e lucro (análises, exportação, garantia por cliente)
create view public.vw_venda_itens_detalhe with (security_invoker = true) as
select vi.id, vi.venda_id, v.numero as venda_numero, v.data_hora,
       (v.data_hora at time zone 'America/Fortaleza')::date as data_local,
       v.status, v.cliente_id, cl.nome as cliente_nome,
       vi.produto_id, pr.modelo, pr.linha, pr.marca,
       vi.quantidade, vi.preco_unitario, vi.desconto_rateado, vi.total_item,
       round(vi.custo_unitario, 2)                                   as custo_unitario,
       round(vi.quantidade * vi.custo_unitario, 2)                   as custo_total,
       round(vi.total_item - vi.quantidade * vi.custo_unitario, 2)   as lucro_bruto,
       vi.garantia_ate
  from public.venda_itens vi
  join public.vendas v       on v.id = vi.venda_id
  join public.produtos pr    on pr.id = vi.produto_id
  left join public.clientes cl on cl.id = v.cliente_id;

-- 6.6 Lista de compras (Histórico de entradas)
create view public.vw_compras_lista with (security_invoker = true) as
select c.id, c.numero, c.data_compra, c.fornecedor_id, f.nome as fornecedor_nome,
       c.numero_nota, c.valor_produtos, c.frete, c.outros_custos, c.abatimento_sucata,
       c.total, c.status, c.motivo_cancelamento, c.obs,
       i.qtd_baterias, i.itens_resumo
  from public.compras c
  left join public.fornecedores f on f.id = c.fornecedor_id
  cross join lateral (
        select sum(ci.quantidade) as qtd_baterias,
               string_agg(ci.quantidade || 'x ' || pr.modelo, ', ' order by pr.modelo) as itens_resumo
          from public.compra_itens ci
          join public.produtos pr on pr.id = ci.produto_id
         where ci.compra_id = c.id) i;

-- 6.6b Último preço pago por produto (pré-preenche a tela Entrada)
create view public.vw_ultima_compra_produto with (security_invoker = true) as
select distinct on (ci.produto_id)
       ci.produto_id, c.data_compra, c.fornecedor_id, ci.preco_tabela, ci.desconto_unitario,
       round(ci.custo_unitario_final, 2) as custo_unitario_final
  from public.compra_itens ci
  join public.compras c on c.id = ci.compra_id
 where c.status = 'concluida'
 order by ci.produto_id, c.data_compra desc, c.numero desc;

-- 6.7 Movimentos com descrição legível (detalhe do produto)
create view public.vw_movimentos_detalhe with (security_invoker = true) as
select m.id, m.produto_id, pr.modelo, m.data_hora,
       (m.data_hora at time zone 'America/Fortaleza')::date as data_local,
       m.tipo, m.quantidade, round(m.custo_unitario, 2) as custo_unitario,
       m.origem_tipo, m.origem_id,
       case m.origem_tipo
            when 'venda'  then 'Venda nº '  || v.numero
            when 'compra' then 'Compra nº ' || c.numero
            else 'Ajuste' end
         || coalesce(' · ' || m.motivo, '')            as descricao
  from public.movimentos_estoque m
  join public.produtos pr     on pr.id = m.produto_id
  left join public.vendas v   on m.origem_tipo = 'venda'  and v.id = m.origem_id
  left join public.compras c  on m.origem_tipo = 'compra' and c.id = m.origem_id;

-- 6.8 Resumo mensal (gráfico de 12 meses e "melhor mês")
create view public.vw_resumo_mensal with (security_invoker = true) as
with v as (
  select date_trunc('month', (data_hora at time zone 'America/Fortaleza'))::date as mes,
         id, total, desconto_total, subtotal
    from public.vendas
   where status = 'concluida'
), itens as (
  select v.mes, sum(vi.quantidade) as qtd, sum(vi.quantidade * vi.custo_unitario) as cmv
    from v join public.venda_itens vi on vi.venda_id = v.id
   group by v.mes
), taxas as (
  select v.mes, sum(vp.valor_taxa) as taxas
    from v join public.venda_pagamentos vp on vp.venda_id = v.id
   group by v.mes
), cab as (
  select mes, count(*) as qtd_vendas, sum(total) as faturamento,
         sum(desconto_total) as descontos, sum(subtotal) as bruto
    from v group by mes
)
select cab.mes,
       to_char(cab.mes, 'YYYY-MM')                                        as ano_mes,
       cab.qtd_vendas,
       coalesce(itens.qtd, 0)                                             as qtd_baterias,
       cab.faturamento,
       round(coalesce(itens.cmv, 0), 2)                                   as cmv,
       round(cab.faturamento - coalesce(itens.cmv, 0), 2)                 as lucro_bruto,
       coalesce(taxas.taxas, 0)                                           as taxas,
       round(cab.faturamento - coalesce(itens.cmv, 0) - coalesce(taxas.taxas, 0), 2) as lucro_liquido,
       round(cab.faturamento / nullif(cab.qtd_vendas, 0), 2)              as ticket_medio,
       cab.descontos,
       round((cab.faturamento - coalesce(itens.cmv, 0)) / nullif(cab.faturamento, 0) * 100, 1) as margem_pct,
       round((cab.faturamento / nullif(itens.cmv, 0) - 1) * 100, 1)       as markup_pct
  from cab
  left join itens using (mes)
  left join taxas using (mes);

-- ---------------------------------------------------------------------
-- 7. Funções de consulta (painel e buscas) — security invoker
-- ---------------------------------------------------------------------

-- 7.1 Busca de produtos por modelo, linha ou carro. Todas as palavras precisam aparecer.
create or replace function public.buscar_produtos(p_termo text default null,
                                                  p_linha text default null,
                                                  p_somente_ativos boolean default true,
                                                  p_limite integer default 20)
returns setof public.vw_produtos_estoque
language sql stable
set search_path = public, extensions
as $$
  select vp.*
    from public.vw_produtos_estoque vp
   where (not p_somente_ativos or vp.ativo)
     and (p_linha is null or vp.linha = p_linha)
     and not exists (
           select 1
             from unnest(string_to_array(public.fn_normalizar(trim(coalesce(p_termo, ''))), ' ')) w
            where w <> '' and vp.busca not like '%' || w || '%')
   order by
     (public.fn_normalizar(vp.modelo) like public.fn_normalizar(trim(coalesce(p_termo, ''))) || '%') desc,
     (vp.estoque_atual > 0) desc,
     vp.modelo
   limit greatest(coalesce(p_limite, 20), 1)
$$;

-- 7.2 Busca de clientes por nome, telefone, placa ou veículo
create or replace function public.buscar_clientes(p_termo text, p_limite integer default 10)
returns setof public.clientes
language sql stable
set search_path = public, extensions
as $$
  select c.*
    from public.clientes c
   where not exists (
           select 1
             from unnest(string_to_array(
                    public.fn_normalizar(regexp_replace(trim(coalesce(p_termo, '')), '[-.()]', '', 'g')), ' ')) w
            where w <> '' and c.busca not like '%' || w || '%')
   order by c.nome
   limit greatest(coalesce(p_limite, 10), 1)
$$;

-- 7.3 Indicadores do período (cartões do Painel e da tela Início)
create or replace function public.painel_indicadores(p_inicio date, p_fim date)
returns table (
  faturamento numeric, cmv numeric, lucro_bruto numeric, taxas numeric, lucro_liquido numeric,
  margem_pct numeric, markup_pct numeric, qtd_vendas bigint, qtd_baterias bigint,
  ticket_medio numeric, descontos numeric, desconto_pct numeric
)
language sql stable
set search_path = public
as $$
  with v as (
    select id, total, subtotal, desconto_total
      from public.vendas
     where status = 'concluida'
       and (data_hora at time zone 'America/Fortaleza')::date between p_inicio and p_fim
  ), i as (
    select coalesce(sum(vi.quantidade), 0) as qtd, coalesce(sum(vi.quantidade * vi.custo_unitario), 0) as cmv
      from v join public.venda_itens vi on vi.venda_id = v.id
  ), t as (
    select coalesce(sum(vp.valor_taxa), 0) as taxas
      from v join public.venda_pagamentos vp on vp.venda_id = v.id
  ), c as (
    select count(*) as n, coalesce(sum(total), 0) as fat,
           coalesce(sum(desconto_total), 0) as desc_, coalesce(sum(subtotal), 0) as bruto
      from v
  )
  select c.fat,
         round(i.cmv, 2),
         round(c.fat - i.cmv, 2),
         t.taxas,
         round(c.fat - i.cmv - t.taxas, 2),
         round((c.fat - i.cmv) / nullif(c.fat, 0) * 100, 1),
         round((c.fat / nullif(i.cmv, 0) - 1) * 100, 1),
         c.n,
         i.qtd,
         round(c.fat / nullif(c.n, 0), 2),
         c.desc_,
         round(c.desc_ / nullif(c.bruto, 0) * 100, 1)
    from c, i, t
$$;

-- 7.4 Vendas por forma de pagamento
create or replace function public.painel_por_forma_pagamento(p_inicio date, p_fim date)
returns table (forma_pagamento text, qtd_vendas bigint, valor numeric, taxas numeric, participacao_pct numeric)
language sql stable
set search_path = public
as $$
  select f.nome,
         count(distinct v.id),
         sum(vp.valor),
         sum(vp.valor_taxa),
         round(sum(vp.valor) / nullif(sum(sum(vp.valor)) over (), 0) * 100, 1)
    from public.vendas v
    join public.venda_pagamentos vp on vp.venda_id = v.id
    join public.formas_pagamento f  on f.id = vp.forma_pagamento_id
   where v.status = 'concluida'
     and (v.data_hora at time zone 'America/Fortaleza')::date between p_inicio and p_fim
   group by f.nome, f.ordem
   order by sum(vp.valor) desc, f.ordem
$$;

-- 7.5 Ranking de produtos. p_ordenar: 'quantidade' | 'faturamento' | 'lucro'
create or replace function public.painel_top_produtos(p_inicio date, p_fim date,
                                                      p_ordenar text default 'quantidade',
                                                      p_limite integer default 10)
returns table (produto_id uuid, modelo text, linha text, quantidade bigint,
               faturamento numeric, cmv numeric, lucro_bruto numeric, margem_pct numeric)
language sql stable
set search_path = public
as $$
  select pr.id, pr.modelo, pr.linha,
         sum(vi.quantidade),
         sum(vi.total_item),
         round(sum(vi.quantidade * vi.custo_unitario), 2),
         round(sum(vi.total_item - vi.quantidade * vi.custo_unitario), 2),
         round(sum(vi.total_item - vi.quantidade * vi.custo_unitario) / nullif(sum(vi.total_item), 0) * 100, 1)
    from public.vendas v
    join public.venda_itens vi on vi.venda_id = v.id
    join public.produtos pr    on pr.id = vi.produto_id
   where v.status = 'concluida'
     and (v.data_hora at time zone 'America/Fortaleza')::date between p_inicio and p_fim
   group by pr.id, pr.modelo, pr.linha
   order by case p_ordenar
              when 'faturamento' then sum(vi.total_item)
              when 'lucro'       then sum(vi.total_item - vi.quantidade * vi.custo_unitario)
              else sum(vi.quantidade) end desc,
            pr.modelo
   limit greatest(coalesce(p_limite, 10), 1)
$$;

-- 7.6 Margem por linha (Moto, Automotiva, EFB, AGM, Diesel...)
create or replace function public.painel_por_linha(p_inicio date, p_fim date)
returns table (linha text, quantidade bigint, faturamento numeric, cmv numeric,
               lucro_bruto numeric, margem_pct numeric)
language sql stable
set search_path = public
as $$
  select pr.linha,
         sum(vi.quantidade),
         sum(vi.total_item),
         round(sum(vi.quantidade * vi.custo_unitario), 2),
         round(sum(vi.total_item - vi.quantidade * vi.custo_unitario), 2),
         round(sum(vi.total_item - vi.quantidade * vi.custo_unitario) / nullif(sum(vi.total_item), 0) * 100, 1)
    from public.vendas v
    join public.venda_itens vi on vi.venda_id = v.id
    join public.produtos pr    on pr.id = vi.produto_id
   where v.status = 'concluida'
     and (v.data_hora at time zone 'America/Fortaleza')::date between p_inicio and p_fim
   group by pr.linha
   order by sum(vi.total_item) desc
$$;

-- 7.7 Vendas por tipo de atendimento (balcão, entrega, socorro)
create or replace function public.painel_por_atendimento(p_inicio date, p_fim date)
returns table (tipo_atendimento text, qtd_vendas bigint, faturamento numeric, participacao_pct numeric)
language sql stable
set search_path = public
as $$
  select v.tipo_atendimento, count(*), sum(v.total),
         round(sum(v.total) / nullif(sum(sum(v.total)) over (), 0) * 100, 1)
    from public.vendas v
   where v.status = 'concluida'
     and (v.data_hora at time zone 'America/Fortaleza')::date between p_inicio and p_fim
   group by v.tipo_atendimento
   order by sum(v.total) desc
$$;

-- ---------------------------------------------------------------------
-- 8. Segurança: RLS e permissões
-- ---------------------------------------------------------------------

alter table public.loja_config        enable row level security;
alter table public.produtos           enable row level security;
alter table public.fornecedores       enable row level security;
alter table public.clientes           enable row level security;
alter table public.formas_pagamento   enable row level security;
alter table public.compras            enable row level security;
alter table public.compra_itens       enable row level security;
alter table public.vendas             enable row level security;
alter table public.venda_itens        enable row level security;
alter table public.venda_pagamentos   enable row level security;
alter table public.movimentos_estoque enable row level security;

-- MVP: os 2 usuários logados enxergam e operam tudo. Anônimo: nada.
create policy acesso_autenticado on public.loja_config        for all to authenticated using (true) with check (true);
create policy acesso_autenticado on public.produtos           for all to authenticated using (true) with check (true);
create policy acesso_autenticado on public.fornecedores       for all to authenticated using (true) with check (true);
create policy acesso_autenticado on public.clientes           for all to authenticated using (true) with check (true);
create policy acesso_autenticado on public.formas_pagamento   for all to authenticated using (true) with check (true);
create policy acesso_autenticado on public.compras            for all to authenticated using (true) with check (true);
create policy acesso_autenticado on public.compra_itens       for all to authenticated using (true) with check (true);
create policy acesso_autenticado on public.vendas             for all to authenticated using (true) with check (true);
create policy acesso_autenticado on public.venda_itens        for all to authenticated using (true) with check (true);
create policy acesso_autenticado on public.venda_pagamentos   for all to authenticated using (true) with check (true);
create policy acesso_autenticado on public.movimentos_estoque for all to authenticated using (true) with check (true);

-- O Supabase dá permissão total a anon/authenticated em tabelas novas.
-- Aqui retiramos tudo e devolvemos só o necessário.
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;

grant usage on schema public to anon, authenticated;

-- leitura de tudo (tabelas e views) para quem está logado
grant select on all tables in schema public to authenticated;

-- cadastros editáveis pelo app
grant insert, update, delete on public.clientes, public.fornecedores to authenticated;
grant insert, update         on public.formas_pagamento to authenticated;
grant update (nome_loja, telefone, endereco, instagram, site, garantia_padrao_meses, rodape_comprovante)
      on public.loja_config to authenticated;
-- produtos: o app NÃO pode mexer em estoque_atual nem custo_medio
grant insert (modelo, linha, marca, tipo_veiculo, aplicacoes, amperagem_ah, preco_venda,
              preco_venda_sem_sucata, estoque_minimo, garantia_meses, ativo)
      on public.produtos to authenticated;
grant update (modelo, linha, marca, tipo_veiculo, aplicacoes, amperagem_ah, preco_venda,
              preco_venda_sem_sucata, estoque_minimo, garantia_meses, ativo)
      on public.produtos to authenticated;

-- funções que o app chama
grant execute on function
  public.registrar_compra(jsonb),
  public.registrar_venda(jsonb, boolean),
  public.cancelar_venda(uuid, text),
  public.cancelar_compra(uuid, text),
  public.ajustar_estoque(uuid, integer, text),
  public.buscar_produtos(text, text, boolean, integer),
  public.buscar_clientes(text, integer),
  public.painel_indicadores(date, date),
  public.painel_por_forma_pagamento(date, date),
  public.painel_top_produtos(date, date, text, integer),
  public.painel_por_linha(date, date),
  public.painel_por_atendimento(date, date),
  public.fn_normalizar(text),
  public.fn_hoje(),
  public.fn_exigir_login()
to authenticated;

-- única coisa que o anônimo pode chamar
grant execute on function public.ping() to anon, authenticated;

-- Fim do schema.sql
