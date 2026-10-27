// Mais / Configurações (#mais): atalhos para cadastros, alterar senha, exportar e sair.
import { supabase, mensagemDeErro } from '../supabase.js';
import { icone } from '../icones.js';
import { $, esc, aviso } from '../util.js';

/** Formulário de nova senha, usado aqui e na tela de recuperação. */
export function formularioSenha(raiz, aoSalvar) {
  raiz.innerHTML = `
    <form class="form" novalidate>
      <div class="campo">
        <label for="nova-senha">Nova senha</label>
        <input id="nova-senha" type="password" autocomplete="new-password" minlength="8" required>
      </div>
      <div class="campo">
        <label for="confirma-senha">Repita a nova senha</label>
        <input id="confirma-senha" type="password" autocomplete="new-password" minlength="8" required>
      </div>
      <p class="msg-erro" role="alert" hidden></p>
      <button class="btn btn-escuro btn-grande" type="submit">Salvar nova senha</button>
    </form>`;
  const form = $('form', raiz);
  const erro = $('.msg-erro', raiz);
  const botao = $('button', form);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const senha = $('#nova-senha', form).value;
    const confirma = $('#confirma-senha', form).value;
    let msg = '';
    if (senha.length < 8) msg = 'A senha precisa ter pelo menos 8 caracteres.';
    else if (senha !== confirma) msg = 'As duas senhas não são iguais.';
    erro.textContent = msg;
    erro.hidden = !msg;
    if (msg) return;
    botao.disabled = true;
    const { error } = await supabase.auth.updateUser({ password: senha });
    botao.disabled = false;
    if (error) {
      erro.textContent = mensagemDeErro(error);
      erro.hidden = false;
      return;
    }
    form.reset();
    aoSalvar();
  });
}

export async function render(raiz, { usuario }) {
  raiz.innerHTML = `
    <header class="cabecalho">
      <a href="#inicio" class="btn-icone so-celular" aria-label="Voltar ao início">${icone('voltar', 26, 2.2)}</a>
      <h1 class="titulo">
        <span class="so-celular">Mais</span><span class="so-notebook">Configurações</span>
      </h1>
    </header>

    <div class="pilha largura-form">
      <div class="cartao lista-links">
        <a href="#clientes">${icone('clientes', 24)}<span>Clientes</span><small id="qtd-clientes"></small></a>
        <a href="#produtos">${icone('produtos', 24)}<span>Produtos e preços</span><small id="qtd-produtos"></small></a>
        <a href="#vendas" class="so-celular">${icone('vendas', 24)}<span>Histórico de vendas</span>${icone('seta', 20)}</a>
      </div>

      <details class="cartao recolhivel">
        <summary>${icone('cadeado', 24)}<span>Alterar senha</span><span class="sinal" aria-hidden="true">+</span></summary>
        <div id="area-senha" class="recolhivel-corpo"></div>
      </details>

      <div class="cartao">
        <div class="cartao-titulo">${icone('download', 24)}<span>Exportar dados (planilha)</span></div>
        <p class="texto-aux">Disponível na etapa 3: vendas, compras, estoque e clientes em CSV.</p>
      </div>

      <button id="sair" class="btn btn-perigo btn-grande" type="button">Sair deste aparelho</button>
      <p class="texto-aux centro">N E Baterias · ${esc(usuario?.email)}</p>
    </div>`;

  formularioSenha($('#area-senha', raiz), () => {
    aviso('Senha alterada.', 'ok');
    $('details', raiz).open = false;
  });

  $('#sair', raiz).addEventListener('click', async () => {
    if (!confirm('Sair deste aparelho? Será preciso entrar de novo com e-mail e senha.')) return;
    await supabase.auth.signOut();
  });

  try {
    const [clientes, produtos] = await Promise.all([
      supabase.from('clientes').select('id', { count: 'exact', head: true }),
      supabase.from('produtos').select('id', { count: 'exact', head: true }).eq('ativo', true),
    ]);
    if (clientes.error || produtos.error) throw clientes.error || produtos.error;
    $('#qtd-clientes', raiz).textContent = clientes.count ?? '';
    $('#qtd-produtos', raiz).textContent = produtos.count ?? '';
  } catch (erro) {
    console.warn(mensagemDeErro(erro));
  }
}
