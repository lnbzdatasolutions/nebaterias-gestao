// Nova senha (#nova-senha): aberta pelo link de "Esqueci a senha" do e-mail.
import { terminouRecuperacao } from '../app.js';
import { $, aviso } from '../util.js';
import { formularioSenha } from './mais.js';

export function render(raiz, { irPara }) {
  raiz.innerHTML = `
    <div class="login">
      <section class="login-form-area">
        <div class="login-caixa">
          <h1 class="titulo">Criar nova senha</h1>
          <p class="texto-aux">Escolha uma senha com pelo menos 8 caracteres.</p>
          <div id="area-senha"></div>
        </div>
      </section>
    </div>`;

  formularioSenha($('#area-senha', raiz), () => {
    terminouRecuperacao();
    aviso('Senha alterada.', 'ok');
    irPara('inicio');
  });
}
