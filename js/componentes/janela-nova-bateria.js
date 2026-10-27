// Janela "Nova bateria" (e edição de produto). Usada na venda, no Estoque e em Produtos.
// Nunca envia estoque_atual nem custo_medio: o banco mantém esses campos.
// Resolve com o produto salvo (linha de vw_produtos_estoque) ou null.
import { supabase, ok, mensagemDeErro } from '../supabase.js';
import { abrirJanela } from './janela.js';
import { icone } from '../icones.js';
import { $, esc, numero, valorCampo, ocupado, CATEGORIAS, categoria } from '../util.js';

const MARCAS = ['Moura', 'Heliar', 'Zetta'];

export function abrirJanelaBateria({ produto = null, textoBotao = 'Salvar bateria', modeloInicial = '' } = {}) {
  const p = produto ?? {};
  const marcaAtual = p.marca ?? 'Moura';
  const marcaOutra = !MARCAS.includes(marcaAtual);
  const catAtual = p.linha ? categoria(p.linha) : 'Automotiva';

  return abrirJanela({
    titulo: produto ? `Editar ${p.modelo}` : 'Nova bateria',
    subtitulo: produto ? 'Preço e cadastro' : 'Cadastro rápido para vender agora',
    html: `
      <form class="form" novalidate>
        <fieldset class="campo">
          <legend>Marca</legend>
          <div class="segmentos segmentos-4" role="radiogroup">
            ${[...MARCAS, 'Outra'].map((m) => {
              const ativo = m === 'Outra' ? marcaOutra : m === marcaAtual;
              return `<button type="button" class="seg" data-marca="${m}" aria-pressed="${ativo}">${m}</button>`;
            }).join('')}
          </div>
          <input name="marcaOutra" class="campo-extra" placeholder="Nome da marca" autocomplete="off" value="${marcaOutra ? esc(marcaAtual) : ''}" ${marcaOutra ? '' : 'hidden'}>
        </fieldset>
        <div class="grade-2">
          <div class="campo">
            <label for="pb-modelo">Modelo *</label>
            <input id="pb-modelo" name="modelo" autocomplete="off" autocapitalize="characters" required ${produto ? '' : 'autofocus'} value="${esc(p.modelo ?? modeloInicial)}">
          </div>
          <div class="campo">
            <label for="pb-linha">Linha *</label>
            <select id="pb-linha" name="linha">
              ${CATEGORIAS.map((c) => `<option ${c === catAtual ? 'selected' : ''}>${c}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="campo">
          <label for="pb-apl">Carros que atende</label>
          <input id="pb-apl" name="aplicacoes" autocomplete="off" placeholder="Onix, HB20, Argo" value="${esc(p.aplicacoes ?? '')}">
          <small class="texto-aux">É o que faz a bateria aparecer quando você busca pelo carro.</small>
        </div>
        <div class="grade-2">
          <div class="campo">
            <label for="pb-preco">Preço de venda *</label>
            <input id="pb-preco" name="preco_venda" inputmode="decimal" autocomplete="off" placeholder="0,00" value="${valorCampo(p.preco_venda)}" ${produto ? 'autofocus' : ''}>
          </div>
          <div class="campo">
            <label for="pb-sem">Sem a usada</label>
            <input id="pb-sem" name="preco_venda_sem_sucata" inputmode="decimal" autocomplete="off" placeholder="0,00" value="${valorCampo(p.preco_venda_sem_sucata)}">
          </div>
        </div>
        <div class="grade-2">
          <div class="campo">
            <label for="pb-min">Estoque mínimo</label>
            <input id="pb-min" name="estoque_minimo" inputmode="numeric" autocomplete="off" value="${p.estoque_minimo ?? 1}">
          </div>
          <div class="campo">
            <label for="pb-gar">Garantia (meses)</label>
            <input id="pb-gar" name="garantia_meses" inputmode="numeric" autocomplete="off" placeholder="Padrão da loja" value="${p.garantia_meses ?? ''}">
          </div>
        </div>
        <div class="grade-2">
          <div class="campo">
            <label for="pb-ah">Amperagem (Ah)</label>
            <input id="pb-ah" name="amperagem_ah" inputmode="numeric" autocomplete="off" value="${p.amperagem_ah ?? ''}">
          </div>
          ${produto ? `
          <label class="campo-check"><input type="checkbox" name="ativo" ${p.ativo === false ? '' : 'checked'}> Ativa (aparece na venda)</label>` : ''}
        </div>
        <p class="nota">${icone('alerta', 20)}<span>O estoque e o custo entram pela tela Entrada. Se vender antes disso, o estoque fica negativo até lançar a compra.</span></p>
        <p class="msg-erro" role="alert" hidden></p>
        <button class="btn btn-primario btn-grande" type="submit">${esc(textoBotao)}</button>
      </form>`,
    montar(corpo, fechar) {
      const form = $('form', corpo);
      const erro = $('.msg-erro', corpo);
      const mostrarErro = (t) => { erro.textContent = t; erro.hidden = !t; };
      let marca = marcaAtual;

      corpo.querySelectorAll('[data-marca]').forEach((b) => b.addEventListener('click', () => {
        corpo.querySelectorAll('[data-marca]').forEach((x) => x.setAttribute('aria-pressed', x === b));
        const outra = b.dataset.marca === 'Outra';
        form.marcaOutra.hidden = !outra;
        if (outra) form.marcaOutra.focus();
        marca = outra ? form.marcaOutra.value.trim() : b.dataset.marca;
      }));
      form.marcaOutra.addEventListener('input', () => { marca = form.marcaOutra.value.trim(); });
      form.modelo.addEventListener('input', () => { form.modelo.value = form.modelo.value.toUpperCase(); });

      // A view traz a garantia já com o padrão da loja; no formulário vale só a do produto.
      if (produto) {
        form.garantia_meses.value = '';
        supabase.from('produtos').select('garantia_meses').eq('id', produto.id).single()
          .then(({ data }) => { form.garantia_meses.value = data?.garantia_meses ?? ''; });
      }

      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const inteiro = (v) => (String(v).trim() === '' ? null : parseInt(v, 10));
        const preco = form.preco_venda.value.trim() ? numero(form.preco_venda.value) : null;
        const precoSem = form.preco_venda_sem_sucata.value.trim() ? numero(form.preco_venda_sem_sucata.value) : null;
        const cat = form.linha.value;
        // Mantém o nome da linha já cadastrado quando a categoria não mudou (ex.: "Moura Log Diesel").
        const linha = produto && categoria(p.linha) === cat && p.marca === marca ? p.linha : `${marca} ${cat}`;
        const dados = {
          marca,
          modelo: form.modelo.value.trim().toUpperCase(),
          linha,
          aplicacoes: form.aplicacoes.value.trim() || null,
          preco_venda: preco,
          preco_venda_sem_sucata: precoSem,
          estoque_minimo: inteiro(form.estoque_minimo.value) ?? 1,
          garantia_meses: inteiro(form.garantia_meses.value),
          amperagem_ah: inteiro(form.amperagem_ah.value),
        };
        if (form.ativo) dados.ativo = form.ativo.checked;

        if (!marca) return mostrarErro('Informe a marca.');
        if (!dados.modelo) return mostrarErro('Informe o modelo.');
        if (!preco || preco <= 0) return mostrarErro('Informe o preço de venda.');
        if (dados.garantia_meses !== null && (dados.garantia_meses < 0 || dados.garantia_meses > 120)) {
          return mostrarErro('Garantia entre 0 e 120 meses.');
        }
        mostrarErro('');

        await ocupado($('button[type=submit]', form), async () => {
          try {
            const r = produto
              ? await supabase.from('produtos').update(dados).eq('id', produto.id).select('id').single()
              : await supabase.from('produtos').insert(dados).select('id').single();
            const { id } = ok(r);
            fechar(ok(await supabase.from('vw_produtos_estoque').select('*').eq('id', id).single()));
          } catch (err) {
            const msg = mensagemDeErro(err);
            mostrarErro(/duplicate|unique/i.test(msg) ? `Já existe a bateria ${marca} ${dados.modelo}.` : msg);
          }
        });
      });
    },
  });
}
