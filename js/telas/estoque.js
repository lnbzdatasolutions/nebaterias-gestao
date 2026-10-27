// Estoque (#estoque ou #estoque/<busca>): consulta rápida por modelo ou carro,
// filtros por linha, detalhe do produto, últimas movimentações e ajuste manual.
import { supabase, ok, mensagemDeErro } from '../supabase.js';
import { icone } from '../icones.js';
import { abrirJanela } from '../componentes/janela.js';
import { abrirJanelaBateria } from '../componentes/janela-nova-bateria.js';
import {
  $, esc, dinheiro, percentual, saldo, corSaldo, categoria, CATEGORIAS, linhaCurta, aplicacoesCurtas,
  debounce, aviso, ocupado, ehNotebook, baixarCSV, hojeISO, FUSO,
} from '../util.js';

const MOTIVOS = ['Contagem', 'Garantia / troca', 'Avaria', 'Outro'];
const diaMes = (d) => new Date(d).toLocaleDateString('pt-BR', { timeZone: FUSO, day: '2-digit', month: '2-digit' });

export async function render(raiz, { params }) {
  let produtos = [];
  let filtro = '';
  let termo = params[0] ? decodeURIComponent(params[0]) : '';
  let selecionado = null;

  raiz.innerHTML = `
    <header class="cabecalho">
      <div class="cabecalho-titulo">
        <h1 class="titulo">Estoque</h1>
        <p class="texto-aux so-notebook" id="resumo-nb">&nbsp;</p>
      </div>
      <p class="texto-aux so-celular" id="resumo-cel"></p>
      <div class="acoes-topo so-notebook">
        <button id="exportar" class="btn btn-secundario" type="button">Exportar CSV</button>
        <button id="nova" class="btn btn-escuro" type="button">${icone('mais', 20, 2.4)}Nova bateria</button>
      </div>
    </header>
    <div class="barra-filtros">
      <label class="busca busca-grande">${icone('busca', 22)}
        <input type="search" id="busca" placeholder="Modelo ou carro (ex.: Hilux, M60)" aria-label="Buscar bateria por modelo ou carro" autocomplete="off" value="${esc(termo)}">
      </label>
      <div class="chips-filtro rolagem-x" id="filtros">
        ${['', ...CATEGORIAS].map((c) => `<button type="button" class="chip" data-filtro="${c}" aria-pressed="${c === ''}">${c || 'Todas'}</button>`).join('')}
      </div>
    </div>
    <div class="grade-detalhe">
      <div id="lista" class="cartao lista-cartao"><p class="texto-aux pad">Carregando…</p></div>
      <aside id="detalhe" class="cartao so-notebook painel-detalhe" hidden></aside>
    </div>`;

  const lista = $('#lista', raiz);
  const painel = $('#detalhe', raiz);
  const busca = $('#busca', raiz);

  const visiveis = () => produtos.filter((p) => !filtro || categoria(p.linha) === filtro);

  function desenharResumo() {
    // o resumo considera o catálogo inteiro, não a busca
    supabase.rpc('buscar_produtos', { p_limite: 1000 }).then(({ data: todos }) => {
      if (!todos) return;
      const unidades = todos.reduce((s, p) => s + Math.max(p.estoque_atual, 0), 0);
      const valor = todos.reduce((s, p) => s + Number(p.valor_estoque_custo || 0), 0);
      const minimo = todos.filter((p) => p.abaixo_minimo).length;
      $('#resumo-cel', raiz).textContent = `${todos.length} modelos · ${minimo} no mínimo`;
      $('#resumo-nb', raiz).textContent =
        `${todos.length} modelos · ${unidades} baterias · ${dinheiro(valor)} a preço de custo · ${minimo} no mínimo`;
    });
  }

  function desenhar() {
    const itens = visiveis();
    if (!itens.length) {
      lista.innerHTML = `<p class="texto-aux pad">Nenhuma bateria encontrada${termo ? ` para "${esc(termo)}"` : ''}.</p>`;
      return;
    }
    lista.innerHTML = `
      <ul class="linhas so-celular">
        ${itens.map((p) => `
          <li>
            <button type="button" class="linha-botao" data-ver="${p.id}">
              <span class="min0">
                <span class="d-bloco"><span class="modelo">${esc(p.modelo)}</span> <span class="texto-aux">${esc(linhaCurta(p.linha))}</span></span>
                <span class="texto-medio d-bloco">${esc(aplicacoesCurtas(p.aplicacoes))}</span>
              </span>
              <span class="direita">
                <span class="selo-saldo ${corSaldo(p.estoque_atual, p.estoque_minimo)}">${saldo(p.estoque_atual)}</span>
                <span class="d-bloco texto-medio">${p.preco_venda ? dinheiro(p.preco_venda) : 'sem preço'}</span>
              </span>
            </button>
          </li>`).join('')}
      </ul>
      <div class="tabela-rolagem so-notebook">
        <table class="tabela">
          <thead><tr><th>Modelo</th><th>Atende</th><th class="centro">Saldo</th><th class="num">Custo médio</th><th class="num">Preço</th><th class="num">Margem</th><th></th></tr></thead>
          <tbody>
            ${itens.map((p) => `
              <tr data-ver="${p.id}" class="${p.id === selecionado ? 'selecionada' : ''}">
                <td><span class="modelo-p">${esc(p.modelo)}</span><div class="texto-p texto-aux">${esc(p.linha)}</div></td>
                <td class="texto-medio quebra">${esc(aplicacoesCurtas(p.aplicacoes))}</td>
                <td class="centro"><span class="selo-saldo ${corSaldo(p.estoque_atual, p.estoque_minimo)}">${saldo(p.estoque_atual)}</span></td>
                <td class="num">${Number(p.custo_medio) > 0 ? dinheiro(p.custo_medio) : '-'}</td>
                <td class="num"><strong>${p.preco_venda ? dinheiro(p.preco_venda) : '-'}</strong></td>
                <td class="num">${percentual(p.margem_pct)}</td>
                <td class="num"><button type="button" class="btn btn-secundario btn-p">Detalhe</button></td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
  }

  async function carregar() {
    try {
      produtos = ok(await supabase.rpc('buscar_produtos', { p_termo: termo || null, p_limite: 200 }));
      desenhar();
    } catch (e) {
      lista.innerHTML = `<p class="msg-erro">${esc(mensagemDeErro(e))}</p>`;
    }
  }

  async function htmlDetalhe(p) {
    const movs = ok(await supabase.from('vw_movimentos_detalhe')
      .select('data_hora, tipo, quantidade, custo_unitario, descricao, origem_tipo')
      .eq('produto_id', p.id).order('data_hora', { ascending: false }).limit(20));
    return `
      <div class="detalhe-produto">
        <div>
          <h2 class="titulo-m modelo">${esc(p.modelo)}</h2>
          <p class="texto-aux">${esc(p.linha)} · garantia ${p.garantia_meses} meses</p>
          ${p.aplicacoes ? `<p class="texto-medio texto-p">${esc(p.aplicacoes)}</p>` : ''}
        </div>
        <div class="grade-2 mini-cartoes">
          <div class="mini"><span class="texto-aux">Em estoque</span><strong class="${corSaldo(p.estoque_atual, p.estoque_minimo)}-txt">${saldo(p.estoque_atual)}</strong></div>
          <div class="mini"><span class="texto-aux">Mínimo</span><strong>${p.estoque_minimo}</strong></div>
          <div class="mini"><span class="texto-aux">Custo médio</span><strong>${Number(p.custo_medio) > 0 ? dinheiro(p.custo_medio) : '-'}</strong></div>
          <div class="mini"><span class="texto-aux">Preço · margem</span><strong>${p.preco_venda ? dinheiro(p.preco_venda) : '-'} · ${percentual(p.margem_pct)}</strong></div>
        </div>
        ${p.markup_pct !== null ? `<p class="texto-aux">Markup ${percentual(p.markup_pct)} (quanto se acrescenta sobre o custo). Margem: quanto do preço vira lucro.</p>` : ''}
        <h3 class="sub">Últimas movimentações</h3>
        ${movs.length ? `<ul class="lista-simples">
          ${movs.map((m) => `
            <li><span class="texto-medio">${diaMes(m.data_hora)} · ${esc(m.descricao)}${m.origem_tipo === 'compra' && Number(m.custo_unitario) > 0 ? ` · ${dinheiro(m.custo_unitario)}` : ''}</span>
              <strong class="${m.quantidade < 0 ? 'vermelho' : 'verde'}">${m.quantidade > 0 ? '+' : ''}${saldo(m.quantidade)}</strong></li>`).join('')}
        </ul>` : '<p class="texto-aux">Nenhuma movimentação ainda. O estoque entra pela tela Entrada.</p>'}
        <form class="ajuste" novalidate>
          <strong>Ajustar estoque</strong>
          <div class="ajuste-campos">
            <input name="qtd" inputmode="numeric" placeholder="+1 ou -1" aria-label="Quantidade do ajuste (+ ou -)" autocomplete="off">
            <select name="motivo" aria-label="Motivo">${MOTIVOS.map((m) => `<option>${m}</option>`).join('')}</select>
          </div>
          <input name="outro" placeholder="Descreva o motivo" aria-label="Motivo do ajuste" autocomplete="off" hidden>
          <p class="msg-erro" hidden></p>
          <button class="btn btn-escuro" type="submit">Salvar ajuste</button>
        </form>
        <button type="button" class="btn btn-secundario" data-editar="${p.id}">Editar preço e cadastro</button>
        <a class="btn btn-primario" href="#entrada">${icone('entrada', 20)}Nova entrada</a>
      </div>`;
  }

  function montarDetalhe(el, p, aoMudar) {
    const form = $('form.ajuste', el);
    const erro = $('.msg-erro', form);
    form.motivo.addEventListener('change', () => {
      form.outro.hidden = form.motivo.value !== 'Outro';
      if (!form.outro.hidden) form.outro.focus();
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const qtd = parseInt(form.qtd.value.replace(/[^\d-]/g, ''), 10);
      const motivo = form.motivo.value === 'Outro' ? form.outro.value.trim() : form.motivo.value;
      const falha = !qtd ? 'Informe a quantidade, ex.: +1 ou -1.' : motivo.length < 3 ? 'Descreva o motivo.' : '';
      erro.textContent = falha;
      erro.hidden = !falha;
      if (falha) return;
      ocupado($('button[type=submit]', form), async () => {
        try {
          const r = ok(await supabase.rpc('ajustar_estoque', { p_produto_id: p.id, p_quantidade: qtd, p_motivo: motivo }));
          aviso(`${p.modelo}: estoque ${saldo(r.estoque_anterior)} → ${saldo(r.estoque_atual)}.`, 'ok');
          aoMudar();
        } catch (err) {
          erro.textContent = mensagemDeErro(err);
          erro.hidden = false;
        }
      });
    });
  }

  async function ver(id) {
    selecionado = id;
    const p = ok(await supabase.from('vw_produtos_estoque').select('*').eq('id', id).single());
    const atualizar = async () => { await carregar(); desenharResumo(); ver(id); };
    if (ehNotebook()) {
      raiz.querySelectorAll('tr[data-ver]').forEach((tr) => tr.classList.toggle('selecionada', tr.dataset.ver === id));
      painel.hidden = false;
      painel.innerHTML = await htmlDetalhe(p);
      montarDetalhe(painel, p, atualizar);
    } else {
      let mudou = false;
      const html = await htmlDetalhe(p);
      const acao = await abrirJanela({
        titulo: p.modelo,
        html,
        montar(corpo, fechar) {
          $('.detalhe-produto > div:first-child', corpo).remove(); // o título já está no topo
          montarDetalhe(corpo, p, () => { mudou = true; fechar('ajustou'); });
          corpo.querySelector('[data-editar]').addEventListener('click', (e) => { e.stopPropagation(); fechar('editar'); });
          corpo.querySelector('a[href="#entrada"]').addEventListener('click', () => fechar());
        },
      });
      if (acao === 'editar') editar(p);
      else if (mudou) { await carregar(); desenharResumo(); }
    }
  }

  async function editar(p) {
    const salvo = await abrirJanelaBateria({ produto: p, textoBotao: 'Salvar alterações' });
    if (salvo) {
      aviso(`${salvo.modelo} salva.`, 'ok');
      await carregar();
      if (ehNotebook()) ver(salvo.id);
    }
  }

  raiz.addEventListener('click', async (e) => {
    const alvo = e.target.closest('[data-ver], [data-filtro], [data-editar], #nova, #exportar');
    if (!alvo) return;
    try {
      if (alvo.id === 'nova') {
        const nova = await abrirJanelaBateria({ textoBotao: 'Salvar bateria', modeloInicial: termo.toUpperCase() });
        if (nova) { aviso(`${nova.modelo} cadastrada.`, 'ok'); await carregar(); desenharResumo(); }
      } else if (alvo.id === 'exportar') {
        const todos = ok(await supabase.rpc('buscar_produtos', { p_somente_ativos: false, p_limite: 1000 }));
        baixarCSV(`estoque-${hojeISO()}.csv`, [
          ['Marca', 'Modelo', 'Linha', 'Aplicações', 'Saldo', 'Mínimo', 'Custo médio', 'Preço de venda', 'Preço sem usada', 'Margem %', 'Valor em estoque (custo)', 'Ativo'],
          ...todos.map((p) => [p.marca, p.modelo, p.linha, p.aplicacoes, p.estoque_atual, p.estoque_minimo,
            Number(p.custo_medio), p.preco_venda === null ? '' : Number(p.preco_venda),
            p.preco_venda_sem_sucata === null ? '' : Number(p.preco_venda_sem_sucata),
            p.margem_pct === null ? '' : Number(p.margem_pct), Number(p.valor_estoque_custo), p.ativo ? 'sim' : 'não']),
        ]);
      } else if (alvo.dataset.filtro !== undefined) {
        filtro = alvo.dataset.filtro;
        raiz.querySelectorAll('[data-filtro]').forEach((b) => b.setAttribute('aria-pressed', b === alvo));
        desenhar();
      } else if (alvo.dataset.editar) {
        editar(ok(await supabase.from('vw_produtos_estoque').select('*').eq('id', alvo.dataset.editar).single()));
      } else ver(alvo.dataset.ver);
    } catch (err) {
      aviso(mensagemDeErro(err), 'erro');
    }
  });

  busca.addEventListener('input', debounce(() => {
    termo = busca.value.trim();
    history.replaceState(null, '', termo ? `#estoque/${encodeURIComponent(termo)}` : '#estoque');
    carregar();
  }));

  busca.focus();
  desenharResumo();
  await carregar();
}
