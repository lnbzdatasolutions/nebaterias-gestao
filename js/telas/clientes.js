// Clientes (#clientes): busca, cadastro, histórico de compras e garantias.
import { supabase, ok, mensagemDeErro } from '../supabase.js';
import { icone } from '../icones.js';
import { abrirJanela } from '../componentes/janela.js';
import { abrirJanelaCliente } from '../componentes/janela-novo-cliente.js';
import { $, esc, dinheiro, data, telefone, iniciais, hojeISO, debounce, aviso, ehNotebook, FUSO } from '../util.js';
import { exportarClientes } from '../exportar.js';

const linkWhats = (tel) => `https://wa.me/55${String(tel).replace(/\D/g, '')}`;
const mesAno = (d) => new Date(d).toLocaleDateString('pt-BR', { timeZone: FUSO, month: '2-digit', year: 'numeric' });
const diaMes = (d) => new Date(d).toLocaleDateString('pt-BR', { timeZone: FUSO, day: '2-digit', month: '2-digit' });

function garantiaTxt(ate) {
  if (!ate) return '';
  const venceu = ate < hojeISO();
  return venceu
    ? `<span class="texto-aux forte">Garantia vencida em ${mesAno(ate + 'T12:00')}</span>`
    : `<span class="verde forte">Garantia até ${data(ate + 'T12:00')}</span>`;
}

export async function render(raiz, { params }) {
  let clientes = [];
  let resumo = new Map(); // cliente_id → { compras, total, ultima, garantia }
  let selecionado = params[0] || null;

  raiz.innerHTML = `
    <header class="cabecalho">
      <a href="#mais" class="btn-icone so-celular" aria-label="Voltar">${icone('voltar', 26, 2.2)}</a>
      <div class="cabecalho-titulo">
        <h1 class="titulo">Clientes</h1>
        <p class="texto-aux so-notebook" id="contagem">&nbsp;</p>
      </div>
      <div class="acoes-topo">
        <button id="exportar" class="btn btn-secundario so-notebook" type="button">Exportar CSV</button>
        <button id="novo" class="btn btn-primario" type="button">${icone('mais', 20, 2.4)}<span class="so-celular">Novo</span><span class="so-notebook">Novo cliente</span></button>
      </div>
    </header>
    <label class="busca busca-grande largura-busca">${icone('busca', 22)}<input type="search" id="busca" placeholder="Nome, telefone, placa ou veículo" aria-label="Buscar cliente"></label>
    <div class="grade-detalhe">
      <div id="lista" class="cartao lista-cartao"><p class="texto-aux pad">Carregando…</p></div>
      <aside id="detalhe" class="cartao so-notebook painel-detalhe" hidden></aside>
    </div>`;

  const lista = $('#lista', raiz);
  const painel = $('#detalhe', raiz);

  async function carregar(termo = '') {
    try {
      clientes = ok(await supabase.rpc('buscar_clientes', { p_termo: termo, p_limite: 50 }));
      resumo = new Map();
      if (clientes.length) {
        const vendas = ok(await supabase.from('vw_venda_itens_detalhe')
          .select('cliente_id, venda_id, data_hora, total_item, garantia_ate')
          .in('cliente_id', clientes.map((c) => c.id)).eq('status', 'concluida'));
        for (const v of vendas) {
          const r = resumo.get(v.cliente_id) ?? { vendas: new Set(), total: 0, ultima: null, garantia: null };
          r.vendas.add(v.venda_id);
          r.total += Number(v.total_item);
          if (!r.ultima || v.data_hora > r.ultima) r.ultima = v.data_hora;
          if (v.garantia_ate && (!r.garantia || v.garantia_ate > r.garantia)) r.garantia = v.garantia_ate;
          resumo.set(v.cliente_id, r);
        }
      }
      desenhar();
    } catch (e) {
      lista.innerHTML = `<p class="msg-erro">${esc(mensagemDeErro(e))}</p>`;
    }
  }

  async function contar() {
    const { count } = await supabase.from('clientes').select('id', { count: 'exact', head: true });
    $('#contagem', raiz).textContent = `${count ?? 0} ${count === 1 ? 'cliente' : 'clientes'}`;
  }

  function desenhar() {
    if (!clientes.length) {
      lista.innerHTML = '<p class="texto-aux pad">Nenhum cliente encontrado.</p>';
      return;
    }
    const detalheLinha = (c) => [c.veiculo, c.placa, telefone(c.telefone)].filter(Boolean).map(esc).join(' · ');
    lista.innerHTML = `
      <ul class="linhas so-celular">
        ${clientes.map((c) => `
          <li>
            <button type="button" class="linha-botao" data-ver="${c.id}">
              <span class="avatar">${esc(iniciais(c.nome))}</span>
              <span class="min0">
                <span class="item-titulo d-bloco">${esc(c.nome)}</span>
                <span class="texto-aux d-bloco elipse">${detalheLinha(c) || 'Sem telefone'}</span>
                <span class="d-bloco texto-p">${garantiaTxt(resumo.get(c.id)?.garantia)}</span>
              </span>
            </button>
            ${c.telefone ? `<a class="btn-icone btn-borda verde" href="${linkWhats(c.telefone)}" target="_blank" rel="noopener" aria-label="WhatsApp de ${esc(c.nome)}">${icone('whatsapp', 22)}</a>` : ''}
          </li>`).join('')}
      </ul>
      <div class="tabela-rolagem so-notebook">
        <table class="tabela">
          <thead><tr><th>Cliente</th><th>Telefone</th><th>Veículo · placa</th><th class="num">Compras</th><th class="num">Última</th><th></th></tr></thead>
          <tbody>
            ${clientes.map((c) => {
              const r = resumo.get(c.id);
              return `
              <tr data-ver="${c.id}" class="${c.id === selecionado ? 'selecionada' : ''}">
                <td><strong>${esc(c.nome)}</strong></td>
                <td class="texto-aux">${esc(telefone(c.telefone))}</td>
                <td>${[c.veiculo, c.placa].filter(Boolean).map(esc).join(' · ')}</td>
                <td class="num">${r?.vendas.size ?? 0}</td>
                <td class="num texto-aux">${r?.ultima ? (r.ultima.slice(0, 4) === hojeISO().slice(0, 4) ? diaMes(r.ultima) : mesAno(r.ultima)) : ''}</td>
                <td class="num"><button type="button" class="btn btn-secundario btn-p">Ver</button></td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>`;
  }

  async function htmlDetalhe(c) {
    const hist = ok(await supabase.from('vw_venda_itens_detalhe')
      .select('venda_id, venda_numero, data_hora, modelo, quantidade, total_item, garantia_ate, status')
      .eq('cliente_id', c.id).order('data_hora', { ascending: false }).limit(30));
    const concluidas = hist.filter((h) => h.status === 'concluida');
    const total = concluidas.reduce((s, h) => s + Number(h.total_item), 0);
    const nVendas = new Set(concluidas.map((h) => h.venda_id)).size;
    return `
      <div class="detalhe-cliente">
        <div class="cliente-topo">
          <span class="avatar avatar-g">${esc(iniciais(c.nome))}</span>
          <div class="min0">
            <h2 class="titulo-m">${esc(c.nome)}</h2>
            <p class="texto-aux">${[telefone(c.telefone), c.veiculo, c.placa].filter(Boolean).map(esc).join(' · ')}</p>
          </div>
        </div>
        <div class="grade-2 mini-cartoes">
          <div class="mini"><span class="texto-aux">Total gasto</span><strong>${dinheiro(total)}</strong></div>
          <div class="mini"><span class="texto-aux">Compras</span><strong>${nVendas}</strong></div>
        </div>
        ${c.obs ? `<p class="texto-aux">${esc(c.obs)}</p>` : ''}
        <h3 class="sub">Compras e garantias</h3>
        ${hist.length ? `<ul class="lista-simples">
          ${hist.map((h) => `
            <li class="${h.status === 'cancelada' ? 'cancelada' : ''}">
              <div><strong class="riscavel">${h.quantidade}× ${esc(h.modelo)}</strong><div class="texto-aux">${data(h.data_hora)} · nº ${h.venda_numero}</div></div>
              <div class="direita"><span class="riscavel">${dinheiro(h.total_item)}</span>
                <div class="texto-p">${h.status === 'cancelada' ? '<span class="vermelho forte">Cancelada</span>'
                  : h.garantia_ate ? (h.garantia_ate < hojeISO() ? '<span class="texto-aux forte">Vencida</span>' : `<span class="verde forte">Garantia até ${data(h.garantia_ate + 'T12:00')}</span>`) : ''}</div>
              </div>
            </li>`).join('')}
        </ul>` : '<p class="texto-aux">Ainda não comprou.</p>'}
        <div class="botoes-lado">
          ${c.telefone ? `<a class="btn btn-escuro" href="${linkWhats(c.telefone)}" target="_blank" rel="noopener">${icone('whatsapp', 20)}Chamar no WhatsApp</a>` : ''}
          <button type="button" class="btn btn-secundario" data-editar="${c.id}">Editar</button>
        </div>
      </div>`;
  }

  async function ver(id) {
    selecionado = id;
    const c = clientes.find((x) => x.id === id) ?? ok(await supabase.from('clientes').select('*').eq('id', id).single());
    if (ehNotebook()) {
      raiz.querySelectorAll('tr[data-ver]').forEach((tr) => tr.classList.toggle('selecionada', tr.dataset.ver === id));
      painel.hidden = false;
      painel.innerHTML = '<p class="texto-aux">Carregando…</p>';
      painel.innerHTML = await htmlDetalhe(c);
    } else {
      const html = await htmlDetalhe(c);
      await abrirJanela({
        titulo: 'Cliente',
        html,
        montar(corpo, fechar) {
          corpo.querySelector('[data-editar]')?.addEventListener('click', async (e) => {
            e.stopPropagation();
            fechar();
            editar(id);
          });
        },
      });
    }
  }

  async function editar(id) {
    const c = clientes.find((x) => x.id === id) ?? ok(await supabase.from('clientes').select('*').eq('id', id).single());
    const salvo = await abrirJanelaCliente({ cliente: c, textoBotao: 'Salvar alterações' });
    if (salvo) {
      aviso('Cliente salvo.', 'ok');
      await carregar($('#busca', raiz).value.trim());
      if (ehNotebook()) ver(salvo.id);
    }
  }

  raiz.addEventListener('click', async (e) => {
    const alvo = e.target.closest('[data-ver], [data-editar], #novo, #exportar');
    if (!alvo) return;
    try {
      if (alvo.id === 'novo') {
        const novo = await abrirJanelaCliente({ textoBotao: 'Salvar cliente' });
        if (novo) {
          aviso(`${novo.nome} cadastrado.`, 'ok');
          await carregar($('#busca', raiz).value.trim());
          contar();
          if (ehNotebook()) ver(novo.id);
        }
      } else if (alvo.id === 'exportar') {
        await exportarClientes();
      } else if (alvo.dataset.editar) editar(alvo.dataset.editar);
      else ver(alvo.dataset.ver);
    } catch (err) {
      aviso(mensagemDeErro(err), 'erro');
    }
  });

  $('#busca', raiz).addEventListener('input', debounce((e) => carregar(e.target.value.trim())));

  contar();
  await carregar();
  if (selecionado) ver(selecionado);
}
