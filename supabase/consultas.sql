-- =====================================================================
--  N E Baterias · Consultas prontas por tela
--  Arquivo : supabase/consultas.sql
--  Cada bloco traz o SQL (para testar no SQL Editor do Supabase) e, logo
--  acima, a chamada equivalente em supabase-js, que é o que o app usa.
--  Valores de exemplo: troque datas, modelos e ids pelos reais.
--  Datas: o app calcula "hoje" no fuso da loja:
--    const hoje = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Fortaleza' }); // '2026-10-27'
-- =====================================================================


-- =====================================================================
-- TELA INÍCIO
-- =====================================================================

-- I-1 · Cartões do dia (vendas, faturamento, lucro de hoje)
-- JS: supabase.rpc('painel_indicadores', { p_inicio: hoje, p_fim: hoje }).single()
select * from painel_indicadores(fn_hoje(), fn_hoje());

-- I-2 · Faturamento do mês corrente
-- JS: supabase.rpc('painel_indicadores', { p_inicio: inicioDoMes, p_fim: hoje }).single()
select faturamento, lucro_bruto, qtd_vendas
  from painel_indicadores(date_trunc('month', fn_hoje())::date, fn_hoje());

-- I-3 · Alerta de estoque baixo
-- JS: supabase.from('vw_estoque_baixo').select('id, modelo, estoque_atual, estoque_minimo')
select id, modelo, estoque_atual, estoque_minimo from vw_estoque_baixo;

-- I-4 · Últimas 5 vendas
-- JS: supabase.from('vw_vendas_lista')
--       .select('id, numero, data_hora, cliente_nome, total, status, itens_resumo')
--       .order('data_hora', { ascending: false }).limit(5)
select id, numero, data_hora, cliente_nome, total, status, itens_resumo
  from vw_vendas_lista order by data_hora desc limit 5;


-- =====================================================================
-- TELA VENDER
-- =====================================================================

-- V-1 · Buscar bateria por modelo ou carro (digitando "onix", "m60", "hilux diesel")
-- JS: supabase.rpc('buscar_produtos', { p_termo: texto, p_limite: 20 })
--       .select('id, modelo, linha, aplicacoes, estoque_atual, preco_venda, preco_venda_sem_sucata, custo_medio')
select id, modelo, linha, aplicacoes, estoque_atual, preco_venda, preco_venda_sem_sucata, custo_medio
  from buscar_produtos('onix', null, true, 20);

-- V-2 · Formas de pagamento (botões)
-- JS: supabase.from('formas_pagamento').select('id, nome, permite_parcelas, taxa_percentual')
--       .eq('ativo', true).order('ordem')
select id, nome, permite_parcelas, taxa_percentual from formas_pagamento where ativo order by ordem;

-- V-3 · Buscar cliente (nome, telefone ou placa)
-- JS: supabase.rpc('buscar_clientes', { p_termo: texto, p_limite: 10 })
select id, nome, telefone, veiculo, placa from buscar_clientes('abc1d23', 10);

-- V-4 · Cadastro rápido de cliente (telefone e placa são normalizados pelo banco)
-- JS: supabase.from('clientes').insert({ nome, telefone, veiculo, placa }).select('id, nome').single()
-- insert into clientes (nome, telefone, veiculo, placa) values ('Maria', '(85) 98888-0000', 'HB20', 'POX-4G21') returning id, nome;

-- V-5 · Registrar a venda (UMA chamada grava venda, itens, pagamentos e estoque)
-- JS:
--   let { data, error } = await supabase.rpc('registrar_venda', { p: venda, p_permitir_estoque_negativo: false });
--   if (error?.message === 'ESTOQUE_INSUFICIENTE') {
--     const faltas = JSON.parse(error.details);        // [{ modelo, estoque_atual, quantidade_pedida }]
--     if (confirm(`Estoque de ${faltas[0].modelo} ficará negativo. Vender mesmo assim?`))
--       ({ data, error } = await supabase.rpc('registrar_venda', { p: venda, p_permitir_estoque_negativo: true }));
--   }
--   // data = { id, numero, total, lucro_bruto, estoque_negativo }
-- Exemplo de "venda":
--   { "cliente_id": null, "desconto_tipo": "percentual", "desconto_informado": 10,
--     "sucata_recebida": true, "tipo_atendimento": "entrega", "local_atendimento": "Aldeota",
--     "itens": [ { "produto_id": "<uuid>", "quantidade": 1, "preco_unitario": 450 } ],
--     "pagamentos": [ { "forma_pagamento_id": "<uuid Pix>", "valor": 405, "parcelas": 1 } ] }

-- V-6 · Dados do comprovante (WhatsApp), após salvar
-- JS: supabase.from('vw_venda_itens_detalhe')
--       .select('venda_numero, data_hora, modelo, quantidade, total_item, garantia_ate, cliente_nome')
--       .eq('venda_id', idDaVenda)
--     + supabase.from('loja_config').select('*').single()
select venda_numero, data_hora, modelo, quantidade, total_item, garantia_ate, cliente_nome
  from vw_venda_itens_detalhe where venda_numero = (select max(numero) from vendas);
select nome_loja, telefone, endereco, instagram, rodape_comprovante from loja_config;
--   Link: `https://wa.me/55${cliente.telefone}?text=${encodeURIComponent(texto)}`


-- =====================================================================
-- TELA ESTOQUE (e atalho #estoque)
-- =====================================================================

-- E-1 · Lista com filtro por linha
-- JS: supabase.rpc('buscar_produtos', { p_termo: texto || null, p_linha: linha || null })
select modelo, linha, estoque_atual, abaixo_minimo, preco_venda
  from buscar_produtos(null, 'Moura EFB');

-- E-2 · Linhas disponíveis (chips de filtro)
-- JS: supabase.from('produtos').select('linha').eq('ativo', true)  → valores únicos no app
select distinct linha from produtos where ativo order by linha;

-- E-3 · Detalhe do produto
-- JS: supabase.from('vw_produtos_estoque').select('*').eq('id', produtoId).single()
select * from vw_produtos_estoque where modelo = 'M60GD';

-- E-4 · Últimas movimentações do produto
-- JS: supabase.from('vw_movimentos_detalhe').select('data_hora, tipo, quantidade, custo_unitario, descricao')
--       .eq('produto_id', produtoId).order('data_hora', { ascending: false }).limit(20)
select data_hora, tipo, quantidade, custo_unitario, descricao
  from vw_movimentos_detalhe where modelo = 'M60GD' order by data_hora desc limit 20;

-- E-5 · Ajustar estoque (+ entra, − sai)
-- JS: supabase.rpc('ajustar_estoque', { p_produto_id, p_quantidade: -1, p_motivo: 'Avaria' })


-- =====================================================================
-- TELA ENTRADA (compra no revendedor)
-- =====================================================================

-- C-1 · Fornecedores ativos (o último usado vem primeiro no app)
-- JS: supabase.from('fornecedores').select('id, nome').eq('ativo', true).order('nome')
select id, nome from fornecedores where ativo order by nome;

-- C-2 · Último preço pago por produto (ajuda a preencher a compra)
-- JS: supabase.from('vw_ultima_compra_produto')
--       .select('preco_tabela, desconto_unitario, custo_unitario_final, data_compra')
--       .eq('produto_id', produtoId).maybeSingle()
select preco_tabela, desconto_unitario, custo_unitario_final, data_compra
  from vw_ultima_compra_produto where produto_id = (select id from produtos where modelo = 'M60GD');

-- C-3 · Registrar a compra
-- JS: supabase.rpc('registrar_compra', { p: compra })   // data = { id, numero, total }
-- Exemplo de "compra":
--   { "fornecedor_id": "<uuid>", "data_compra": "2026-10-27", "numero_nota": "4521",
--     "frete": 30, "outros_custos": 0, "qtd_sucata_entregue": 2, "abatimento_sucata": 50,
--     "itens": [ { "produto_id": "<uuid>", "quantidade": 2, "preco_tabela": 320, "desconto_unitario": 20 } ] }


-- =====================================================================
-- TELA PAINEL  (período: p_inicio..p_fim; anterior = mesmo nº de dias logo antes)
-- =====================================================================

-- P-1 · Cartões (chamar 2x: período atual e anterior, para a variação %)
-- JS: supabase.rpc('painel_indicadores', { p_inicio, p_fim }).single()
select * from painel_indicadores('2026-10-01', '2026-10-31');

-- P-2 · Faturamento e lucro dos últimos 12 meses
-- JS: supabase.from('vw_resumo_mensal').select('ano_mes, faturamento, lucro_bruto, lucro_liquido, qtd_vendas')
--       .gte('mes', primeiroDiaHa11Meses).order('mes')
select ano_mes, faturamento, lucro_bruto, lucro_liquido, qtd_vendas
  from vw_resumo_mensal where mes >= (date_trunc('month', fn_hoje()) - interval '11 months')::date order by mes;

-- P-3 · Melhor mês (por faturamento e por lucro)
-- JS: supabase.from('vw_resumo_mensal').select('ano_mes, faturamento').order('faturamento', { ascending: false }).limit(1)
--     supabase.from('vw_resumo_mensal').select('ano_mes, lucro_bruto').order('lucro_bruto', { ascending: false }).limit(1)
select ano_mes, faturamento from vw_resumo_mensal order by faturamento desc limit 1;
select ano_mes, lucro_bruto from vw_resumo_mensal order by lucro_bruto desc limit 1;

-- P-4 · Vendas por forma de pagamento
-- JS: supabase.rpc('painel_por_forma_pagamento', { p_inicio, p_fim })
select * from painel_por_forma_pagamento('2026-10-01', '2026-10-31');

-- P-5 · Top 10 baterias (p_ordenar: 'quantidade' | 'faturamento' | 'lucro')
-- JS: supabase.rpc('painel_top_produtos', { p_inicio, p_fim, p_ordenar: 'lucro', p_limite: 10 })
select modelo, quantidade, faturamento, lucro_bruto, margem_pct
  from painel_top_produtos('2026-10-01', '2026-10-31', 'lucro', 10);

-- P-6 · Margem por linha
-- JS: supabase.rpc('painel_por_linha', { p_inicio, p_fim })
select * from painel_por_linha('2026-10-01', '2026-10-31');

-- P-7 · Balcão × entrega × socorro
-- JS: supabase.rpc('painel_por_atendimento', { p_inicio, p_fim })
select * from painel_por_atendimento('2026-10-01', '2026-10-31');

-- P-8 · Valor do estoque (dinheiro parado em bateria)
-- JS: supabase.from('vw_valor_estoque').select('*').single()
select * from vw_valor_estoque;


-- =====================================================================
-- CADASTROS E HISTÓRICO
-- =====================================================================

-- H-1 · Histórico de vendas por período, com filtro de status
-- JS: supabase.from('vw_vendas_lista').select('*')
--       .gte('data_local', p_inicio).lte('data_local', p_fim)
--       .order('data_hora', { ascending: false }).range(0, 49)       // 50 por página
select numero, data_hora, cliente_nome, total, status, pagamentos_resumo, lucro_bruto
  from vw_vendas_lista where data_local between '2026-10-01' and '2026-10-31'
 order by data_hora desc limit 50;

-- H-2 · Detalhe da venda (itens + pagamentos)
-- JS: supabase.from('vendas').select(`*, clientes(nome, telefone),
--       venda_itens(quantidade, preco_unitario, desconto_rateado, total_item, garantia_ate, produtos(modelo)),
--       venda_pagamentos(valor, parcelas, formas_pagamento(nome))`).eq('id', vendaId).single()

-- H-3 · Cancelar venda / compra
-- JS: supabase.rpc('cancelar_venda',  { p_venda_id,  p_motivo })
--     supabase.rpc('cancelar_compra', { p_compra_id, p_motivo })

-- H-4 · Histórico de compras
-- JS: supabase.from('vw_compras_lista').select('*').order('data_compra', { ascending: false }).range(0, 49)
select numero, data_compra, fornecedor_nome, total, status, itens_resumo
  from vw_compras_lista order by data_compra desc, numero desc limit 50;

-- H-5 · Histórico e garantias de um cliente
-- JS: supabase.from('vw_venda_itens_detalhe').select('venda_numero, data_hora, modelo, total_item, garantia_ate, status')
--       .eq('cliente_id', clienteId).order('data_hora', { ascending: false })
select venda_numero, data_hora, modelo, total_item, garantia_ate, status
  from vw_venda_itens_detalhe
 where cliente_id = (select id from clientes order by created_at limit 1)
 order by data_hora desc;

-- H-6 · Produtos (cadastro). estoque_atual e custo_medio NÃO podem ser enviados.
-- JS: supabase.from('produtos').update({ preco_venda: 460, estoque_minimo: 2 }).eq('id', produtoId)
--     supabase.from('produtos').insert({ marca: 'Heliar', modelo: 'HF60DD', linha: 'Heliar Automotiva', aplicacoes: '...' })

-- H-7 · Configuração da loja
-- JS: supabase.from('loja_config').update({ telefone, rodape_comprovante }).eq('id', 1)

-- H-8 · Exportar vendas do mês em CSV (botão "Exportar dados")
-- JS: supabase.from('vw_venda_itens_detalhe').select('*').gte('data_local', ini).lte('data_local', fim).csv()


-- =====================================================================
-- NOTA FISCAL E EDIÇÃO DA VENDA (migração 002) — o sistema não emite nota
-- =====================================================================

-- N-1 · Vendas sem nota (filtro "Sem nota" e alerta do Início)
-- JS: supabase.from('vw_vendas_lista').select('id, numero, data_hora, total, cliente_nome')
--       .eq('situacao_nota', 'pendente').order('data_hora', { ascending: false })
select id, numero, data_hora, total, cliente_nome from vw_vendas_lista where situacao_nota = 'pendente' order by data_hora desc;

-- N-2 · Contadores do alerta
-- JS: supabase.from('vw_resumo_notas').select('*').single()
select * from vw_resumo_notas;

-- N-3 · Registrar a nota colando só a chave (modelo, série e número saem dela; valor = total da venda)
-- JS: supabase.from('notas_fiscais').insert({ venda_id, chave, data_emissao, cpf_cnpj_destinatario, obs }).select().single()
--     Sem chave: insert({ venda_id, modelo: 65, serie: 1, numero: 130 })
-- Erros (error.message, prontos para mostrar): chave com tamanho errado, dígito verificador errado,
--   chave que não confere com o número, nota em venda cancelada, segunda nota na mesma venda (código 23505).

-- N-4 · Validar a chave enquanto digita (opcional; o insert valida de novo)
-- JS: supabase.rpc('fn_chave_nfe_valida', { p_chave: chaveSoNumeros })
select fn_chave_nfe_valida('23261012345678000195550010000000421876543217');

-- N-5 · Corrigir ou marcar a nota como cancelada (não há delete)
-- JS: supabase.from('notas_fiscais').update({ numero: 131 }).eq('id', notaId)
--     supabase.from('notas_fiscais').update({ situacao: 'cancelada', motivo_cancelamento }).eq('id', notaId)

-- N-6 · Histórico de notas de uma venda
-- JS: supabase.from('vw_notas_fiscais').select('*').eq('venda_id', vendaId).order('created_at')

-- N-7 · Editar cliente, atendimento e observação (itens/valores/pagamentos não)
-- JS: supabase.rpc('atualizar_venda', { p_venda_id: vendaId, p: { cliente_id, tipo_atendimento, local_atendimento, obs } })
