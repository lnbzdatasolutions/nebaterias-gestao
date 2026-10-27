// Tela de login (#login). Sem cadastro público: os usuários são criados no Supabase.
import { supabase, mensagemDeErro } from '../supabase.js';
import { icone } from '../icones.js';
import { $, aviso } from '../util.js';

export function render(raiz) {
  raiz.innerHTML = `
    <div class="login">
      <aside class="login-lado so-notebook">
        <div class="login-marca"><span class="logo logo-m">${icone('bateria', 28)}</span>N E Baterias</div>
        <div>
          <h1>Vendas, estoque e resultados da loja em um só lugar.</h1>
          <p>O mesmo acesso funciona no celular e no notebook.</p>
        </div>
        <small>Av. Alberto Magno, 754 · Fortaleza - CE · (85) 98710-5240</small>
      </aside>

      <section class="login-form-area">
        <div class="login-caixa">
          <div class="login-topo so-celular">
            <span class="logo logo-g">${icone('bateria', 42, 1.8)}</span>
            <h1>N E Baterias</h1>
            <p>Vendas, estoque e resultados da loja</p>
          </div>
          <h1 class="titulo so-notebook">Entrar</h1>

          <form id="form-login" class="form" novalidate>
            <div class="campo">
              <label for="email">E-mail</label>
              <input id="email" name="email" type="email" inputmode="email" autocomplete="username" required>
            </div>
            <div class="campo">
              <label for="senha">Senha</label>
              <input id="senha" name="senha" type="password" autocomplete="current-password" required>
            </div>
            <p id="erro-login" class="msg-erro" role="alert" hidden></p>
            <button class="btn btn-escuro btn-grande" type="submit">Entrar</button>
            <button id="esqueci" class="link-btn" type="button">Esqueci a senha</button>
          </form>

          <p class="login-rodape so-celular">Você continua conectado neste aparelho.</p>
        </div>
      </section>
    </div>`;

  const form = $('#form-login', raiz);
  const erro = $('#erro-login', raiz);
  const botao = form.querySelector('button[type=submit]');

  function mostrarErro(texto) {
    erro.textContent = texto;
    erro.hidden = !texto;
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = form.email.value.trim();
    const senha = form.senha.value;
    if (!email || !senha) return mostrarErro('Preencha e-mail e senha.');
    mostrarErro('');
    botao.disabled = true;
    botao.textContent = 'Entrando…';
    // Ao entrar, o app.js recebe o evento SIGNED_IN e abre o Início.
    const { error } = await supabase.auth.signInWithPassword({ email, password: senha });
    if (error) {
      mostrarErro(mensagemDeErro(error));
      botao.disabled = false;
      botao.textContent = 'Entrar';
    }
  });

  $('#esqueci', raiz).addEventListener('click', async () => {
    const email = form.email.value.trim();
    if (!email) {
      mostrarErro('Digite seu e-mail acima e toque de novo em "Esqueci a senha".');
      form.email.focus();
      return;
    }
    mostrarErro('');
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${location.origin}/`,
    });
    if (error) return mostrarErro(mensagemDeErro(error));
    aviso('Se o e-mail estiver cadastrado, você vai receber um link para criar uma nova senha.', 'ok');
  });

  form.email.focus();
}
