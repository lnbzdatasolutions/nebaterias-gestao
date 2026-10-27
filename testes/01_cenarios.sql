-- Testes de cenário. Cada bloco falha (raise) se o resultado não for o esperado.
\set ON_ERROR_STOP 1
\pset footer off

-- ---------- 1. Anônimo não lê nada, mas pode chamar ping() ----------
set role anon;
do $$ begin
  begin perform 1 from public.produtos limit 1;
        raise exception 'FALHOU: anon conseguiu ler produtos';
  exception when insufficient_privilege then raise notice 'ok 1a: anon bloqueado em produtos'; end;
  begin perform public.painel_indicadores(current_date, current_date);
        raise exception 'FALHOU: anon chamou painel';
  exception when insufficient_privilege then raise notice 'ok 1b: anon bloqueado no painel'; end;
end $$;
select public.ping() as ping_anon;
reset role;

-- ---------- 2. Logado sem usuário no token falha ----------
set role authenticated;
do $$ begin
  begin perform public.ajustar_estoque(gen_random_uuid(), 1, 'teste');
        raise exception 'FALHOU: rodou sem login';
  exception when insufficient_privilege then raise notice 'ok 2: exige login'; end;
end $$;

-- ---------- 3. Logado (dono) ----------
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

do $$
declare
  v_forn uuid; v_cli uuid; v_m60 uuid; v_m40 uuid; v_m150 uuid;
  v_pix uuid; v_din uuid; v_cred uuid;
  r jsonb; v_cm numeric; v_est int; v_venda uuid; v_tot numeric; v_cnt int;
  v_err text; v_det text;
begin
  select id into v_m60  from produtos where modelo = 'M60GD';
  select id into v_m40  from produtos where modelo = 'M40SD';
  select id into v_m150 from produtos where modelo = 'M150BD';
  select id into v_pix  from formas_pagamento where nome = 'Pix';
  select id into v_din  from formas_pagamento where nome = 'Dinheiro';
  select id into v_cred from formas_pagamento where nome = 'Crédito';

  -- cadastros diretos
  insert into fornecedores (nome, cidade) values ('Revendedor Moura Centro', 'Fortaleza') returning id into v_forn;
  insert into clientes (nome, telefone, placa, veiculo)
  values ('  João da Silva ', '(85) 9 9999-1234', 'abc-1d23', 'Onix 2019') returning id into v_cli;
  if (select telefone || '|' || placa || '|' || nome from clientes where id = v_cli) <> '85999991234|ABC1D23|João da Silva' then
    raise exception 'FALHOU 3a: normalização do cliente';
  end if;
  raise notice 'ok 3a: cliente normalizado';

  -- o app não pode gravar venda direto nem mexer no estoque
  begin insert into vendas (subtotal, total) values (1, 1);
        raise exception 'FALHOU 3b: insert direto em vendas';
  exception when insufficient_privilege then raise notice 'ok 3b: insert direto em vendas bloqueado'; end;
  begin update produtos set estoque_atual = 99 where id = v_m60;
        raise exception 'FALHOU 3c: update direto de estoque';
  exception when insufficient_privilege then raise notice 'ok 3c: update direto de estoque bloqueado'; end;
  update produtos set preco_venda = 450, preco_venda_sem_sucata = 490 where id = v_m60;
  update produtos set preco_venda = 380 where id = v_m40;
  raise notice 'ok 3d: preço de venda editável';

  -- compra 1: 2 un a 300 com 20 de desconto → custo 280
  r := registrar_compra(jsonb_build_object('fornecedor_id', v_forn, 'numero_nota', 'NF-1',
         'itens', jsonb_build_array(jsonb_build_object('produto_id', v_m60, 'quantidade', 2,
                                                       'preco_tabela', 300, 'desconto_unitario', 20))));
  select custo_medio, estoque_atual into v_cm, v_est from produtos where id = v_m60;
  if v_cm <> 280 or v_est <> 2 then raise exception 'FALHOU 3e: cm % est %', v_cm, v_est; end if;
  raise notice 'ok 3e: compra 1 → custo 280, estoque 2 (%)', r;

  -- compra 2: 2 un a 300 → custo médio 290 (critério de aceite)
  r := registrar_compra(jsonb_build_object('fornecedor_id', v_forn,
         'itens', jsonb_build_array(jsonb_build_object('produto_id', v_m60, 'quantidade', 2, 'preco_tabela', 300))));
  select custo_medio, estoque_atual into v_cm, v_est from produtos where id = v_m60;
  if v_cm <> 290 or v_est <> 4 then raise exception 'FALHOU 3f: cm % est %', v_cm, v_est; end if;
  raise notice 'ok 3f: compra 2 → custo médio 290, estoque 4';

  -- compra 3: 2 itens, frete 30, outros 0, abatimento sucata 50 → rateio fecha exato
  r := registrar_compra(jsonb_build_object('fornecedor_id', v_forn, 'frete', 30,
         'qtd_sucata_entregue', 2, 'abatimento_sucata', 50,
         'itens', jsonb_build_array(
            jsonb_build_object('produto_id', v_m40,  'quantidade', 1, 'preco_tabela', 250),
            jsonb_build_object('produto_id', v_m150, 'quantidade', 3, 'preco_tabela', 700, 'desconto_unitario', 33.33))));
  if (select sum(rateio_custos) from compra_itens where compra_id = (r->>'id')::uuid) <> 30
     or (select sum(rateio_abatimento) from compra_itens where compra_id = (r->>'id')::uuid) <> 50 then
    raise exception 'FALHOU 3g: rateio não fecha';
  end if;
  if (select total from compras where id = (r->>'id')::uuid)
     <> (select sum(subtotal) from compra_itens where compra_id = (r->>'id')::uuid) then
    raise exception 'FALHOU 3g: total da compra difere da soma dos itens';
  end if;
  raise notice 'ok 3g: compra 3 com frete e sucata → rateio exato (%)', r;

  -- venda: 1x M60GD a 450, 10% de desconto, Pix 200 + Dinheiro 205
  r := registrar_venda(jsonb_build_object('cliente_id', v_cli, 'desconto_tipo', 'percentual', 'desconto_informado', 10,
         'itens', jsonb_build_array(jsonb_build_object('produto_id', v_m60, 'quantidade', 1, 'preco_unitario', 450)),
         'pagamentos', jsonb_build_array(jsonb_build_object('forma_pagamento_id', v_pix, 'valor', 200),
                                         jsonb_build_object('forma_pagamento_id', v_din, 'valor', 205))));
  v_venda := (r->>'id')::uuid;
  if (r->>'total')::numeric <> 405 or (r->>'lucro_bruto')::numeric <> 115 then
    raise exception 'FALHOU 3h: %', r;
  end if;
  if (select estoque_atual from produtos where id = v_m60) <> 3 then raise exception 'FALHOU 3h: estoque'; end if;
  raise notice 'ok 3h: venda com 10%% e pagamento dividido → total 405, lucro 115 (%)', r;

  -- pagamentos que não fecham
  begin
    perform registrar_venda(jsonb_build_object(
         'itens', jsonb_build_array(jsonb_build_object('produto_id', v_m60, 'quantidade', 1, 'preco_unitario', 450)),
         'pagamentos', jsonb_build_array(jsonb_build_object('forma_pagamento_id', v_pix, 'valor', 400))));
    raise exception 'FALHOU 3i: aceitou pagamento menor que o total';
  exception when invalid_parameter_value then
    get stacked diagnostics v_err = message_text;
    raise notice 'ok 3i: %', v_err;
  end;

  -- estoque insuficiente: M40SD tem 1; pedir 2
  begin
    perform registrar_venda(jsonb_build_object(
         'itens', jsonb_build_array(jsonb_build_object('produto_id', v_m40, 'quantidade', 2, 'preco_unitario', 380)),
         'pagamentos', jsonb_build_array(jsonb_build_object('forma_pagamento_id', v_pix, 'valor', 760))));
    raise exception 'FALHOU 3j: vendeu sem estoque sem confirmar';
  exception when raise_exception then
    get stacked diagnostics v_err = message_text, v_det = pg_exception_detail;
    if v_err <> 'ESTOQUE_INSUFICIENTE' then raise; end if;
    raise notice 'ok 3j: % detalhe %', v_err, v_det;
  end;
  r := registrar_venda(jsonb_build_object(
         'itens', jsonb_build_array(jsonb_build_object('produto_id', v_m40, 'quantidade', 2, 'preco_unitario', 380)),
         'pagamentos', jsonb_build_array(jsonb_build_object('forma_pagamento_id', v_pix, 'valor', 760))), true);
  if (select estoque_atual from produtos where id = v_m40) <> -1 then raise exception 'FALHOU 3k'; end if;
  raise notice 'ok 3k: venda confirmada com estoque negativo → saldo -1 (%)', r;

  -- crédito 3x com taxa de 3%
  update formas_pagamento set taxa_percentual = 3 where id = v_cred;
  r := registrar_venda(jsonb_build_object('tipo_atendimento', 'socorro', 'local_atendimento', 'Aldeota',
         'itens', jsonb_build_array(jsonb_build_object('produto_id', v_m150, 'quantidade', 1, 'preco_unitario', 1100)),
         'pagamentos', jsonb_build_array(jsonb_build_object('forma_pagamento_id', v_cred, 'valor', 1100, 'parcelas', 3))));
  if (select valor_taxa from venda_pagamentos where venda_id = (r->>'id')::uuid) <> 33 then
    raise exception 'FALHOU 3l: taxa';
  end if;
  raise notice 'ok 3l: crédito 3x com 3%% → taxa 33,00';

  -- parcelas em forma que não permite
  begin
    perform registrar_venda(jsonb_build_object(
         'itens', jsonb_build_array(jsonb_build_object('produto_id', v_m60, 'quantidade', 1, 'preco_unitario', 450)),
         'pagamentos', jsonb_build_array(jsonb_build_object('forma_pagamento_id', v_pix, 'valor', 450, 'parcelas', 2))));
    raise exception 'FALHOU 3m';
  exception when invalid_parameter_value then raise notice 'ok 3m: Pix não parcela'; end;

  -- cancelar a 1ª venda: estoque volta e sai do painel
  r := cancelar_venda(v_venda, 'Cliente desistiu');
  if (select estoque_atual from produtos where id = v_m60) <> 4 then raise exception 'FALHOU 3n: estoque não voltou'; end if;
  begin perform cancelar_venda(v_venda, 'de novo'); raise exception 'FALHOU 3n: cancelou 2x';
  exception when invalid_parameter_value then null; end;
  raise notice 'ok 3n: cancelamento devolveu o estoque e não cancela 2x';

  -- ajuste de estoque
  r := ajustar_estoque(v_m40, 1, 'Contagem: achei 1 no depósito');
  if (select estoque_atual from produtos where id = v_m40) <> 0 then raise exception 'FALHOU 3o'; end if;
  raise notice 'ok 3o: ajuste (%)', r;

  -- cancelar compra 3: retira do estoque
  select id into v_venda from compras where numero = 3;
  perform cancelar_compra(v_venda, 'Nota lançada errada');
  if (select estoque_atual from produtos where id = v_m150) <> -1 then raise exception 'FALHOU 3p'; end if;
  raise notice 'ok 3p: cancelamento de compra retirou do estoque';

  -- buscas
  select count(*) into v_cnt from buscar_produtos('onix');
  if v_cnt <> 2 then raise exception 'FALHOU 3q: onix trouxe %', v_cnt; end if;
  select count(*) into v_cnt from buscar_produtos('ONIBUS');
  if v_cnt <> 3 then raise exception 'FALHOU 3q: onibus trouxe %', v_cnt; end if;  -- M150BD, M180BD, M220BD
  select count(*) into v_cnt from buscar_produtos('hilux diesel');
  if v_cnt <> 4 then raise exception 'FALHOU 3q: hilux diesel trouxe %', v_cnt; end if;  -- M70LD, M75LD (diesel leve) + M90TD, M100QD
  select count(*) into v_cnt from buscar_clientes('ABC-1D23');
  if v_cnt <> 1 then raise exception 'FALHOU 3r: placa'; end if;
  select count(*) into v_cnt from buscar_clientes('99999-1234');
  if v_cnt <> 1 then raise exception 'FALHOU 3r: telefone'; end if;
  raise notice 'ok 3q/3r: buscas por carro, sem acento, multi-palavra, placa e telefone';
end $$;

-- ---------- 4. Conferência do painel (só vendas concluídas) ----------
-- Vendas concluídas: M40SD 2x380=760 (custo 270 cada? ver itens) e M150BD 1x1100.
\echo '--- painel_indicadores(hoje) ---'
select * from painel_indicadores(fn_hoje(), fn_hoje());
\echo '--- conferência manual pelas tabelas ---'
select sum(vi.total_item) as faturamento, sum(vi.quantidade * vi.custo_unitario) as cmv
  from venda_itens vi join vendas v on v.id = vi.venda_id where v.status = 'concluida';
\echo '--- por forma de pagamento ---'
select * from painel_por_forma_pagamento(fn_hoje(), fn_hoje());
\echo '--- top produtos por lucro ---'
select * from painel_top_produtos(fn_hoje(), fn_hoje(), 'lucro', 5);
\echo '--- por atendimento ---'
select * from painel_por_atendimento(fn_hoje(), fn_hoje());
\echo '--- loja ---'
select nome_loja, telefone, endereco, instagram from loja_config;
\echo '--- por linha ---'
select * from painel_por_linha(fn_hoje(), fn_hoje());
\echo '--- resumo mensal ---'
select * from vw_resumo_mensal;
\echo '--- vendas (lista) ---'
select numero, data_local, cliente_nome, total, status, itens_resumo, pagamentos_resumo, lucro_bruto, taxas, lucro_liquido from vw_vendas_lista order by numero;
\echo '--- compras (lista) ---'
select numero, data_compra, fornecedor_nome, total, status, itens_resumo from vw_compras_lista order by numero;
\echo '--- movimentos M60GD ---'
select data_local, tipo, quantidade, custo_unitario, descricao from vw_movimentos_detalhe where modelo = 'M60GD' order by data_hora;
\echo '--- estoque baixo / valor do estoque ---'
select modelo, estoque_atual, estoque_minimo from vw_estoque_baixo limit 5;
select * from vw_valor_estoque;
\echo '--- última compra M60GD (deve ser a compra 2, tabela 300) ---'
select preco_tabela, custo_unitario_final from vw_ultima_compra_produto u join produtos p on p.id = u.produto_id where p.modelo = 'M60GD';
\echo '--- busca onix ---'
select modelo, estoque_atual, preco_venda, custo_medio, markup_pct, margem_pct from buscar_produtos('onix');
reset role;
