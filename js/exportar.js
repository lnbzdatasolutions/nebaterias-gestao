// Exportação de dados em CSV (abre no Excel e no Google Planilhas).
// Usada em Mais/Configurações, Estoque e Clientes.
import { supabase, ok } from './supabase.js';
import { baixarCSV, telefone, hojeISO, FUSO } from './util.js';

const dataBR = (d) => (d ? new Date(d.length === 10 ? `${d}T12:00` : d).toLocaleDateString('pt-BR', { timeZone: FUSO }) : '');
const horaBR = (d) => new Date(d).toLocaleTimeString('pt-BR', { timeZone: FUSO, hour: '2-digit', minute: '2-digit' });
const num = (v) => (v === null || v === undefined ? '' : Number(v));
const ATENDIMENTO = { balcao: 'Balcão', entrega: 'Entrega', socorro: 'Socorro' };
const NOTA = { pendente: 'Sem nota', emitida: 'Emitida', cancelar_nota: 'Cancelar nota', nao_se_aplica: '' };
const sufixo = (ini, fim) => (ini ? `${ini}-a-${fim}` : `ate-${hojeISO()}`);

/** Uma linha por venda (com nota fiscal), no período [ini, fim] ou tudo. */
export async function exportarVendas(ini, fim) {
  let q = supabase.from('vw_vendas_lista').select('*').order('data_hora');
  if (ini) q = q.gte('data_local', ini).lte('data_local', fim);
  const vendas = ok(await q);
  baixarCSV(`vendas-${sufixo(ini, fim)}.csv`, [
    ['Venda', 'Data', 'Hora', 'Situação', 'Cliente', 'Telefone', 'Baterias', 'Qtd', 'Subtotal', 'Desconto', 'Total',
      'Pagamento', 'Taxas', 'Custo (CMV)', 'Lucro bruto', 'Lucro líquido', 'Atendimento', 'Local', 'Nota fiscal', 'Nº da nota', 'Observação', 'Motivo do cancelamento'],
    ...vendas.map((v) => [v.numero, dataBR(v.data_hora), horaBR(v.data_hora), v.status === 'cancelada' ? 'Cancelada' : 'Concluída',
      v.cliente_nome, telefone(v.cliente_telefone), String(v.itens_resumo ?? '').replace(/(\d+)x /g, '$1× '), num(v.qtd_baterias),
      num(v.subtotal), num(v.desconto_total), num(v.total), v.pagamentos_resumo, num(v.taxas), num(v.cmv), num(v.lucro_bruto),
      num(v.lucro_liquido), ATENDIMENTO[v.tipo_atendimento], v.local_atendimento, NOTA[v.situacao_nota] ?? '',
      v.nota_numero ? `${v.nota_modelo === 55 ? 'NF-e' : 'NFC-e'} ${v.nota_numero}` : '', v.obs, v.motivo_cancelamento]),
  ]);
  return vendas.length;
}

/** Uma linha por entrada (compra no revendedor). */
export async function exportarCompras(ini, fim) {
  let q = supabase.from('vw_compras_lista').select('*').order('data_compra').order('numero');
  if (ini) q = q.gte('data_compra', ini).lte('data_compra', fim);
  const compras = ok(await q);
  baixarCSV(`compras-${sufixo(ini, fim)}.csv`, [
    ['Entrada', 'Data', 'Situação', 'Fornecedor', 'Nº da nota', 'Baterias', 'Qtd', 'Valor das baterias', 'Frete', 'Outros custos', 'Abatimento sucata', 'Total pago', 'Motivo do cancelamento'],
    ...compras.map((c) => [c.numero, dataBR(c.data_compra), c.status === 'cancelada' ? 'Cancelada' : 'Concluída', c.fornecedor_nome,
      c.numero_nota, String(c.itens_resumo ?? '').replace(/(\d+)x /g, '$1× '), num(c.qtd_baterias), num(c.valor_produtos),
      num(c.frete), num(c.outros_custos), num(c.abatimento_sucata), num(c.total), c.motivo_cancelamento]),
  ]);
  return compras.length;
}

/** Retrato do estoque de hoje (todas as baterias, inclusive inativas). */
export async function exportarEstoque() {
  const todos = ok(await supabase.rpc('buscar_produtos', { p_somente_ativos: false, p_limite: 1000 }));
  baixarCSV(`estoque-${hojeISO()}.csv`, [
    ['Marca', 'Modelo', 'Linha', 'Aplicações', 'Saldo', 'Mínimo', 'Custo médio', 'Preço de venda', 'Preço sem usada', 'Margem %', 'Valor em estoque (custo)', 'Ativo'],
    ...todos.map((p) => [p.marca, p.modelo, p.linha, p.aplicacoes, p.estoque_atual, p.estoque_minimo, num(p.custo_medio),
      num(p.preco_venda), num(p.preco_venda_sem_sucata), num(p.margem_pct), num(p.valor_estoque_custo), p.ativo ? 'sim' : 'não']),
  ]);
  return todos.length;
}

/** Todos os clientes cadastrados. */
export async function exportarClientes() {
  const todos = ok(await supabase.from('clientes').select('nome, telefone, cpf_cnpj, veiculo, placa, obs, created_at').order('nome'));
  baixarCSV(`clientes-${hojeISO()}.csv`, [
    ['Nome', 'Telefone', 'CPF/CNPJ', 'Veículo', 'Placa', 'Observações', 'Cadastro'],
    ...todos.map((c) => [c.nome, telefone(c.telefone), c.cpf_cnpj, c.veiculo, c.placa, c.obs, dataBR(c.created_at)]),
  ]);
  return todos.length;
}
