// Venda registrada (#vender/ok): confirmação e comprovante para o WhatsApp do cliente.
import { supabase, ok, mensagemDeErro } from '../supabase.js';
import { icone } from '../icones.js';
import { $, esc, dinheiro, data, hora } from '../util.js';

const ATENDIMENTO = { balcao: 'Balcão', entrega: 'Entrega', socorro: 'Socorro' };

/** Texto do comprovante (formatação do WhatsApp: *negrito*). */
export function textoComprovante(venda, itens, loja) {
  const linhas = [
    `*${loja?.nome_loja ?? 'N E Baterias'}* - Venda nº ${venda.numero}`,
    `${data(venda.data_hora)} ${hora(venda.data_hora)}`,
    ...itens.map((i) => `${i.quantidade}× Bateria ${i.marca} ${i.modelo} - ${dinheiro(i.quantidade * i.preco_unitario)}`),
  ];
  if (Number(venda.desconto_total) > 0) linhas.push(`Desconto: - ${dinheiro(venda.desconto_total)}`);
  linhas.push(`*Total: ${dinheiro(venda.total)}*${venda.pagamentos_resumo ? ` (${venda.pagamentos_resumo})` : ''}`);
  const garantias = [...new Set(itens.map((i) => i.garantia_ate).filter(Boolean))];
  if (garantias.length === 1) linhas.push(`Garantia até ${data(garantias[0] + 'T12:00')}`);
  else for (const i of itens) if (i.garantia_ate) linhas.push(`Garantia ${i.modelo} até ${data(i.garantia_ate + 'T12:00')}`);
  if (loja?.rodape_comprovante) linhas.push(loja.rodape_comprovante);
  const contato = [loja?.telefone?.split('/')[0]?.trim(), loja?.instagram].filter(Boolean).join(' · ');
  if (contato) linhas.push(contato);
  return linhas.join('\n');
}

export async function renderVendaRegistrada(raiz, registrada, aoSair) {
  raiz.innerHTML = '<div class="carregando">Carregando…</div>';
  let venda;
  let itens;
  let loja;
  try {
    [venda, itens, loja] = await Promise.all([
      supabase.from('vw_vendas_lista')
        .select('id, numero, data_hora, total, desconto_total, pagamentos_resumo, tipo_atendimento, local_atendimento, cliente_telefone')
        .eq('id', registrada.id).single().then(ok),
      supabase.from('vw_venda_itens_detalhe')
        .select('modelo, marca, quantidade, preco_unitario, total_item, garantia_ate')
        .eq('venda_id', registrada.id).order('modelo').then(ok),
      supabase.from('loja_config').select('*').single().then(ok),
    ]);
  } catch (e) {
    raiz.innerHTML = `<div class="cartao"><p><strong>Venda nº ${registrada.numero} registrada.</strong></p>
      <p class="msg-erro">Não foi possível montar o comprovante: ${esc(mensagemDeErro(e))}</p>
      <a class="btn btn-primario" href="#vender">Nova venda</a></div>`;
    return;
  }

  const texto = textoComprovante(venda, itens, loja);
  const tel = String(venda.cliente_telefone ?? '').replace(/\D/g, '');
  const linkWhats = `https://wa.me/${tel ? `55${tel}` : ''}?text=${encodeURIComponent(texto)}`;
  const atendimento = ATENDIMENTO[venda.tipo_atendimento]
    + (venda.local_atendimento ? `${venda.tipo_atendimento === 'entrega' ? ' na' : ' em'} ${venda.local_atendimento}` : '');

  raiz.innerHTML = `
    <div class="venda-ok">
      <div class="venda-ok-topo">
        <span class="selo-ok">${icone('check', 44, 3)}</span>
        <h1 class="titulo">Venda nº ${venda.numero} registrada</h1>
        <p class="texto-aux grande">${[dinheiro(venda.total), venda.pagamentos_resumo, atendimento].filter(Boolean).map(esc).join(' · ')}</p>
        ${registrada.estoque_negativo ? '<p class="nota nota-alerta">Algum item ficou com estoque negativo. Lance a entrada quando a mercadoria chegar.</p>' : ''}
      </div>
      <div class="cartao comprovante">
        <div class="rotulo-caps">Comprovante para o cliente</div>
        <pre>${esc(texto)}</pre>
      </div>
      <div class="pilha botoes-ok">
        <a class="btn btn-escuro btn-grande" href="${linkWhats}" target="_blank" rel="noopener">${icone('whatsapp', 22)}${tel ? 'Enviar no WhatsApp do cliente' : 'Enviar comprovante no WhatsApp'}</a>
        <button type="button" class="btn btn-secundario" id="copiar">Copiar texto</button>
        <a class="btn btn-primario btn-grande" href="#vender">${icone('mais', 22, 2.4)}Nova venda</a>
        <a class="link-btn" href="#inicio">Voltar ao início</a>
      </div>
    </div>`;

  $('#copiar', raiz).addEventListener('click', async (e) => {
    try {
      await navigator.clipboard.writeText(texto);
      e.target.textContent = 'Texto copiado';
    } catch {
      e.target.textContent = 'Não foi possível copiar';
    }
  });

  return aoSair;
}
