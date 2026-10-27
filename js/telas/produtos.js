// Produtos (#produtos): cadastro e preço de venda. Estoque e custo não se editam aqui.
import { supabase, ok, mensagemDeErro } from '../supabase.js';
import { icone } from '../icones.js';
import { abrirJanelaBateria } from '../componentes/janela-nova-bateria.js';
import { $, esc, dinheiro, numero, valorCampo, linhaCurta, aplicacoesCurtas, debounce, aviso, ocupado } from '../util.js';

export async function render(raiz) {
  let produtos = [];
  let marca = '';
  let termo = '';
  const alterados = new Map(); // id → { preco_venda, preco_venda_sem_sucata }

  raiz.innerHTML = `
    <header class="cabecalho">
      <a href="#mais" class="btn-icone so-celular" aria-label="Voltar">${icone('voltar', 26, 2.2)}</a>
      <div class="cabecalho-titulo">
        <h1 class="titulo">Produtos</h1>
        <p class="texto-aux">Cadastro e preço de venda<span class="so-notebook"> · estoque e custo mudam pela Entrada e pelas vendas</span></p>
      </div>
      <div class="acoes-topo">
        <button id="salvar-precos" class="btn btn-secundario so-notebook" type="button" disabled>Salvar preços alterados</button>
        <button id="nova" class="btn btn-primario" type="button">${icone('mais', 20, 2.4)}<span class="so-celular">Nova</span><span class="so-notebook">Nova bateria</span></button>
      </div>
    </header>

    <div class="barra-filtros">
      <label class="busca so-notebook">${icone('busca', 20)}<input type="search" id="busca" placeholder="Modelo ou carro" aria-label="Buscar bateria"></label>
      <div class="chips-filtro" id="marcas"></div>
    </div>

    <div id="lista" class="cartao lista-cartao"><p class="texto-aux pad">Carregando…</p></div>
    <p class="texto-aux so-celular">Estoque e custo não se editam aqui: mudam pela Entrada, pela venda ou pelo ajuste no Estoque.</p>`;

  const lista = $('#lista', raiz);
  const botaoSalvar = $('#salvar-precos', raiz);

  function filtrados() {
    return produtos.filter((p) => !marca || p.marca === marca);
  }

  function desenharMarcas() {
    const marcas = [...new Set(produtos.map((p) => p.marca))].sort((a, b) => (a === 'Moura' ? -1 : b === 'Moura' ? 1 : a.localeCompare(b)));
    $('#marcas', raiz).innerHTML = ['', ...marcas].map((m) =>
      `<button type="button" class="chip" data-marca="${esc(m)}" aria-pressed="${m === marca}">${m ? esc(m) : 'Todas'}</button>`).join('');
  }

  function desenhar() {
    const itens = filtrados();
    if (!itens.length) {
      lista.innerHTML = '<p class="texto-aux pad">Nenhuma bateria encontrada.</p>';
      return;
    }
    const precoTxt = (p) => (p.preco_venda ? dinheiro(p.preco_venda) : '<span class="vermelho">sem preço</span>')
      + (p.preco_venda_sem_sucata ? ` · sem usada ${dinheiro(p.preco_venda_sem_sucata)}` : '');
    lista.innerHTML = `
      <ul class="linhas so-celular">
        ${itens.map((p) => `
          <li class="${p.ativo ? '' : 'inativo'}">
            <div class="min0">
              <div><span class="modelo">${esc(p.modelo)}</span> <span class="texto-aux">${esc(p.marca)} · ${esc(linhaCurta(p.linha))}${p.ativo ? '' : ' · inativa'}</span></div>
              <div class="texto-medio">${precoTxt(p)}</div>
            </div>
            <button type="button" class="btn btn-secundario btn-p" data-editar="${p.id}">Editar</button>
          </li>`).join('')}
      </ul>
      <div class="tabela-rolagem so-notebook">
        <table class="tabela tabela-form">
          <thead><tr><th>Modelo</th><th>Marca · linha</th><th>Carros que atende</th><th>Preço de venda</th><th>Sem a usada</th><th class="num">Mínimo</th><th class="num">Garantia</th><th class="centro">Ativo</th></tr></thead>
          <tbody>
            ${itens.map((p) => {
              const alt = alterados.get(p.id) ?? {};
              return `
              <tr class="${p.ativo ? '' : 'inativo'}">
                <td><button type="button" class="link-modelo" data-editar="${p.id}">${esc(p.modelo)}</button></td>
                <td class="texto-aux">${esc(p.marca)} · ${esc(linhaCurta(p.linha))}</td>
                <td class="texto-medio quebra">${esc(aplicacoesCurtas(p.aplicacoes))}</td>
                <td><input class="campo-tabela forte" inputmode="decimal" data-id="${p.id}" data-campo="preco_venda" value="${valorCampo(alt.preco_venda ?? p.preco_venda)}" placeholder="0,00" aria-label="Preço de venda ${esc(p.modelo)}"></td>
                <td><input class="campo-tabela" inputmode="decimal" data-id="${p.id}" data-campo="preco_venda_sem_sucata" value="${valorCampo(alt.preco_venda_sem_sucata ?? p.preco_venda_sem_sucata)}" placeholder="0,00" aria-label="Preço sem a usada ${esc(p.modelo)}"></td>
                <td class="num">${p.estoque_minimo}</td>
                <td class="num">${p.garantia_meses} m</td>
                <td class="centro"><input type="checkbox" class="check" data-ativo="${p.id}" ${p.ativo ? 'checked' : ''} aria-label="Ativa"></td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>`;
  }

  async function carregar() {
    try {
      produtos = ok(await supabase.rpc('buscar_produtos', { p_termo: termo || null, p_somente_ativos: false, p_limite: 500 }));
      produtos.sort((a, b) => Number(b.ativo) - Number(a.ativo) || a.marca.localeCompare(b.marca) || a.modelo.localeCompare(b.modelo));
      desenharMarcas();
      desenhar();
    } catch (e) {
      lista.innerHTML = `<p class="msg-erro">${esc(mensagemDeErro(e))}</p>`;
    }
  }

  async function editar(id) {
    const p = produtos.find((x) => x.id === id);
    const salvo = await abrirJanelaBateria({ produto: p, textoBotao: 'Salvar alterações' });
    if (salvo) {
      aviso(`${salvo.modelo} salva.`, 'ok');
      alterados.delete(id);
      carregar();
    }
  }

  raiz.addEventListener('click', async (e) => {
    const alvo = e.target.closest('[data-editar], [data-marca], #nova');
    if (!alvo) return;
    if (alvo.id === 'nova') {
      const nova = await abrirJanelaBateria({ textoBotao: 'Salvar bateria' });
      if (nova) { aviso(`${nova.modelo} cadastrada.`, 'ok'); carregar(); }
    } else if (alvo.dataset.editar) editar(alvo.dataset.editar);
    else { marca = alvo.dataset.marca; desenharMarcas(); desenhar(); }
  });

  raiz.addEventListener('input', (e) => {
    const campo = e.target.closest('[data-campo]');
    if (!campo) return;
    const atual = alterados.get(campo.dataset.id) ?? {};
    atual[campo.dataset.campo] = campo.value;
    alterados.set(campo.dataset.id, atual);
    botaoSalvar.disabled = false;
  });

  raiz.addEventListener('change', async (e) => {
    const check = e.target.closest('[data-ativo]');
    if (!check) return;
    try {
      ok(await supabase.from('produtos').update({ ativo: check.checked }).eq('id', check.dataset.ativo));
      const p = produtos.find((x) => x.id === check.dataset.ativo);
      p.ativo = check.checked;
      check.closest('tr').classList.toggle('inativo', !check.checked);
      aviso(`${p.modelo} ${check.checked ? 'ativada' : 'desativada'}.`, 'ok');
    } catch (err) {
      check.checked = !check.checked;
      aviso(mensagemDeErro(err), 'erro');
    }
  });

  botaoSalvar.addEventListener('click', () => ocupado(botaoSalvar, async () => {
    try {
      for (const [id, campos] of alterados) {
        const dados = {};
        for (const [k, v] of Object.entries(campos)) dados[k] = String(v).trim() ? numero(v) : null;
        if ('preco_venda' in dados && !(dados.preco_venda > 0)) {
          const p = produtos.find((x) => x.id === id);
          throw new Error(`Preço de venda inválido em ${p.modelo}.`);
        }
        ok(await supabase.from('produtos').update(dados).eq('id', id));
      }
      aviso(`${alterados.size} ${alterados.size === 1 ? 'preço salvo' : 'preços salvos'}.`, 'ok');
      alterados.clear();
      await carregar();
    } catch (err) {
      aviso(mensagemDeErro(err), 'erro');
      return;
    }
  }).then(() => { botaoSalvar.disabled = alterados.size === 0; }));

  $('#busca', raiz).addEventListener('input', debounce((e) => { termo = e.target.value.trim(); carregar(); }));

  await carregar();

  // Avisa ao sair da tela com preços não salvos.
  return () => {
    if (alterados.size) aviso('Preços alterados não foram salvos.', 'erro');
  };
}
