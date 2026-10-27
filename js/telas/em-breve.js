// Tela provisória para as rotas que ainda serão construídas.
import { icone } from '../icones.js';

const ETAPA = { vender: 2, estoque: 2, entrada: 2, clientes: 2, produtos: 2, painel: 3, vendas: 3 };

export function render(raiz, { nome, titulo }) {
  raiz.innerHTML = `
    <header class="cabecalho">
      <a href="#inicio" class="btn-icone so-celular" aria-label="Voltar ao início">${icone('voltar', 26, 2.2)}</a>
      <h1 class="titulo">${titulo}</h1>
    </header>
    <div class="cartao vazio">
      <p><strong>Esta tela está em construção.</strong></p>
      <p class="texto-aux">Chega na etapa ${ETAPA[nome] ?? 2} do projeto.</p>
    </div>`;
}
