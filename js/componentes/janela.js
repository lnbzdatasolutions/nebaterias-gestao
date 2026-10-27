// Janela sobreposta: no celular sobe de baixo como folha; no notebook abre
// centralizada (máx. 460 px). Abre por cima da tela sem perder o que já foi preenchido.
//
//   const resultado = await abrirJanela({
//     titulo: 'Novo cliente', subtitulo: 'Só o nome é obrigatório',
//     html: '<form>…</form>',
//     montar(corpo, fechar) { … fechar(valor) … },
//   });
//   // resultado = valor passado a fechar(), ou null se a pessoa fechou no X / fora / Esc
import { icone } from '../icones.js';
import { esc } from '../util.js';

export function abrirJanela({ titulo, subtitulo = '', html = '', largura = 460, montar }) {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'janela';
    dialog.style.setProperty('--largura-janela', `${largura}px`);
    dialog.innerHTML = `
      <div class="janela-caixa">
        <header class="janela-cabeca">
          <div>
            <h2 class="titulo">${esc(titulo)}</h2>
            ${subtitulo ? `<p class="texto-aux">${esc(subtitulo)}</p>` : ''}
          </div>
          <button type="button" class="btn-icone btn-borda janela-fechar" aria-label="Fechar">${icone('fechar', 22)}</button>
        </header>
        <div class="janela-corpo">${html}</div>
      </div>`;
    document.body.append(dialog);

    let valor = null;
    const fechar = (v = null) => {
      valor = v;
      dialog.close();
    };
    dialog.addEventListener('close', () => {
      dialog.remove();
      document.body.classList.toggle('com-janela', !!document.querySelector('dialog.janela[open]'));
      resolve(valor);
    });
    dialog.querySelector('.janela-fechar').addEventListener('click', () => fechar());
    // toque no fundo escuro fecha
    dialog.addEventListener('click', (e) => { if (e.target === dialog) fechar(); });

    document.body.classList.add('com-janela');
    dialog.showModal();
    montar?.(dialog.querySelector('.janela-corpo'), fechar);
    dialog.querySelector('[autofocus]')?.focus();
  });
}

/** Pergunta simples com dois botões. Resolve true/false. */
export function confirmar({ titulo, texto, sim = 'Confirmar', nao = 'Cancelar', perigo = false }) {
  return abrirJanela({
    titulo,
    html: `
      <p class="janela-texto">${esc(texto)}</p>
      <div class="botoes-lado">
        <button type="button" class="btn btn-secundario" data-r="0">${esc(nao)}</button>
        <button type="button" class="btn ${perigo ? 'btn-perigo-cheio' : 'btn-primario'}" data-r="1">${esc(sim)}</button>
      </div>`,
    montar(corpo, fechar) {
      corpo.querySelectorAll('[data-r]').forEach((b) => b.addEventListener('click', () => fechar(b.dataset.r === '1')));
    },
  }).then((r) => r === true);
}

/** Pede um texto (ex.: motivo do cancelamento). Resolve o texto ou null. */
export function pedirTexto({ titulo, rotulo, sim = 'Confirmar', minimo = 3, perigo = false }) {
  return abrirJanela({
    titulo,
    html: `
      <form class="form" novalidate>
        <div class="campo"><label for="jt">${esc(rotulo)}</label><input id="jt" autofocus autocomplete="off"></div>
        <p class="msg-erro" hidden></p>
        <button class="btn btn-grande ${perigo ? 'btn-perigo-cheio' : 'btn-primario'}" type="submit">${esc(sim)}</button>
      </form>`,
    montar(corpo, fechar) {
      const form = corpo.querySelector('form');
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const v = form.jt.value.trim();
        const erro = form.querySelector('.msg-erro');
        if (v.length < minimo) {
          erro.textContent = `Escreva pelo menos ${minimo} letras.`;
          erro.hidden = false;
          return;
        }
        fechar(v);
      });
    },
  });
}
