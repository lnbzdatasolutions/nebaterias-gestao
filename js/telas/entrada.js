// Entrada (#entrada): compra no revendedor. Soma ao estoque e recalcula o custo médio
// (tudo dentro da RPC registrar_compra). A tela só mostra a prévia dos números.
import { supabase, ok, mensagemDeErro } from '../supabase.js';
import { icone } from '../icones.js';
import { abrirJanela } from '../componentes/janela.js';
import { escolherBateria } from '../componentes/escolher-bateria.js';
import { $, esc, dinheiro, numero, valorCampo, centavos, hojeISO, saldo, aviso, ocupado, FUSO } from '../util.js';

const CHAVE_FORNECEDOR = 'ne-ultimo-fornecedor';
const lerLocal = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const gravarLocal = (k, v) => { try { localStorage.setItem(k, v); } catch { /* sem armazenamento */ } };
const diaMes = (d) => new Date(d + 'T12:00').toLocaleDateString('pt-BR', { timeZone: FUSO, day: '2-digit', month: '2-digit' });

// Rascunho fica na memória enquanto o app está aberto: sair da aba não perde o que foi digitado.
let rascunho = novoRascunho();
function novoRascunho() {
  return {
    fornecedor_id: lerLocal(CHAVE_FORNECEDOR) || '',
    data_compra: hojeISO(),
    numero_nota: '',
    itens: [], // { produto, quantidade, preco_tabela, desconto_unitario, ultima }
    frete: '', outros_custos: '', qtd_sucata_entregue: '', abatimento_sucata: '',
  };
}

/** Mesmo cálculo da RPC: rateio pelo valor de cada linha e custo médio ponderado. */
function calcular(r) {
  const linhas = r.itens.map((it) => {
    const qtd = Math.max(parseInt(it.quantidade, 10) || 0, 0);
    const unit = Math.max(numero(it.preco_tabela) - numero(it.desconto_unitario), 0);
    return { it, qtd, unit, valor: qtd * unit };
  });
  const base = linhas.reduce((s, l) => s + l.valor, 0);
  const custos = numero(r.frete) + numero(r.outros_custos);
  const abat = numero(r.abatimento_sucata);
  const projecao = new Map(); // produto_id → { saldo, custo } acumulando linhas repetidas
  for (const l of linhas) {
    const peso = base > 0 ? l.valor / base : 0;
    l.custoFinal = l.qtd > 0 ? (l.valor + custos * peso - abat * peso) / l.qtd : 0;
    const p = l.it.produto;
    const antes = projecao.get(p.id) ?? { saldo: Number(p.estoque_atual), custo: Number(p.custo_medio) };
    const depoisSaldo = antes.saldo + l.qtd;
    const depoisCusto = antes.saldo <= 0 ? l.custoFinal : (antes.saldo * antes.custo + l.qtd * l.custoFinal) / depoisSaldo;
    l.antes = { saldo: Number(p.estoque_atual), custo: Number(p.custo_medio) };
    l.depois = { saldo: depoisSaldo, custo: depoisCusto };
    projecao.set(p.id, { saldo: depoisSaldo, custo: depoisCusto });
  }
  const unidades = linhas.reduce((s, l) => s + l.qtd, 0);
  return { linhas, base: centavos(base), custos, abat, unidades, total: centavos(base + custos - abat) };
}

export async function render(raiz, { irPara }) {
  const r = rascunho;

  raiz.innerHTML = `
    <header class="cabecalho">
      <div class="cabecalho-titulo">
        <h1 class="titulo">Nova entrada</h1>
        <p class="texto-aux"><span class="so-celular">Compra no revendedor · soma ao estoque</span><span class="so-notebook">Compra no revendedor: soma ao estoque e atualiza o custo médio</span></p>
      </div>
    </header>
    <div class="grade-lateral">
      <div class="pilha">
        <section class="cartao">
          <div class="grade-cabecalho-compra">
            <div class="campo campo-fornecedor">
              <label for="en-forn">Fornecedor</label>
              <select id="en-forn" name="fornecedor_id"></select>
            </div>
            <div class="campo">
              <label for="en-data">Data</label>
              <input id="en-data" name="data_compra" type="date" max="${hojeISO()}" value="${r.data_compra}">
            </div>
            <div class="campo">
              <label for="en-nota">Nº da nota <span class="opcional">(opcional)</span></label>
              <input id="en-nota" name="numero_nota" inputmode="numeric" autocomplete="off" value="${esc(r.numero_nota)}">
            </div>
          </div>
        </section>

        <section class="cartao cartao-destaque" id="sec-itens">
          <h2 class="cartao-h">Baterias</h2>
          <div id="itens"></div>
          <button type="button" id="adicionar" class="btn btn-tracejado">${icone('mais', 20, 2.4)}Adicionar bateria</button>
        </section>

        <section class="cartao">
          <h2 class="cartao-h">Frete e sucata <span class="texto-aux normal">(divididos entre as baterias pelo valor)</span></h2>
          <div class="grade-4">
            <div class="campo"><label for="en-frete">Frete (R$)</label><input id="en-frete" name="frete" inputmode="decimal" placeholder="0,00" autocomplete="off" value="${esc(r.frete)}"></div>
            <div class="campo"><label for="en-outros">Outros custos (R$)</label><input id="en-outros" name="outros_custos" inputmode="decimal" placeholder="0,00" autocomplete="off" value="${esc(r.outros_custos)}"></div>
            <div class="campo"><label for="en-suc">Sucatas entregues</label><input id="en-suc" name="qtd_sucata_entregue" inputmode="numeric" placeholder="0" autocomplete="off" value="${esc(r.qtd_sucata_entregue)}"></div>
            <div class="campo"><label for="en-abat">Abatimento (R$)</label><input id="en-abat" name="abatimento_sucata" inputmode="decimal" placeholder="0,00" autocomplete="off" value="${esc(r.abatimento_sucata)}"></div>
          </div>
        </section>
      </div>

      <div class="pilha coluna-resumo">
        <section class="cartao cartao-escuro" id="resumo"></section>
        <section class="cartao so-notebook" id="ultimas"><h2 class="cartao-h">Últimas entradas</h2><p class="texto-aux">Carregando…</p></section>
      </div>
    </div>

    <div class="barra-acao so-celular">
      <div><div class="texto-aux">Total pago</div><div class="total-barra" id="total-cel">R$ 0,00</div></div>
      <button type="button" class="btn btn-primario btn-acao" data-registrar>Registrar entrada</button>
    </div>`;

  const selForn = $('#en-forn', raiz);

  async function carregarFornecedores(selecionar) {
    const lista = ok(await supabase.from('fornecedores').select('id, nome').eq('ativo', true).order('nome'));
    selForn.innerHTML = `<option value="">${lista.length ? 'Sem fornecedor' : 'Nenhum cadastrado'}</option>`
      + lista.map((f) => `<option value="${f.id}">${esc(f.nome)}</option>`).join('')
      + '<option value="__novo">+ Cadastrar fornecedor…</option>';
    const alvo = selecionar ?? r.fornecedor_id;
    selForn.value = lista.some((f) => f.id === alvo) ? alvo : '';
    r.fornecedor_id = selForn.value;
  }

  selForn.addEventListener('change', async () => {
    if (selForn.value !== '__novo') { r.fornecedor_id = selForn.value; return; }
    const novo = await novoFornecedor();
    await carregarFornecedores(novo?.id ?? r.fornecedor_id);
  });

  function desenharItens() {
    const calc = calcular(r);
    const el = $('#itens', raiz);
    $('#sec-itens', raiz).classList.toggle('cartao-destaque', r.itens.length > 0);
    if (!r.itens.length) {
      el.innerHTML = '<p class="texto-aux pad-v">Toque em "Adicionar bateria" para começar.</p>';
    } else {
      el.innerHTML = calc.linhas.map((l, i) => {
        const it = l.it;
        const u = it.ultima;
        return `
          <div class="item-compra" data-i="${i}">
            <div class="item-compra-topo">
              <div><span class="modelo">${esc(it.produto.modelo)}</span> <span class="texto-aux">${esc(it.produto.linha)}</span></div>
              <button type="button" class="btn-icone btn-remover" data-remover="${i}" aria-label="Remover ${esc(it.produto.modelo)}">${icone('lixeira', 20)}</button>
            </div>
            ${u ? `<p class="texto-aux texto-p">Última compra: ${dinheiro(u.custo_unitario_final)} em ${diaMes(u.data_compra)}</p>` : ''}
            <div class="grade-3">
              <div class="campo"><label>Qtd</label><input data-campo="quantidade" inputmode="numeric" autocomplete="off" value="${esc(it.quantidade)}"></div>
              <div class="campo"><label>Tabela</label><input data-campo="preco_tabela" inputmode="decimal" placeholder="0,00" autocomplete="off" value="${esc(it.preco_tabela)}"></div>
              <div class="campo"><label>Desconto (un.)</label><input data-campo="desconto_unitario" inputmode="decimal" placeholder="0,00" autocomplete="off" value="${esc(it.desconto_unitario)}"></div>
            </div>
            <div class="linha-total"><span class="texto-aux">Custo final por bateria</span><strong data-custo="${i}">${dinheiro(l.custoFinal)}</strong></div>
          </div>`;
      }).join('');
    }
    desenharResumo(calc);
  }

  function desenharResumo(calc = calcular(r)) {
    for (const l of calc.linhas) {
      const el = raiz.querySelector(`[data-custo="${calc.linhas.indexOf(l)}"]`);
      if (el) el.textContent = dinheiro(l.custoFinal);
    }
    $('#total-cel', raiz).textContent = dinheiro(calc.total);
    const unidadeTxt = calc.unidades === 1 ? '1 un.' : `${calc.unidades} un.`;
    $('#resumo', raiz).innerHTML = `
      <h2 class="cartao-h so-notebook">Resumo</h2>
      <div class="linha-resumo"><span>Baterias (${unidadeTxt})</span><span>${dinheiro(calc.base)}</span></div>
      ${calc.custos ? `<div class="linha-resumo"><span>Frete e outros</span><span>+ ${dinheiro(calc.custos)}</span></div>` : ''}
      ${calc.abat ? `<div class="linha-resumo"><span>Sucata${numero(r.qtd_sucata_entregue) ? ` (${parseInt(r.qtd_sucata_entregue, 10)})` : ''}</span><span>- ${dinheiro(calc.abat)}</span></div>` : ''}
      <div class="linha-resumo total so-notebook"><span>Total pago</span><strong>${dinheiro(calc.total)}</strong></div>
      ${calc.linhas.length ? `
        <div class="sep"></div>
        <div class="texto-sub">Depois de registrar</div>
        ${calc.linhas.filter((l) => l.qtd > 0).map((l) => `
          <div class="linha-resumo projecao">
            <span>${esc(l.it.produto.modelo)} · estoque ${saldo(l.antes.saldo)} → <b class="amarelo-claro">${saldo(l.depois.saldo)}</b></span>
            <span>custo ${l.antes.custo > 0 ? dinheiro(l.antes.custo) : '-'} → <b class="amarelo-claro">${dinheiro(l.depois.custo)}</b></span>
          </div>`).join('')}` : ''}
      <button type="button" class="btn btn-primario btn-grande so-notebook" data-registrar>Registrar entrada</button>`;
  }

  async function adicionar() {
    const p = await escolherBateria();
    if (!p) return;
    const { data: ultima } = await supabase.from('vw_ultima_compra_produto')
      .select('preco_tabela, desconto_unitario, custo_unitario_final, data_compra, fornecedor_id')
      .eq('produto_id', p.id).maybeSingle();
    r.itens.push({
      produto: p,
      quantidade: '1',
      preco_tabela: ultima ? valorCampo(ultima.preco_tabela) : '',
      desconto_unitario: ultima && Number(ultima.desconto_unitario) ? valorCampo(ultima.desconto_unitario) : '',
      ultima,
    });
    desenharItens();
    const ultimo = raiz.querySelector(`.item-compra[data-i="${r.itens.length - 1}"] [data-campo="${ultima ? 'quantidade' : 'preco_tabela'}"]`);
    ultimo?.focus();
    ultimo?.select();
  }

  async function carregarUltimas() {
    const el = $('#ultimas', raiz);
    try {
      const compras = ok(await supabase.from('vw_compras_lista')
        .select('numero, data_compra, itens_resumo, total, status').order('numero', { ascending: false }).limit(5));
      el.innerHTML = `<h2 class="cartao-h">Últimas entradas</h2>` + (compras.length ? `<ul class="lista-simples">
        ${compras.map((c) => `<li class="${c.status === 'cancelada' ? 'cancelada' : ''}">
          <span><strong>Nº ${c.numero}</strong> <span class="texto-aux">${diaMes(c.data_compra)} · ${esc(String(c.itens_resumo).replace(/(\d+)x /g, '$1× '))}</span></span>
          <strong class="riscavel">${dinheiro(c.total)}</strong></li>`).join('')}
      </ul>` : '<p class="texto-aux">Nenhuma entrada registrada ainda.</p>');
    } catch (e) {
      el.innerHTML = `<p class="msg-erro">${esc(mensagemDeErro(e))}</p>`;
    }
  }

  async function registrar(botao) {
    const calc = calcular(r);
    const falha = !r.itens.length ? 'Adicione pelo menos uma bateria.'
      : calc.linhas.some((l) => l.qtd <= 0) ? 'Quantidade deve ser maior que zero.'
      : calc.linhas.some((l) => numero(l.it.preco_tabela) <= 0) ? 'Informe o preço de tabela de cada bateria.'
      : calc.linhas.some((l) => numero(l.it.desconto_unitario) > numero(l.it.preco_tabela)) ? 'Desconto maior que o preço de tabela.'
      : r.data_compra > hojeISO() ? 'A data da compra não pode ser futura.'
      : calc.total < 0 ? 'O abatimento da sucata é maior que o valor da compra.'
      : !navigator.onLine ? 'Sem internet. Tente de novo quando o sinal voltar.' : '';
    if (falha) return aviso(falha, 'erro');

    const compra = {
      fornecedor_id: r.fornecedor_id || null,
      data_compra: r.data_compra,
      numero_nota: r.numero_nota.trim() || null,
      frete: numero(r.frete), outros_custos: numero(r.outros_custos),
      qtd_sucata_entregue: parseInt(r.qtd_sucata_entregue, 10) || 0,
      abatimento_sucata: numero(r.abatimento_sucata),
      itens: calc.linhas.map((l) => ({
        produto_id: l.it.produto.id, quantidade: l.qtd,
        preco_tabela: numero(l.it.preco_tabela), desconto_unitario: numero(l.it.desconto_unitario),
      })),
    };
    await ocupado(botao, async () => {
      try {
        const res = ok(await supabase.rpc('registrar_compra', { p: compra }));
        if (r.fornecedor_id) gravarLocal(CHAVE_FORNECEDOR, r.fornecedor_id);
        aviso(`Entrada nº ${res.numero} registrada: ${dinheiro(res.total)}.`, 'ok');
        rascunho = novoRascunho();
        irPara('entrada'); // tela limpa para a próxima entrada
      } catch (e) {
        aviso(mensagemDeErro(e), 'erro');
      }
    }, 'Registrando…');
  }

  // eventos
  raiz.addEventListener('input', (e) => {
    const t = e.target;
    if (t.dataset.campo) {
      const i = Number(t.closest('[data-i]').dataset.i);
      r.itens[i][t.dataset.campo] = t.value;
      desenharResumo();
    } else if (t.name && t.name in r) {
      r[t.name] = t.value;
      desenharResumo();
    }
  });
  raiz.addEventListener('click', (e) => {
    const alvo = e.target.closest('[data-remover], #adicionar, [data-registrar]');
    if (!alvo) return;
    if (alvo.id === 'adicionar') adicionar();
    else if (alvo.dataset.remover !== undefined) { r.itens.splice(Number(alvo.dataset.remover), 1); desenharItens(); }
    else registrar(alvo);
  });

  desenharItens();
  try {
    await carregarFornecedores();
  } catch (e) {
    aviso(mensagemDeErro(e), 'erro');
  }
  carregarUltimas();
}

function novoFornecedor() {
  return abrirJanela({
    titulo: 'Novo fornecedor',
    html: `
      <form class="form" novalidate>
        <div class="campo"><label for="fo-nome">Nome *</label><input id="fo-nome" name="nome" autocomplete="off" autofocus placeholder="Revendedor Moura Centro"></div>
        <div class="grade-2">
          <div class="campo"><label for="fo-tel">Telefone</label><input id="fo-tel" name="telefone" type="tel" inputmode="tel" autocomplete="off"></div>
          <div class="campo"><label for="fo-cid">Cidade</label><input id="fo-cid" name="cidade" autocomplete="off" value="Fortaleza"></div>
        </div>
        <p class="msg-erro" hidden></p>
        <button class="btn btn-primario btn-grande" type="submit">Salvar fornecedor</button>
      </form>`,
    montar(corpo, fechar) {
      const f = $('form', corpo);
      f.addEventListener('submit', (e) => {
        e.preventDefault();
        const erro = $('.msg-erro', f);
        const dados = { nome: f.nome.value.trim(), telefone: f.telefone.value.replace(/\D/g, '') || null, cidade: f.cidade.value.trim() || null };
        if (!dados.nome) { erro.textContent = 'Informe o nome.'; erro.hidden = false; return; }
        ocupado($('button', f), async () => {
          try {
            fechar(ok(await supabase.from('fornecedores').insert(dados).select('id, nome').single()));
          } catch (err) {
            erro.textContent = mensagemDeErro(err);
            erro.hidden = false;
          }
        });
      });
    },
  });
}

