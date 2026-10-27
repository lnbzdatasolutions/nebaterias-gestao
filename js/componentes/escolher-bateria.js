// Janela de busca para escolher uma bateria (usada na Entrada).
// Resolve com a linha de vw_produtos_estoque escolhida, ou null.
import { supabase, ok, mensagemDeErro } from '../supabase.js';
import { abrirJanela } from './janela.js';
import { abrirJanelaBateria } from './janela-nova-bateria.js';
import { icone } from '../icones.js';
import { $, esc, dinheiro, saldo, corSaldo, linhaCurta, aplicacoesCurtas, debounce } from '../util.js';

export async function escolherBateria({ titulo = 'Adicionar bateria', permitirNova = true, somenteAtivos = true } = {}) {
  const escolha = await abrirJanela({
    titulo,
    html: `
      <label class="busca busca-grande">${icone('busca', 22)}
        <input type="search" placeholder="Modelo ou carro" aria-label="Buscar bateria" autocomplete="off" autofocus>
      </label>
      <ul class="linhas resultados-janela"></ul>
      ${permitirNova ? '<button type="button" class="link-btn link-forte" data-nova>Não achou? Cadastrar bateria nova</button>' : ''}`,
    montar(corpo, fechar) {
      const input = $('input', corpo);
      const ul = $('ul', corpo);
      let resultados = [];
      async function buscar() {
        try {
          resultados = ok(await supabase.rpc('buscar_produtos', { p_termo: input.value.trim() || null, p_somente_ativos: somenteAtivos, p_limite: 30 }));
          ul.innerHTML = resultados.length ? resultados.map((p) => `
            <li><button type="button" class="linha-botao" data-id="${p.id}">
              <span class="min0">
                <span class="d-bloco"><span class="modelo">${esc(p.modelo)}</span> <span class="texto-aux">${esc(linhaCurta(p.linha))}</span></span>
                <span class="texto-aux d-bloco elipse">${esc(aplicacoesCurtas(p.aplicacoes))}</span>
              </span>
              <span class="direita"><span class="selo-saldo ${corSaldo(p.estoque_atual, p.estoque_minimo)}">${saldo(p.estoque_atual)}</span>
                <span class="d-bloco texto-aux">${Number(p.custo_medio) > 0 ? `custo ${dinheiro(p.custo_medio)}` : ''}</span></span>
            </button></li>`).join('') : '<li class="texto-aux pad">Nenhuma bateria encontrada.</li>';
        } catch (e) {
          ul.innerHTML = `<li class="msg-erro">${esc(mensagemDeErro(e))}</li>`;
        }
      }
      input.addEventListener('input', debounce(buscar));
      ul.addEventListener('click', (e) => {
        const b = e.target.closest('[data-id]');
        if (b) fechar(resultados.find((p) => p.id === b.dataset.id));
      });
      $('[data-nova]', corpo)?.addEventListener('click', () => fechar({ nova: true, modelo: input.value.trim().toUpperCase() }));
      buscar();
    },
  });
  if (escolha?.nova) return abrirJanelaBateria({ textoBotao: 'Salvar e adicionar', modeloInicial: escolha.modelo });
  return escolha;
}
