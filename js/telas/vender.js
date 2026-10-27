// Vender (#vender, #vender/pagamento, #vender/ok).
// Celular: passo 1 (baterias) e passo 2 (pagamento). Notebook: tudo numa tela.
// A venda é gravada só pela RPC registrar_venda (tudo ou nada).
import { supabase, ok, mensagemDeErro } from '../supabase.js';
import { icone } from '../icones.js';
import { confirmar } from '../componentes/janela.js';
import { abrirJanelaCliente } from '../componentes/janela-novo-cliente.js';
import { abrirJanelaBateria } from '../componentes/janela-nova-bateria.js';
import {
  $, esc, dinheiro, numero, valorCampo, centavos, saldo, aplicacoesCurtas,
  telefone, iniciais, hora, debounce, aviso, ocupado, ehNotebook, FUSO,
} from '../util.js';
import { renderVendaRegistrada } from './venda-registrada.js';

const ATENDIMENTOS = [['balcao', 'Balcão'], ['entrega', 'Entrega'], ['socorro', 'Socorro']];

// A venda em andamento fica na memória: trocar de aba ou abrir uma janela não perde nada.
let venda = novaVenda();
let formasCache = null;
let ultimaVenda = null;

function novaVenda() {
  return {
    termo: '',
    itens: [], // { produto, quantidade, preco }
    sucata: true,
    descTipo: 'valor',
    descValor: '',
    pagamentos: [], // { forma, valor, parcelas, manual }
    atendimento: 'balcao',
    local: '',
    cliente: null,
    dataHora: '', // 'aaaa-mm-ddThh:mm' no horário de Fortaleza; vazio = agora
    verLucro: false,
  };
}

function precoCatalogo(p, sucata) {
  return sucata || !p.preco_venda_sem_sucata ? Number(p.preco_venda || 0) : Number(p.preco_venda_sem_sucata);
}

function totais(v = venda) {
  const subtotal = centavos(v.itens.reduce((s, it) => s + it.quantidade * numero(it.preco), 0));
  const d = numero(v.descValor);
  const desconto = centavos(v.descTipo === 'percentual' ? subtotal * Math.min(d, 100) / 100 : Math.min(d, subtotal));
  const total = centavos(subtotal - desconto);
  const unidades = v.itens.reduce((s, it) => s + it.quantidade, 0);
  const cmv = v.itens.reduce((s, it) => s + it.quantidade * Number(it.produto.custo_medio || 0), 0);
  const taxas = v.pagamentos.reduce((s, p) => s + numero(p.valor) * Number(p.forma.taxa_percentual || 0) / 100, 0);
  const somaPag = centavos(v.pagamentos.reduce((s, p) => s + numero(p.valor), 0));
  const fator = subtotal > 0 ? total / subtotal : 1;
  const abaixoCusto = v.itens.filter((it) => Number(it.produto.custo_medio) > 0 && numero(it.preco) * fator < Number(it.produto.custo_medio));
  return { subtotal, desconto, total, unidades, lucro: centavos(total - cmv - taxas), cmv, somaPag, abaixoCusto };
}

/** Valor automático: a única forma (ou a única não digitada à mão) recebe o que falta. */
function distribuirPagamentos() {
  const { total } = totais();
  const pags = venda.pagamentos;
  if (pags.length === 1) { pags[0].valor = valorCampo(total); pags[0].manual = false; return; }
  const automaticos = pags.filter((p) => !p.manual);
  if (automaticos.length === 1) {
    const resto = centavos(total - pags.filter((p) => p.manual).reduce((s, p) => s + numero(p.valor), 0));
    automaticos[0].valor = resto > 0 ? valorCampo(resto) : '';
  }
}

export async function render(raiz, ctx) {
  const passo = ctx.params[0];
  if (passo === 'ok') {
    if (!ultimaVenda) return ctx.irPara('vender');
    return renderVendaRegistrada(raiz, ultimaVenda, () => { ultimaVenda = null; });
  }
  const noPasso2 = passo === 'pagamento' && venda.itens.length > 0;
  if (passo === 'pagamento' && !noPasso2) history.replaceState(null, '', '#vender');

  if (!formasCache) {
    try {
      formasCache = ok(await supabase.from('formas_pagamento')
        .select('id, nome, permite_parcelas, taxa_percentual').eq('ativo', true).order('ordem'));
    } catch (e) {
      raiz.innerHTML = `<p class="msg-erro">${esc(mensagemDeErro(e))}</p>`;
      return;
    }
  }

  raiz.innerHTML = `
    <div class="venda" data-passo="${noPasso2 ? 2 : 1}">
      <header class="cabecalho so-passo-1">
        <div class="cabecalho-titulo">
          <h1 class="titulo">Nova venda</h1>
          <p class="texto-aux"><span class="so-celular">Passo 1 de 2 · baterias</span><span class="so-notebook">Busque, adicione e feche o pagamento na mesma tela</span></p>
        </div>
        <button type="button" class="btn btn-secundario" data-limpar><span class="so-celular">Limpar</span><span class="so-notebook">Limpar venda</span></button>
      </header>
      <header class="cabecalho so-passo-2 so-celular">
        <a href="#vender" class="btn-icone" aria-label="Voltar para as baterias">${icone('voltar', 26, 2.2)}</a>
        <div class="cabecalho-titulo">
          <h1 class="titulo">Pagamento</h1>
          <p class="texto-aux" id="resumo-passo2"></p>
        </div>
      </header>

      <div class="grade-venda">
        <div class="pilha so-passo-1">
          <section class="cartao">
            <label class="busca busca-grande busca-forte">${icone('busca', 22)}
              <input type="search" id="busca" placeholder="Modelo ou carro (ex.: Onix, M60)" aria-label="Buscar bateria por modelo ou carro" autocomplete="off" value="${esc(venda.termo)}">
            </label>
            <div id="resultados"></div>
            <button type="button" class="link-btn link-forte nao-achou" data-nova-bateria>Não achou? Cadastrar bateria nova</button>
          </section>
          <section id="itens"></section>
        </div>

        <section class="cartao cartao-pagamento so-passo-2" id="pagamento">
          <h2 class="cartao-h so-notebook">Pagamento</h2>
          <div class="bloco">
            <div class="rotulo">Desconto</div>
            <div class="linha-desconto">
              <div class="segmentos segmentos-curto" role="radiogroup" aria-label="Tipo de desconto">
                <button type="button" class="seg" data-desc-tipo="valor" aria-pressed="${venda.descTipo === 'valor'}">R$</button>
                <button type="button" class="seg" data-desc-tipo="percentual" aria-pressed="${venda.descTipo === 'percentual'}">%</button>
              </div>
              <input id="desc-valor" inputmode="decimal" autocomplete="off" placeholder="0" aria-label="Desconto" value="${esc(venda.descValor)}">
              <strong class="vermelho" id="desc-rs"></strong>
            </div>
          </div>
          <div class="bloco">
            <div class="rotulo">Forma de pagamento</div>
            <div class="formas">
              ${formasCache.map((f) => `<button type="button" class="seg seg-g" data-forma="${f.id}" aria-pressed="${venda.pagamentos.some((p) => p.forma.id === f.id)}">${esc(f.nome)}</button>`).join('')}
            </div>
            <div id="pagamentos"></div>
          </div>
          <div class="bloco">
            <div class="rotulo">Atendimento</div>
            <div class="segmentos segmentos-3" role="radiogroup" aria-label="Atendimento">
              ${ATENDIMENTOS.map(([v, t]) => `<button type="button" class="seg" data-atend="${v}" aria-pressed="${venda.atendimento === v}">${t}</button>`).join('')}
            </div>
            <div class="campo" id="campo-local" ${venda.atendimento === 'balcao' ? 'hidden' : ''}>
              <label for="local">Bairro ou endereço</label>
              <input id="local" autocomplete="off" value="${esc(venda.local)}" placeholder="Aldeota">
            </div>
          </div>
          <div class="bloco" id="bloco-cliente"></div>
          <div class="linha-extras">
            <button type="button" class="extra" id="btn-data"></button>
            <button type="button" class="extra extra-lucro" id="btn-lucro"></button>
          </div>
          <div class="campo" id="campo-data" hidden>
            <label for="data-venda">Data e hora da venda</label>
            <input id="data-venda" type="datetime-local" value="${esc(venda.dataHora)}">
          </div>
          <div id="alertas"></div>
          <div class="fechamento so-notebook">
            <div class="linha-total-venda"><span class="texto-aux" data-conta></span><strong class="total-venda" data-total></strong></div>
            <button type="button" class="btn btn-primario btn-grande" data-confirmar>${icone('check', 22, 2.6)}Confirmar venda</button>
          </div>
        </section>
      </div>

      <div class="barra-acao so-celular so-passo-1">
        <div><div class="texto-aux" data-unidades></div><div class="total-barra" data-total></div></div>
        <button type="button" class="btn btn-primario btn-acao" data-continuar>Continuar ${icone('avancar', 22, 2.4)}</button>
      </div>
      <div class="barra-acao barra-acao-coluna so-celular so-passo-2">
        <div class="linha-total-venda"><span class="texto-aux" data-conta></span><strong class="total-venda" data-total></strong></div>
        <button type="button" class="btn btn-primario btn-grande" data-confirmar>${icone('check', 22, 2.6)}Confirmar venda</button>
      </div>
    </div>`;

  const busca = $('#busca', raiz);
  let resultados = [];

  // ---------- busca ----------
  async function buscar() {
    const el = $('#resultados', raiz);
    venda.termo = busca.value.trim();
    if (!venda.termo) { el.innerHTML = ''; resultados = []; return; }
    try {
      resultados = ok(await supabase.rpc('buscar_produtos', { p_termo: venda.termo, p_limite: 20 }));
    } catch (e) {
      el.innerHTML = `<p class="msg-erro">${esc(mensagemDeErro(e))}</p>`;
      return;
    }
    if (!resultados.length) {
      el.innerHTML = `<p class="texto-aux pad-v">Nada encontrado para "${esc(venda.termo)}".</p>`;
      return;
    }
    const estoqueTxt = (p) => (p.estoque_atual > 0
      ? `<span class="verde forte">${p.estoque_atual} em estoque</span>`
      : `<span class="vermelho forte">${p.estoque_atual < 0 ? `${saldo(p.estoque_atual)} em estoque` : 'Sem estoque'}</span>`);
    el.innerHTML = `
      <ul class="linhas resultados so-celular">
        ${resultados.map((p) => `
          <li>
            <div class="min0">
              <div><span class="modelo">${esc(p.modelo)}</span> <span class="texto-aux">${esc(p.linha)}</span></div>
              <div class="texto-medio elipse">${esc(aplicacoesCurtas(p.aplicacoes))}</div>
              <div>${estoqueTxt(p)} · ${p.preco_venda ? dinheiro(p.preco_venda) : '<span class="vermelho">sem preço</span>'}</div>
            </div>
            <button type="button" class="btn-add ${p.estoque_atual > 0 ? 'btn-add-cheio' : ''}" data-add="${p.id}" aria-label="Adicionar ${esc(p.modelo)}">${icone('mais', 24, 2.4)}</button>
          </li>`).join('')}
      </ul>
      <div class="tabela-rolagem so-notebook">
        <table class="tabela tabela-leve">
          <thead><tr><th>Modelo</th><th>Atende</th><th class="num">Estoque</th><th class="num">Preço</th><th></th></tr></thead>
          <tbody>
            ${resultados.map((p) => `
              <tr>
                <td><span class="modelo-p">${esc(p.modelo)}</span><div class="texto-p texto-aux">${esc(p.linha)}</div></td>
                <td class="texto-medio quebra">${esc(aplicacoesCurtas(p.aplicacoes))}</td>
                <td class="num"><strong class="${p.estoque_atual > 0 ? 'verde' : 'vermelho'}">${saldo(p.estoque_atual)}</strong></td>
                <td class="num"><strong>${p.preco_venda ? dinheiro(p.preco_venda) : '-'}</strong></td>
                <td class="num"><button type="button" class="btn btn-p ${p.estoque_atual > 0 ? 'btn-primario' : 'btn-cinza'}" data-add="${p.id}">+ Adicionar</button></td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
  }

  function adicionarProduto(p) {
    const existente = venda.itens.find((it) => it.produto.id === p.id);
    if (existente) existente.quantidade += 1;
    else venda.itens.push({ produto: p, quantidade: 1, preco: valorCampo(precoCatalogo(p, venda.sucata)) });
    if (!p.preco_venda) aviso(`${p.modelo} está sem preço cadastrado: digite o preço.`, 'erro');
    distribuirPagamentos();
    desenharItens();
    desenharPagamentos();
    atualizarTotais();
  }

  // ---------- itens ----------
  function desenharItens() {
    const el = $('#itens', raiz);
    if (!venda.itens.length) {
      el.innerHTML = '<p class="texto-aux pad-v centro">Busque pelo modelo ou pelo carro do cliente e toque em +.</p>';
      return;
    }
    const semUsada = venda.itens.find((it) => it.produto.preco_venda_sem_sucata);
    const stepper = (i, q) => `
      <div class="stepper">
        <button type="button" data-menos="${i}" aria-label="Diminuir">${icone('menos', 20, 2.4)}</button>
        <input inputmode="numeric" data-qtd="${i}" value="${q}" aria-label="Quantidade">
        <button type="button" data-mais="${i}" aria-label="Aumentar">${icone('mais', 20, 2.4)}</button>
      </div>`;
    const estoqueItem = (p) => `<span class="${p.estoque_atual > 0 ? '' : 'vermelho'}">${saldo(p.estoque_atual)} em estoque</span>`;
    el.innerHTML = `
      <h2 class="titulo-secao so-celular">Itens da venda</h2>
      <div class="so-celular pilha">
        ${venda.itens.map((it, i) => `
          <div class="cartao cartao-destaque item-venda">
            <div class="item-compra-topo">
              <div><div class="modelo">${esc(it.produto.modelo)}</div><div class="texto-aux">${esc(it.produto.linha)} · ${estoqueItem(it.produto)}</div></div>
              <button type="button" class="btn-icone btn-borda btn-remover" data-remover="${i}" aria-label="Remover ${esc(it.produto.modelo)}">${icone('lixeira', 20)}</button>
            </div>
            <div class="grade-2">
              <div class="campo"><label>Quantidade</label>${stepper(i, it.quantidade)}</div>
              <div class="campo"><label>Preço unitário</label><input class="forte" inputmode="decimal" data-preco="${i}" value="${esc(it.preco)}" autocomplete="off" aria-label="Preço unitário de ${esc(it.produto.modelo)}"></div>
            </div>
          </div>`).join('')}
      </div>
      <div class="cartao cartao-destaque so-notebook">
        <h2 class="cartao-h">Itens da venda</h2>
        <div class="tabela-rolagem">
          <table class="tabela tabela-form tabela-leve">
            <thead><tr><th>Bateria</th><th>Quantidade</th><th>Preço unitário</th><th class="num">Subtotal</th><th></th></tr></thead>
            <tbody>
              ${venda.itens.map((it, i) => `
                <tr>
                  <td class="quebra"><span class="modelo-p">${esc(it.produto.modelo)}</span><div class="texto-p texto-aux">${estoqueItem(it.produto)} · garantia ${it.produto.garantia_meses} meses</div></td>
                  <td>${stepper(i, it.quantidade)}</td>
                  <td><input class="campo-tabela forte" inputmode="decimal" data-preco="${i}" value="${esc(it.preco)}" autocomplete="off" aria-label="Preço unitário de ${esc(it.produto.modelo)}"></td>
                  <td class="num"><strong data-sub="${i}">${dinheiro(it.quantidade * numero(it.preco))}</strong></td>
                  <td class="num"><button type="button" class="btn-icone btn-borda btn-remover" data-remover="${i}" aria-label="Remover">${icone('lixeira', 18)}</button></td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
        <div class="linha-sucata">
          <strong>Cliente entregou a bateria usada?</strong>
          <div class="segmentos segmentos-curto">
            <button type="button" class="seg" data-sucata="1" aria-pressed="${venda.sucata}">Sim</button>
            <button type="button" class="seg" data-sucata="0" aria-pressed="${!venda.sucata}">Não</button>
          </div>
          ${semUsada ? `<span class="texto-aux">Sem a usada: ${dinheiro(semUsada.produto.preco_venda_sem_sucata)}</span>` : ''}
        </div>
      </div>
      <div class="cartao so-celular pergunta-sucata">
        <strong>Cliente entregou a bateria usada?</strong>
        ${semUsada ? `<p class="texto-aux">Sem a usada, o preço muda para ${dinheiro(semUsada.produto.preco_venda_sem_sucata)}</p>` : ''}
        <div class="segmentos segmentos-2 segmentos-g">
          <button type="button" class="seg" data-sucata="1" aria-pressed="${venda.sucata}">Sim</button>
          <button type="button" class="seg" data-sucata="0" aria-pressed="${!venda.sucata}">Não</button>
        </div>
      </div>`;
  }

  // ---------- pagamento ----------
  function desenharPagamentos() {
    const el = $('#pagamentos', raiz);
    const pags = venda.pagamentos;
    if (!pags.length) { el.innerHTML = ''; return; }
    const parcelas = (p, i) => (p.forma.permite_parcelas ? `
      <select data-parcelas="${i}" aria-label="Parcelas no ${esc(p.forma.nome)}" class="sel-parcelas">
        ${Array.from({ length: 12 }, (_, k) => k + 1).map((n) => `<option value="${n}" ${n === p.parcelas ? 'selected' : ''}>${n === 1 ? 'à vista' : `${n}x`}</option>`).join('')}
      </select>` : '');
    if (pags.length === 1) {
      el.innerHTML = pags[0].forma.permite_parcelas
        ? `<div class="linha-pag"><span>Parcelas</span>${parcelas(pags[0], 0)}</div>` : '';
      return;
    }
    el.innerHTML = `
      <div class="sep"></div>
      <div class="rotulo">Pagamento dividido</div>
      ${pags.map((p, i) => `
        <div class="linha-pag">
          <span>${esc(p.forma.nome)}</span>
          <input inputmode="decimal" data-valor-pag="${i}" value="${esc(p.valor)}" placeholder="0,00" autocomplete="off" aria-label="Valor no ${esc(p.forma.nome)}">
          ${parcelas(p, i)}
        </div>`).join('')}
      <p id="fecha" class="texto-p forte"></p>`;
  }

  function desenharCliente() {
    const el = $('#bloco-cliente', raiz);
    const c = venda.cliente;
    el.innerHTML = `
      <div class="rotulo-linha"><span class="rotulo">Cliente <span class="opcional">(opcional)</span></span>
        <button type="button" class="link-btn link-forte" data-novo-cliente>+ Novo cliente</button></div>
      ${c ? `
        <div class="cliente-escolhido">
          <span class="avatar">${esc(iniciais(c.nome))}</span>
          <div class="min0"><strong>${esc(c.nome)}</strong>
            <div class="texto-aux">${[telefone(c.telefone), c.veiculo, c.placa].filter(Boolean).map(esc).join(' · ')}</div></div>
          <button type="button" class="btn-icone" data-tirar-cliente aria-label="Tirar cliente da venda">${icone('fechar', 20)}</button>
        </div>` : `
        <label class="busca">${icone('busca', 20)}<input type="search" id="busca-cliente" placeholder="Nome, telefone ou placa" autocomplete="off" aria-label="Buscar cliente"></label>
        <ul class="linhas resultados-cliente" id="res-cliente"></ul>`}`;
    const input = $('#busca-cliente', el);
    if (!input) return;
    input.addEventListener('input', debounce(async () => {
      const ul = $('#res-cliente', el);
      const t = input.value.trim();
      if (!t) { ul.innerHTML = ''; return; }
      try {
        const lista = ok(await supabase.rpc('buscar_clientes', { p_termo: t, p_limite: 6 }));
        ul.innerHTML = lista.length ? lista.map((cl) => `
          <li><button type="button" class="linha-botao" data-cliente='${esc(JSON.stringify(cl))}'>
            <span class="avatar avatar-p">${esc(iniciais(cl.nome))}</span>
            <span class="min0"><strong class="d-bloco">${esc(cl.nome)}</strong>
              <span class="texto-aux d-bloco elipse">${[telefone(cl.telefone), cl.veiculo, cl.placa].filter(Boolean).map(esc).join(' · ')}</span></span>
          </button></li>`).join('')
          : `<li class="texto-aux pad-v">Nenhum cliente. <button type="button" class="link-btn" data-novo-cliente>Cadastrar "${esc(t)}"</button></li>`;
      } catch (e) {
        ul.innerHTML = `<li class="msg-erro">${esc(mensagemDeErro(e))}</li>`;
      }
    }));
  }

  function desenharExtras() {
    const agora = hora(new Date());
    const quando = venda.dataHora
      ? new Date(`${venda.dataHora}:00-03:00`).toLocaleString('pt-BR', { timeZone: FUSO, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
      : `Agora · ${agora}`;
    $('#btn-data', raiz).innerHTML = `<span class="texto-aux">Data da venda</span><strong>${quando}</strong>`;
    const t = totais();
    $('#btn-lucro', raiz).innerHTML = venda.verLucro
      ? `${icone('olhoFechado', 22)}<span><span class="texto-aux d-bloco">Lucro estimado</span><strong class="${t.lucro >= 0 ? 'verde' : 'vermelho'}">${dinheiro(t.lucro)}</strong></span>`
      : `${icone('olho', 22)}<strong>Ver lucro</strong>`;
  }

  function atualizarTotais() {
    const t = totais();
    raiz.querySelectorAll('[data-total]').forEach((e) => { e.textContent = dinheiro(t.total); });
    raiz.querySelectorAll('[data-conta]').forEach((e) => {
      e.textContent = t.desconto > 0 ? `${dinheiro(t.subtotal)} - ${dinheiro(t.desconto)}` : '';
    });
    const u = $('[data-unidades]', raiz);
    if (u) u.textContent = `${t.unidades} ${t.unidades === 1 ? 'bateria' : 'baterias'}`;
    $('#desc-rs', raiz).textContent = t.desconto > 0 ? `- ${dinheiro(t.desconto)}` : '';
    venda.itens.forEach((it, i) => {
      const s = raiz.querySelector(`[data-sub="${i}"]`);
      if (s) s.textContent = dinheiro(it.quantidade * numero(it.preco));
    });
    const resumo2 = $('#resumo-passo2', raiz);
    if (resumo2) {
      resumo2.textContent = `Passo 2 de 2 · ${venda.itens.map((it) => `${it.quantidade}× ${it.produto.modelo}`).join(', ')} · ${dinheiro(t.subtotal)}`;
    }
    // valores automáticos do pagamento dividido
    venda.pagamentos.forEach((p, i) => {
      const inp = raiz.querySelector(`[data-valor-pag="${i}"]`);
      if (inp && !p.manual && document.activeElement !== inp) inp.value = p.valor;
    });
    const fecha = $('#fecha', raiz);
    if (fecha) {
      const dif = centavos(t.total - t.somaPag);
      fecha.className = `texto-p forte ${dif === 0 ? 'verde' : 'vermelho'}`;
      fecha.innerHTML = dif === 0 ? `${icone('check', 18, 2.6)} Valores fecham com o total`
        : dif > 0 ? `Faltam ${dinheiro(dif)} para fechar o total` : `Passou ${dinheiro(-dif)} do total`;
    }
    const alertas = $('#alertas', raiz);
    alertas.innerHTML = t.abaixoCusto.length ? `<p class="msg-erro">${icone('alerta', 18)} Abaixo do custo: ${t.abaixoCusto
      .map((it) => `${esc(it.produto.modelo)} (custo ${dinheiro(it.produto.custo_medio)})`).join(', ')}</p>` : '';
    desenharExtras();
  }

  // ---------- confirmar ----------
  async function confirmarVenda(botao) {
    const t = totais();
    const erro = !venda.itens.length ? 'Adicione pelo menos uma bateria.'
      : venda.itens.some((it) => numero(it.preco) <= 0) ? 'Informe o preço de todas as baterias.'
      : t.total > 0 && !venda.pagamentos.length ? 'Escolha a forma de pagamento.'
      : venda.pagamentos.length > 1 && t.somaPag !== t.total ? 'Os valores do pagamento dividido não fecham com o total.'
      : venda.atendimento !== 'balcao' && !venda.local.trim() ? 'Informe o bairro ou endereço da entrega/socorro.'
      : venda.dataHora && new Date(`${venda.dataHora}:00-03:00`) > new Date() ? 'A data da venda não pode ser futura.'
      : !navigator.onLine ? 'Sem internet. Não é possível registrar a venda agora.' : '';
    if (erro) {
      aviso(erro, 'erro');
      if (!ehNotebook() && venda.itens.length && !/bateria|preço/.test(erro)) location.hash = 'vender/pagamento';
      return;
    }
    if (t.abaixoCusto.length && !(await confirmar({
      titulo: 'Preço abaixo do custo',
      texto: `${t.abaixoCusto.map((it) => it.produto.modelo).join(', ')} vai sair abaixo do custo médio. Confirmar mesmo assim?`,
      sim: 'Vender assim', perigo: true,
    }))) return;

    const pagamentos = venda.pagamentos.length === 1
      ? [{ forma_pagamento_id: venda.pagamentos[0].forma.id, valor: t.total, parcelas: venda.pagamentos[0].parcelas }]
      : venda.pagamentos.map((p) => ({ forma_pagamento_id: p.forma.id, valor: numero(p.valor), parcelas: p.parcelas }));
    const p = {
      cliente_id: venda.cliente?.id ?? null,
      desconto_tipo: venda.descTipo,
      desconto_informado: numero(venda.descValor),
      sucata_recebida: venda.sucata,
      tipo_atendimento: venda.atendimento,
      local_atendimento: venda.atendimento === 'balcao' ? null : venda.local.trim(),
      itens: venda.itens.map((it) => ({ produto_id: it.produto.id, quantidade: it.quantidade, preco_unitario: numero(it.preco) })),
      pagamentos: t.total > 0 ? pagamentos : [],
    };
    if (venda.dataHora) p.data_hora = `${venda.dataHora}:00-03:00`;

    await ocupado(botao, async () => {
      let { data, error } = await supabase.rpc('registrar_venda', { p, p_permitir_estoque_negativo: false });
      if (error?.message === 'ESTOQUE_INSUFICIENTE') {
        let faltas = [];
        try { faltas = JSON.parse(error.details); } catch { /* detalhe ausente */ }
        const texto = faltas.map((f) => `${f.modelo}: tem ${saldo(f.estoque_atual)}, vendendo ${f.quantidade_pedida}`).join('; ');
        const sim = await confirmar({
          titulo: 'Estoque ficará negativo',
          texto: `${texto}. Vender mesmo assim? O saldo fica em vermelho até lançar a entrada.`,
          sim: 'Vender mesmo assim',
        });
        if (!sim) return;
        ({ data, error } = await supabase.rpc('registrar_venda', { p, p_permitir_estoque_negativo: true }));
      }
      if (error) {
        aviso(mensagemDeErro(error), 'erro');
        if (/pagamento|parcel/i.test(error.message) && !ehNotebook()) location.hash = 'vender/pagamento';
        return;
      }
      ultimaVenda = { ...data, cliente: venda.cliente };
      venda = novaVenda();
      location.hash = 'vender/ok';
    }, 'Registrando…');
  }

  // ---------- eventos ----------
  raiz.addEventListener('click', async (e) => {
    const a = e.target.closest('button, [data-cliente]');
    if (!a) return;
    const d = a.dataset;
    if (d.add) {
      adicionarProduto(resultados.find((p) => p.id === d.add));
    } else if (d.novaBateria !== undefined) {
      const p = await abrirJanelaBateria({ textoBotao: 'Salvar e adicionar à venda', modeloInicial: /^[a-z]{1,3}\d/i.test(venda.termo) ? venda.termo.toUpperCase() : '' });
      if (p) adicionarProduto(p);
    } else if (d.remover !== undefined) {
      venda.itens.splice(Number(d.remover), 1);
      distribuirPagamentos();
      desenharItens(); atualizarTotais();
    } else if (d.mais !== undefined || d.menos !== undefined) {
      const it = venda.itens[Number(d.mais ?? d.menos)];
      it.quantidade = Math.max(1, it.quantidade + (d.mais !== undefined ? 1 : -1));
      raiz.querySelectorAll(`[data-qtd="${d.mais ?? d.menos}"]`).forEach((i) => { i.value = it.quantidade; });
      distribuirPagamentos(); atualizarTotais();
    } else if (d.sucata !== undefined) {
      venda.sucata = d.sucata === '1';
      for (const it of venda.itens) it.preco = valorCampo(precoCatalogo(it.produto, venda.sucata));
      distribuirPagamentos(); desenharItens(); atualizarTotais();
    } else if (d.descTipo) {
      venda.descTipo = d.descTipo;
      raiz.querySelectorAll('[data-desc-tipo]').forEach((b) => b.setAttribute('aria-pressed', b === a));
      distribuirPagamentos(); atualizarTotais();
    } else if (d.forma) {
      const i = venda.pagamentos.findIndex((p) => p.forma.id === d.forma);
      if (i >= 0) venda.pagamentos.splice(i, 1);
      else venda.pagamentos.push({ forma: formasCache.find((f) => f.id === d.forma), valor: '', parcelas: 1, manual: false });
      a.setAttribute('aria-pressed', i < 0);
      // Ao dividir, as formas já escolhidas ficam com o valor digitado e a nova recebe o que falta.
      if (i < 0) venda.pagamentos.forEach((p, k) => { p.manual = k < venda.pagamentos.length - 1; });
      else if (venda.pagamentos.length && venda.pagamentos.every((p) => p.manual)) venda.pagamentos.at(-1).manual = false;
      distribuirPagamentos(); desenharPagamentos(); atualizarTotais();
      raiz.querySelector('[data-valor-pag="0"]')?.focus();
    } else if (d.atend) {
      venda.atendimento = d.atend;
      raiz.querySelectorAll('[data-atend]').forEach((b) => b.setAttribute('aria-pressed', b === a));
      $('#campo-local', raiz).hidden = venda.atendimento === 'balcao';
      if (venda.atendimento !== 'balcao') $('#local', raiz).focus();
    } else if (d.novoCliente !== undefined) {
      const nome = $('#busca-cliente', raiz)?.value.trim() ?? '';
      const c = await abrirJanelaCliente({ textoBotao: 'Salvar e usar nesta venda', nomeInicial: /\d/.test(nome) ? '' : nome });
      if (c) { venda.cliente = c; desenharCliente(); }
    } else if (d.cliente) {
      venda.cliente = JSON.parse(d.cliente);
      desenharCliente();
    } else if (d.tirarCliente !== undefined) {
      venda.cliente = null;
      desenharCliente();
      $('#busca-cliente', raiz)?.focus();
    } else if (a.id === 'btn-data') {
      const campo = $('#campo-data', raiz);
      campo.hidden = !campo.hidden;
      const inp = $('#data-venda', raiz);
      inp.max = new Date().toLocaleString('sv-SE', { timeZone: FUSO }).slice(0, 16).replace(' ', 'T');
      if (!campo.hidden) inp.focus();
    } else if (a.id === 'btn-lucro') {
      venda.verLucro = !venda.verLucro;
      desenharExtras();
    } else if (d.limpar !== undefined) {
      if (venda.itens.length && !(await confirmar({ titulo: 'Limpar venda', texto: 'Apagar os itens e o pagamento desta venda?', sim: 'Limpar', perigo: true }))) return;
      venda = novaVenda();
      ctx.irPara('vender');
    } else if (d.continuar !== undefined) {
      if (!venda.itens.length) return aviso('Adicione pelo menos uma bateria.', 'erro');
      location.hash = 'vender/pagamento';
    } else if (d.confirmar !== undefined) {
      confirmarVenda(a);
    }
  });

  raiz.addEventListener('input', (e) => {
    const t = e.target;
    const d = t.dataset;
    if (d.preco !== undefined) {
      venda.itens[Number(d.preco)].preco = t.value;
      raiz.querySelectorAll(`[data-preco="${d.preco}"]`).forEach((i) => { if (i !== t) i.value = t.value; });
    } else if (d.qtd !== undefined) {
      venda.itens[Number(d.qtd)].quantidade = Math.max(1, parseInt(t.value, 10) || 1);
    } else if (d.valorPag !== undefined) {
      const p = venda.pagamentos[Number(d.valorPag)];
      p.valor = t.value;
      p.manual = true;
      // se todas viraram manuais, a última volta a ser automática
      if (venda.pagamentos.every((x) => x.manual)) venda.pagamentos.find((x) => x !== p).manual = false;
    } else if (t.id === 'desc-valor') {
      venda.descValor = t.value;
    } else if (t.id === 'local') {
      venda.local = t.value;
      return;
    } else if (t.id === 'data-venda') {
      venda.dataHora = t.value;
    } else return;
    distribuirPagamentos();
    atualizarTotais();
  });

  raiz.addEventListener('change', (e) => {
    const d = e.target.dataset;
    if (d.parcelas !== undefined) venda.pagamentos[Number(d.parcelas)].parcelas = Number(e.target.value);
  });

  busca.addEventListener('input', debounce(buscar));

  desenharItens();
  desenharPagamentos();
  desenharCliente();
  atualizarTotais();
  if (venda.termo) buscar();
  if (!noPasso2 && !venda.itens.length) busca.focus();
}
