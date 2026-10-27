// Mais / Configurações (#mais): atalhos, alterar senha, exportar dados (CSV) e sair.
import { supabase, mensagemDeErro } from '../supabase.js';
import { icone } from '../icones.js';
import { exportarVendas, exportarCompras, exportarEstoque, exportarClientes } from '../exportar.js';
import { $, esc, aviso, ocupado, hojeISO } from '../util.js';

/**
 * Formulário de nova senha, usado aqui e na tela de recuperação.
 * Com `pedirAtual`, confere a senha atual antes de trocar.
 */
export function formularioSenha(raiz, aoSalvar, { pedirAtual = false, email = '' } = {}) {
  raiz.innerHTML = `
    <form class="form" novalidate>
      ${pedirAtual ? `
      <div class="campo">
        <label for="senha-atual">Senha atual</label>
        <input id="senha-atual" type="password" autocomplete="current-password" required>
      </div>` : ''}
      <div class="campo">
        <label for="nova-senha">Nova senha <span class="opcional">(mínimo 8 caracteres)</span></label>
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
  const mostrarErro = (t) => { erro.textContent = t; erro.hidden = !t; };
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const atual = $('#senha-atual', form)?.value ?? '';
    const senha = $('#nova-senha', form).value;
    const confirma = $('#confirma-senha', form).value;
    const msg = pedirAtual && !atual ? 'Digite a senha atual.'
      : senha.length < 8 ? 'A senha precisa ter pelo menos 8 caracteres.'
      : senha !== confirma ? 'As duas senhas não são iguais.' : '';
    mostrarErro(msg);
    if (msg) return;
    await ocupado($('button', form), async () => {
      if (pedirAtual) {
        const { error } = await supabase.auth.signInWithPassword({ email, password: atual });
        if (error) return mostrarErro(/Invalid login/i.test(error.message) ? 'A senha atual não confere.' : mensagemDeErro(error));
      }
      const { error } = await supabase.auth.updateUser({ password: senha });
      if (error) return mostrarErro(/different from the old/i.test(error.message) ? 'A nova senha precisa ser diferente da atual.' : mensagemDeErro(error));
      form.reset();
      aoSalvar();
    });
  });
}

/** Opções de período para exportar: últimos 12 meses, ano atual e tudo. */
function opcoesPeriodo() {
  const hoje = hojeISO();
  const [a, m] = hoje.split('-').map(Number);
  const opcoes = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(Date.UTC(a, m - 1 - i, 1));
    const ini = d.toISOString().slice(0, 10);
    const fim = i === 0 ? hoje : new Date(Date.UTC(a, m - i, 0)).toISOString().slice(0, 10);
    const nome = d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    opcoes.push([`${ini}|${fim}`, nome.charAt(0).toUpperCase() + nome.slice(1)]);
  }
  opcoes.push([`${a}-01-01|${hoje}`, `Ano de ${a}`], ['|', 'Tudo']);
  return opcoes;
}

export async function render(raiz, { usuario }) {
  const email = usuario?.email ?? '';
  raiz.innerHTML = `
    <header class="cabecalho">
      <a href="#inicio" class="btn-icone so-celular" aria-label="Voltar ao início">${icone('voltar', 26, 2.2)}</a>
      <div class="cabecalho-titulo">
        <h1 class="titulo"><span class="so-celular">Mais</span><span class="so-notebook">Configurações</span></h1>
        <p class="texto-aux so-notebook">Conectado como ${esc(email)}</p>
      </div>
    </header>

    <div class="cartao lista-links so-celular">
      <a href="#clientes">${icone('clientes', 24)}<span>Clientes</span><small id="qtd-clientes"></small></a>
      <a href="#vendas">${icone('documento', 24)}<span>Vendas e notas fiscais</span><small id="sem-nota"></small></a>
      <a href="#produtos">${icone('produtos', 24)}<span>Produtos e preços</span><small id="qtd-produtos"></small></a>
    </div>

    <div class="grade-config">
      <details class="cartao recolhivel config-senha" id="bloco-senha">
        <summary>${icone('cadeado', 24)}<span>Alterar senha</span><span class="sinal" aria-hidden="true">+</span></summary>
        <h2 class="cartao-h so-notebook">Alterar senha</h2>
        <div id="area-senha" class="recolhivel-corpo"></div>
      </details>

      <section class="cartao">
        <div class="cartao-titulo">${icone('download', 24)}<span><span class="so-celular">Exportar dados (planilha)</span><span class="so-notebook">Exportar dados</span></span></div>
        <p class="texto-aux so-notebook">Baixa uma planilha (CSV) que abre no Excel ou no Google Planilhas. Bom para guardar uma cópia todo mês.</p>
        <div class="campo">
          <label for="exp-periodo">Período</label>
          <select id="exp-periodo">${opcoesPeriodo().map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select>
        </div>
        <div class="grade-2 botoes-exportar">
          <button type="button" class="btn btn-secundario" data-exportar="vendas">Vendas</button>
          <button type="button" class="btn btn-secundario" data-exportar="compras">Compras</button>
          <button type="button" class="btn btn-secundario" data-exportar="estoque">Estoque</button>
          <button type="button" class="btn btn-secundario" data-exportar="clientes">Clientes</button>
        </div>
        <p class="texto-aux texto-p">Estoque e Clientes saem como estão hoje; Vendas e Compras, do período escolhido.</p>
      </section>
    </div>

    <div class="cartao rodape-config">
      <span class="texto-aux so-notebook" id="dados-loja">N E Baterias</span>
      <button id="sair" class="btn btn-perigo" type="button">Sair deste aparelho</button>
    </div>
    <p class="texto-aux centro so-celular">N E Baterias · ${esc(email)}</p>`;

  const blocoSenha = $('#bloco-senha', raiz);
  if (window.matchMedia('(min-width: 900px)').matches) blocoSenha.open = true;
  formularioSenha($('#area-senha', raiz), () => {
    aviso('Senha alterada.', 'ok');
    if (!window.matchMedia('(min-width: 900px)').matches) blocoSenha.open = false;
  }, { pedirAtual: true, email });

  raiz.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-exportar], #sair');
    if (!b) return;
    if (b.id === 'sair') {
      if (!confirm('Sair deste aparelho? Será preciso entrar de novo com e-mail e senha.')) return;
      await supabase.auth.signOut();
      return;
    }
    const [ini, fim] = $('#exp-periodo', raiz).value.split('|');
    await ocupado(b, async () => {
      try {
        const tipo = b.dataset.exportar;
        const n = tipo === 'vendas' ? await exportarVendas(ini || null, fim || null)
          : tipo === 'compras' ? await exportarCompras(ini || null, fim || null)
          : tipo === 'estoque' ? await exportarEstoque() : await exportarClientes();
        aviso(n ? `Planilha de ${tipo} baixada (${n} ${n === 1 ? 'linha' : 'linhas'}).` : `Nenhum registro de ${tipo} no período.`, n ? 'ok' : 'erro');
      } catch (err) {
        aviso(mensagemDeErro(err), 'erro');
      }
    }, 'Gerando…');
  });

  try {
    const [clientes, produtos, notas, loja] = await Promise.all([
      supabase.from('clientes').select('id', { count: 'exact', head: true }),
      supabase.from('produtos').select('id', { count: 'exact', head: true }).eq('ativo', true),
      supabase.from('vw_resumo_notas').select('vendas_sem_nota').maybeSingle(),
      supabase.from('loja_config').select('nome_loja, endereco, telefone, instagram').maybeSingle(),
    ]);
    $('#qtd-clientes', raiz).textContent = clientes.count ?? '';
    $('#qtd-produtos', raiz).textContent = produtos.count ?? '';
    const sem = Number(notas.data?.vendas_sem_nota ?? 0);
    if (sem) $('#sem-nota', raiz).innerHTML = `<span class="selo selo-alerta">${sem} sem nota</span>`;
    const l = loja.data;
    if (l) {
      $('#dados-loja', raiz).textContent = [l.nome_loja, l.endereco?.split(',').slice(0, 2).join(','), l.telefone?.split('/')[0]?.trim(), l.instagram]
        .filter(Boolean).join(' · ');
    }
  } catch (erro) {
    console.warn(mensagemDeErro(erro));
  }
}
