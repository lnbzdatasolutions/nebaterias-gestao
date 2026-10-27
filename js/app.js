// Shell do app: sessão, navegação (rodapé no celular, barra lateral no notebook)
// e roteamento por hash (#inicio, #vender, #estoque...).
import { supabase } from './supabase.js';
import { icone } from './icones.js';
import { esc } from './util.js';

// Cada rota carrega sua tela sob demanda. `rodape: true` = aparece no rodapé do celular.
const ROTAS = {
  inicio:   { titulo: 'Início',        icone: 'inicio',   rodape: true,  tela: () => import('./telas/inicio.js') },
  vender:   { titulo: 'Vender',        icone: 'vender',   rodape: true,  tela: () => import('./telas/em-breve.js') },
  estoque:  { titulo: 'Estoque',       icone: 'estoque',  rodape: true,  tela: () => import('./telas/em-breve.js') },
  entrada:  { titulo: 'Entrada',       icone: 'entrada',  rodape: true,  tela: () => import('./telas/em-breve.js') },
  painel:   { titulo: 'Painel',        icone: 'painel',   rodape: true,  tela: () => import('./telas/em-breve.js') },
  vendas:   { titulo: 'Vendas',        icone: 'vendas',   tela: () => import('./telas/em-breve.js') },
  clientes: { titulo: 'Clientes',      icone: 'clientes', tela: () => import('./telas/em-breve.js') },
  produtos: { titulo: 'Produtos',      icone: 'produtos', tela: () => import('./telas/em-breve.js') },
  mais:     { titulo: 'Configurações', icone: 'config',   tela: () => import('./telas/mais.js') },
};
const ROTAS_PUBLICAS = {
  login:        () => import('./telas/login.js'),
  'nova-senha': () => import('./telas/nova-senha.js'),
};

const app = document.getElementById('app');
let sessao = null;
let recuperandoSenha = false;
let limparTela = null;

/** Rota atual: '#estoque/123' → { nome: 'estoque', params: ['123'] } */
function rotaAtual() {
  const [nome, ...params] = location.hash.replace(/^#\/?/, '').split('/');
  return { nome: nome || 'inicio', params };
}

export function irPara(rota) {
  if (location.hash === `#${rota}`) navegar();
  else location.hash = rota;
}

export function usuarioAtual() {
  return sessao?.user ?? null;
}

function montarShell() {
  if (document.getElementById('tela')) return;
  const email = esc(sessao?.user?.email);
  const itens = Object.entries(ROTAS).map(([nome, r]) => `
    <a href="#${nome}" data-rota="${nome}" class="nav-item${r.rodape ? '' : ' so-notebook'}">
      <span class="nav-icone">${icone(r.icone)}</span><span>${r.titulo}</span>
    </a>`).join('');
  app.innerHTML = `
    <nav class="nav" aria-label="Navegação principal">
      <div class="nav-marca so-notebook">
        <span class="logo logo-p">${icone('bateria', 22)}</span>
        <span>N E Baterias</span>
      </div>
      <div class="nav-itens">${itens}</div>
      <div class="nav-usuario so-notebook">Conectado como<strong>${email}</strong></div>
    </nav>
    <main id="tela" class="tela" tabindex="-1"></main>`;
}

function marcarNavegacao(nome) {
  for (const a of app.querySelectorAll('.nav-item')) {
    if (a.dataset.rota === nome) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
}

async function navegar() {
  const { nome, params } = rotaAtual();
  limparTela?.();
  limparTela = null;

  if (recuperandoSenha && nome !== 'nova-senha') return irPara('nova-senha');

  if (ROTAS_PUBLICAS[nome] || !sessao) {
    const destino = ROTAS_PUBLICAS[nome] ? nome : 'login';
    if (sessao && destino === 'login') return irPara('inicio');
    if (!sessao && destino === 'nova-senha' && !recuperandoSenha) return irPara('login');
    if (destino !== nome) history.replaceState(null, '', `#${destino}`);
    document.title = 'Entrar · N E Baterias';
    const mod = await ROTAS_PUBLICAS[destino]();
    app.innerHTML = '';
    limparTela = await mod.render(app, { irPara });
    return;
  }

  const rota = ROTAS[nome];
  if (!rota) return irPara('inicio');
  montarShell();
  marcarNavegacao(nome);
  document.title = `${rota.titulo} · N E Baterias`;
  const tela = document.getElementById('tela');
  tela.innerHTML = '<div class="carregando" aria-live="polite">Carregando…</div>';
  window.scrollTo(0, 0);
  try {
    const mod = await rota.tela();
    tela.innerHTML = '';
    limparTela = await mod.render(tela, { nome, params, titulo: rota.titulo, irPara, usuario: usuarioAtual() });
  } catch (erro) {
    console.error(erro);
    tela.innerHTML = `<div class="cartao erro-carga">Não foi possível abrir esta tela.<br><small>${esc(erro.message)}</small>
      <button class="btn btn-secundario" type="button" onclick="location.reload()">Tentar de novo</button></div>`;
  }
}

function avisoConexao() {
  const barra = document.getElementById('offline');
  barra.hidden = navigator.onLine;
  document.body.classList.toggle('sem-internet', !navigator.onLine);
}

async function iniciar() {
  supabase.auth.onAuthStateChange((evento, novaSessao) => {
    const tinhaSessao = !!sessao;
    sessao = novaSessao;
    if (evento === 'PASSWORD_RECOVERY') {
      recuperandoSenha = true;
      irPara('nova-senha');
    } else if (evento === 'SIGNED_OUT') {
      recuperandoSenha = false;
      app.innerHTML = '';
      irPara('login');
    } else if (evento === 'SIGNED_IN' && !tinhaSessao && !recuperandoSenha && rotaAtual().nome === 'login') {
      app.innerHTML = '';
      irPara('inicio');
    }
  });

  const { data } = await supabase.auth.getSession();
  sessao = data.session;
  window.addEventListener('hashchange', navegar);
  window.addEventListener('online', avisoConexao);
  window.addEventListener('offline', avisoConexao);
  avisoConexao();
  navegar();
}

export function terminouRecuperacao() {
  recuperandoSenha = false;
}

if ('serviceWorker' in navigator && location.hostname !== 'localhost') {
  navigator.serviceWorker.register('/sw.js').catch((e) => console.warn('Service worker:', e));
}

iniciar();
