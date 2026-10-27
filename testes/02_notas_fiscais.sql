-- Testes da migração 002 (nota fiscal na venda). Rodar depois de 01_cenarios.sql.
\set ON_ERROR_STOP 1
\pset footer off
set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

do $$
declare
  v2 uuid; v3 uuid; v1 uuid; v_cli uuid; r jsonb; n uuid; v_err text; v_cnt int;
  -- chaves de exemplo com dígito verificador correto (CE, out/2026)
  k_nfce_129 text := '2326 1012 3456 7800 0195 6500 1000 0001 2911 2345 6780';  -- com espaços, como vem no DANFE
  k_nfe_42   text := '23261012345678000195550010000000421876543217';
begin
  select id into v1 from vendas where numero = 1;   -- cancelada no teste 01
  select id into v2 from vendas where numero = 2;
  select id into v3 from vendas where numero = 3;
  select id into v_cli from clientes limit 1;

  -- 1. funcao de validacao
  if not fn_chave_nfe_valida('23261012345678000195550010000000421876543217') then raise exception 'FALHOU n1: chave valida recusada'; end if;
  if fn_chave_nfe_valida('23261012345678000195550010000000421876543210') then raise exception 'FALHOU n1: DV errado aceito'; end if;
  raise notice 'ok n1: digito verificador da chave';

  -- 2. registrar NFC-e só colando a chave (modelo, serie e numero saem dela)
  insert into notas_fiscais (venda_id, chave) values (v2, k_nfce_129) returning id into n;
  select jsonb_build_object('modelo', modelo, 'serie', serie, 'numero', numero, 'valor', valor, 'chave_len', length(chave), 'usuario', usuario_id)
    into r from notas_fiscais where id = n;
  if (r->>'modelo')::int <> 65 or (r->>'serie')::int <> 1 or (r->>'numero')::int <> 129
     or (r->>'valor')::numeric <> 760 or (r->>'chave_len')::int <> 44 or r->>'usuario' is null then
    raise exception 'FALHOU n2: %', r;
  end if;
  raise notice 'ok n2: chave colada com espacos preenche modelo 65, serie 1, nº 129 e valor da venda (%)', r;

  -- 3. segunda nota emitida na mesma venda: recusada
  begin
    insert into notas_fiscais (venda_id, modelo, numero) values (v2, 65, 999);
    raise exception 'FALHOU n3';
  exception when unique_violation then raise notice 'ok n3: so uma nota emitida por venda'; end;

  -- 4. chave com DV errado e chave com tamanho errado
  begin
    insert into notas_fiscais (venda_id, chave) values (v3, '23261012345678000195550010000000421876543210');
    raise exception 'FALHOU n4a';
  exception when invalid_parameter_value then get stacked diagnostics v_err = message_text; raise notice 'ok n4a: %', v_err; end;
  begin
    insert into notas_fiscais (venda_id, chave) values (v3, '2326101234567800019555001');
    raise exception 'FALHOU n4b';
  exception when invalid_parameter_value then get stacked diagnostics v_err = message_text; raise notice 'ok n4b: %', v_err; end;

  -- 5. chave que nao confere com o numero digitado
  begin
    insert into notas_fiscais (venda_id, modelo, numero, chave) values (v3, 55, 43, k_nfe_42);
    raise exception 'FALHOU n5';
  exception when invalid_parameter_value then get stacked diagnostics v_err = message_text; raise notice 'ok n5: %', v_err; end;

  -- 6. NF-e sem chave (só numero) e CNPJ alfanumérico do destinatário
  insert into notas_fiscais (venda_id, modelo, numero, cpf_cnpj_destinatario, valor)
  values (v3, 55, 42, '12.ABC.345/01DE-35', 1100) returning id into n;
  if (select serie || '|' || cpf_cnpj_destinatario from notas_fiscais where id = n) <> '1|12ABC34501DE35' then
    raise exception 'FALHOU n6';
  end if;
  raise notice 'ok n6: NF-e sem chave, serie padrao 1, CNPJ alfanumerico normalizado';

  -- 7. completar a chave depois (update) — confere com o nº 42 já salvo
  update notas_fiscais set chave = k_nfe_42 where id = n;
  raise notice 'ok n7: chave informada depois confere com nº 42';

  -- 8. nota em venda cancelada: recusada
  begin
    insert into notas_fiscais (venda_id, modelo, numero) values (v1, 65, 500);
    raise exception 'FALHOU n8';
  exception when invalid_parameter_value then raise notice 'ok n8: venda cancelada nao recebe nota'; end;

  -- 9. cancelar nota exige motivo; depois permite registrar outra na mesma venda
  begin
    update notas_fiscais set situacao = 'cancelada' where id = n;
    raise exception 'FALHOU n9a';
  exception when invalid_parameter_value then null; end;
  update notas_fiscais set situacao = 'cancelada', motivo_cancelamento = 'Valor errado na nota' where id = n;
  insert into notas_fiscais (venda_id, modelo, numero, valor) values (v3, 55, 43, 1100);
  begin
    update notas_fiscais set situacao = 'emitida' where id = n;
    raise exception 'FALHOU n9b';
  exception when invalid_parameter_value then null; end;
  raise notice 'ok n9: cancelamento com motivo, nova nota na mesma venda, cancelada nao volta';

  -- 10. app nao apaga nota
  begin
    delete from notas_fiscais where id = n;
    raise exception 'FALHOU n10';
  exception when insufficient_privilege then raise notice 'ok n10: delete bloqueado'; end;

  -- 11. editar venda: vincular cliente, mudar atendimento e obs
  r := atualizar_venda(v2, jsonb_build_object('cliente_id', v_cli, 'tipo_atendimento', 'entrega',
                                              'local_atendimento', 'Messejana', 'obs', 'Cliente pediu CPF na nota'));
  if (select cliente_id = v_cli and tipo_atendimento = 'entrega' and obs = 'Cliente pediu CPF na nota' from vendas where id = v2) is not true then
    raise exception 'FALHOU n11';
  end if;
  begin
    perform atualizar_venda(v2, '{"total": 1}'::jsonb);
    raise exception 'FALHOU n11b';
  exception when invalid_parameter_value then get stacked diagnostics v_err = message_text; raise notice 'ok n11: edicao leve ok; valores recusados (%)', v_err; end;
  -- total, estoque e custo intocados
  if (select total from vendas where id = v2) <> 760 then raise exception 'FALHOU n11c'; end if;

  -- 12. venda nova sem nota = pendente; venda com nota cancelada depois = cancelar_nota
  r := registrar_venda(jsonb_build_object(
         'itens', jsonb_build_array(jsonb_build_object('produto_id', (select id from produtos where modelo = 'M60GD'), 'quantidade', 1, 'preco_unitario', 450)),
         'pagamentos', jsonb_build_array(jsonb_build_object('forma_pagamento_id', (select id from formas_pagamento where nome = 'Pix'), 'valor', 450))));
  perform cancelar_venda(v3, 'Cliente devolveu');
  if (select situacao_nota from vw_vendas_lista where id = (r->>'id')::uuid) <> 'pendente'
     or (select situacao_nota from vw_vendas_lista where id = v3) <> 'cancelar_nota'
     or (select vendas_sem_nota || '|' || notas_para_cancelar from vw_resumo_notas) <> '1|1' then
    raise exception 'FALHOU n12';
  end if;
  raise notice 'ok n12: venda sem nota = pendente; venda cancelada com nota = cancelar_nota';
end $$;

\echo '--- vw_vendas_lista: situacao da nota ---'
select numero, status, total, nota_modelo, nota_serie, nota_numero, situacao_nota from vw_vendas_lista order by numero;
\echo '--- vw_resumo_notas ---'
select * from vw_resumo_notas;
\echo '--- vw_notas_fiscais ---'
select venda_numero, modelo_nome, serie, numero, situacao, valor, valor_diferente_da_venda, motivo_cancelamento from vw_notas_fiscais order by created_at;
\echo '--- vendas sem nota (filtro da tela) ---'
select numero, total from vw_vendas_lista where situacao_nota = 'pendente';
reset role;
