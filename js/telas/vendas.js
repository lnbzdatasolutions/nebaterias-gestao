// Histórico de vendas (#vendas, #vendas/sem-nota, #vendas/<número>).
// Celular: lista com chips e detalhe em tela própria. Notebook: tabela com filtros e detalhe ao lado.
import { supabase, ok, mensagemDeErro } from '../supabase.js';
import { icone } from '../icones.js';
import { pedirTexto } from '../componentes/janela.js';
import { abrirEditarVenda } from '../componentes/janela-editar-venda.js';
import { seloNota, rotuloNota, chaveEmBlocos } from '../componentes/nota-fiscal.js';
import { textoComprovante } from './venda-registrada.js';
import {
  $, esc, dinheiro, data, hora, telefone, iniciais, hojeISO, debounce, aviso, ocupado, ehNotebook, FUSO,
} from '../util.js';

const ATENDIMENTO = { balcao: 'Balcão', entrega: 'Entrega', socorro: 'Socorro' };
const POR_PAGINA = 50;
const COLUNAS = 'id, numero, data_hora, data_local, cliente_id, cliente_nome, cliente_telefone, total, status, itens_resumo, '
  + 'pagamentos_resumo, tipo_atendimento, local_atendimento, lucro_bruto, situacao_nota, nota_modelo, nota_numero';
const itensTxt = (t) => String(t ?? '').replace(/(\d+)x /g, '$1× ');
const diaHora = (d) => `${new Date(d).toLocaleDateString('pt-BR', { timeZone: FUSO, day: '2-digit', month: '2-digit' })} ${hora(d)}`;

function periodo(chave) {
  const hoje = hojeISO();
  const [a, m] = hoje.split('-').map(Number);
  const iso = (d) => d.toISOString().slice(0, 10);
  switch (chave) {
    case 'hoje': return [hoje, hoje];
    case '7dias': return [iso(new Date(Date.parse(hoje) - 6 * 864e5)), hoje];
    case 'mes': return [`${hoje.slice(0, 8)}01`, hoje];
    case 'mes-anterior': {
      const ini = new Date(Date.UTC(a, m - 2, 1));
      return [iso(ini), iso(new Date(Date.UTC(a, m - 1, 0)))];
    }
    case 'ano': return [`${a}-01-01`, hoje];
    default: return [null, null];
  }
}
const NOME_PERIODO = {
  hoje: 'Hoje', '7dias': 'Últimos 7 dias', mes: 'Este mês', 'mes-anterior': 'Mês anterior', ano: 'Este ano', tudo: 'Tudo',
};
const tituloPeriodo = (p) => {
  if (p === 'mes' || p === 'mes-anterior') {
    const [ini] = periodo(p);
    const t = new Date(`${ini}T12:00`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
    return t.charAt(0).toUpperCase() + t.slice(1);
  }
  return NOME_PERIODO[p];
};

export async function render(raiz, ctx) {
  const p0 = ctx.params[0] ?? '';
  if (/^\d+$/.test(p0) && !ehNotebook()) return renderDetalheCelular(raiz, Number(p0));

  const f = {
    busca: '',
    periodo: p0 === 'sem-nota' ? 'tudo' : 'mes',
    pagamento: '',
    status: '',
    nota: p0 === 'sem-nota' ? 'pendente' : '',
  };
  let vendas = [];
  let total = 0;
  let selecionada = /^\d+$/.test(p0) ? Number(p0) : null;
  let formas = [];
  let resumo = { vendas_sem_nota: 0, notas_para_cancelar: 0 };

  raiz.innerHTML = `
    <header class="cabecalho">
      <a href="#inicio" class="btn-icone so-celular" aria-label="Voltar">${icone('voltar', 26, 2.2)}</a>
      <div class="cabecalho-titulo">
        <h1 class="titulo">Vendas</h1>
        <p class="texto-aux" id="resumo-lista">&nbsp;</p>
      </div>
      <div class="acoes-topo so-notebook"><a href="#vender" class="btn btn-primario">${icone('mais', 20, 2.4)}Nova venda</a></div>
    </header>

    <div class="chips-filtro rolagem-x so-celular" id="chips"></div>

    <div class="filtros-vendas so-notebook">
      <div class="campo"><label for="fv-busca">Buscar</label><input id="fv-busca" type="search" placeholder="Nº, cliente ou modelo" autocomplete="off"></div>
      <div class="campo"><label for="fv-periodo">Período</label><select id="fv-periodo">
        ${Object.entries(NOME_PERIODO).map(([k, t]) => `<option value="${k}">${t}</option>`).join('')}</select></div>
      <div class="campo"><label for="fv-pag">Pagamento</label><select id="fv-pag"><option value="">Todos</option></select></div>
      <div class="campo"><label for="fv-sit">Situação</label><select id="fv-sit">
        <option value="">Todas</option><option value="concluida">Concluídas</option><option value="cancelada">Canceladas</option></select></div>
      <div class="campo"><span class="rotulo-campo">Nota fiscal</span><div class="seg-nota" id="seg-nota"></div></div>
    </div>

    <div class="grade-detalhe">
      <div class="cartao lista-cartao">
        <div id="lista"><p class="texto-aux pad">Carregando…</p></div>
        <div class="rodape-lista" id="rodape-lista" hidden></div>
      </div>
      <aside id="detalhe" class="cartao so-notebook painel-detalhe" hidden></aside>
    </div>`;

  const lista = $('#lista', raiz);
  const painel = $('#detalhe', raiz);
  $('#fv-periodo', raiz).value = f.periodo;

  function aplicarFiltros(q) {
    const [ini, fim] = periodo(f.periodo);
    if (ini) q = q.gte('data_local', ini).lte('data_local', fim);
    if (f.pagamento) q = q.ilike('pagamentos_resumo', `%${f.pagamento}%`);
    if (f.status) q = q.eq('status', f.status);
    if (f.nota) q = q.eq('situacao_nota', f.nota);
    const t = f.busca.replace(/[,()*%]/g, ' ').trim();
    if (/^#?\d+$/.test(t)) q = q.eq('numero', Number(t.replace('#', '')));
    else if (t) q = q.or(`cliente_nome.ilike.*${t}*,itens_resumo.ilike.*${t}*`);
    return q;
  }

  async function carregar(mais = false) {
    try {
      const inicio = mais ? vendas.length : 0;
      const r = await aplicarFiltros(supabase.from('vw_vendas_lista').select(COLUNAS, { count: 'exact' }))
        .order('data_hora', { ascending: false }).range(inicio, inicio + POR_PAGINA - 1);
      if (r.error) throw r.error;
      vendas = mais ? [...vendas, ...r.data] : r.data;
      total = r.count ?? vendas.length;
      if (!mais) desenharResumo();
      desenhar();
    } catch (e) {
      lista.innerHTML = `<p class="msg-erro">${esc(mensagemDeErro(e))}</p>`;
    }
  }

  async function desenharResumo() {
    const { data: linhas } = await aplicarFiltros(supabase.from('vw_vendas_lista').select('total, status')).limit(5000);
    const concl = (linhas ?? []).filter((v) => v.status === 'concluida');
    const canc = (linhas ?? []).length - concl.length;
    const soma = concl.reduce((s, v) => s + Number(v.total), 0);
    $('#resumo-lista', raiz).textContent = [
      tituloPeriodo(f.periodo), `${concl.length} ${concl.length === 1 ? 'venda' : 'vendas'}`, dinheiro(soma),
      canc ? `${canc} ${canc === 1 ? 'cancelada' : 'canceladas'}` : '',
    ].filter(Boolean).join(' · ');
  }

  async function carregarContadores() {
    const { data: r } = await supabase.from('vw_resumo_notas').select('*').maybeSingle();
    if (r) resumo = r;
    desenharChips();
  }

  function desenharChips() {
    const chips = [
      ['todas', 'Todas', !f.nota && !f.status],
      ['pendente', `Sem nota (${resumo.vendas_sem_nota})`, f.nota === 'pendente'],
      ['emitida', 'Com nota', f.nota === 'emitida'],
      ...(resumo.notas_para_cancelar ? [['cancelar_nota', `Cancelar nota (${resumo.notas_para_cancelar})`, f.nota === 'cancelar_nota']] : []),
      ['canceladas', 'Canceladas', f.status === 'cancelada'],
    ];
    $('#chips', raiz).innerHTML = chips.map(([k, t, ativo]) =>
      `<button type="button" class="chip" data-chip="${k}" aria-pressed="${ativo}">${t}</button>`).join('');
    const seg = [['', 'Todas'], ['pendente', `Sem nota (${resumo.vendas_sem_nota})`], ['cancelar_nota', `Cancelar (${resumo.notas_para_cancelar})`]];
    $('#seg-nota', raiz).innerHTML = seg.map(([k, t]) =>
      `<button type="button" data-seg-nota="${k}" aria-pressed="${f.nota === k}">${t}</button>`).join('');
  }

  function desenhar() {
    if (!vendas.length) {
      lista.innerHTML = `<p class="texto-aux pad">${f.nota === 'pendente' ? 'Nenhuma venda sem nota. Tudo em dia.' : 'Nenhuma venda encontrada.'}</p>`;
      $('#rodape-lista', raiz).hidden = true;
      return;
    }
    const linha2 = (v) => [diaHora(v.data_hora), v.pagamentos_resumo, v.status === 'cancelada' ? 'cancelada' : (v.cliente_nome || ATENDIMENTO[v.tipo_atendimento])]
      .filter(Boolean).map(esc).join(' · ');
    lista.innerHTML = `
      <ul class="linhas so-celular">
        ${vendas.map((v) => `
          <li class="${v.status === 'cancelada' ? 'cancelada' : ''}">
            <a class="linha-botao" href="#vendas/${v.numero}">
              <span class="min0">
                <span class="item-titulo d-bloco riscavel">Nº ${v.numero} · ${esc(itensTxt(v.itens_resumo))}</span>
                <span class="texto-aux d-bloco elipse">${linha2(v)}</span>
              </span>
              <span class="direita"><span class="item-titulo riscavel">${dinheiro(v.total)}</span>${seloNota(v)}</span>
            </a>
          </li>`).join('')}
      </ul>
      <div class="tabela-rolagem so-notebook">
        <table class="tabela">
          <thead><tr><th>Nº</th><th>Data</th><th>Cliente</th><th>Baterias</th><th>Pagamento</th><th>Nota</th><th class="num">Total</th><th class="num">Lucro</th><th></th></tr></thead>
          <tbody>
            ${vendas.map((v) => `
              <tr data-numero="${v.numero}" class="${v.status === 'cancelada' ? 'cancelada' : ''} ${v.numero === selecionada ? 'selecionada' : ''}">
                <td><strong>#${v.numero}</strong></td>
                <td class="texto-medio">${diaHora(v.data_hora)}</td>
                <td class="quebra">${v.cliente_nome ? esc(v.cliente_nome) : '<span class="texto-aux">Sem cadastro</span>'}</td>
                <td class="quebra">${esc(itensTxt(v.itens_resumo))}</td>
                <td class="texto-medio quebra">${esc(v.pagamentos_resumo ?? '')}</td>
                <td>${seloNota(v)}</td>
                <td class="num"><strong class="riscavel">${dinheiro(v.total)}</strong></td>
                <td class="num ${v.status === 'cancelada' ? 'texto-aux' : 'verde'}">${v.status === 'cancelada' ? '-' : dinheiro(v.lucro_bruto)}</td>
                <td class="num"><button type="button" class="btn btn-secundario btn-p">Ver</button></td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
    const rodape = $('#rodape-lista', raiz);
    rodape.hidden = false;
    rodape.innerHTML = `<span class="texto-aux">Mostrando ${vendas.length} de ${total}</span>
      ${vendas.length < total ? '<button type="button" class="btn btn-secundario" id="mais">Carregar mais</button>' : ''}`;
  }

  async function ver(numero) {
    selecionada = numero;
    raiz.querySelectorAll('tr[data-numero]').forEach((tr) => tr.classList.toggle('selecionada', Number(tr.dataset.numero) === numero));
    history.replaceState(null, '', `#vendas/${numero}`);
    painel.hidden = false;
    painel.innerHTML = '<p class="texto-aux">Carregando…</p>';
    await montarDetalhe(painel, numero, {
      compacto: true,
      aoMudar: async () => { await Promise.all([carregar(), carregarContadores()]); ver(numero); },
    });
  }

  // eventos
  raiz.addEventListener('click', (e) => {
    const alvo = e.target.closest('[data-chip], [data-seg-nota], tr[data-numero], #mais');
    if (!alvo) return;
    if (alvo.id === 'mais') return carregar(true);
    if (alvo.dataset.numero) return ver(Number(alvo.dataset.numero));
    if (alvo.dataset.segNota !== undefined) {
      f.nota = alvo.dataset.segNota;
      if (f.nota) { f.periodo = 'tudo'; $('#fv-periodo', raiz).value = 'tudo'; }
    } else {
      const k = alvo.dataset.chip;
      f.nota = ['pendente', 'emitida', 'cancelar_nota'].includes(k) ? k : '';
      f.status = k === 'canceladas' ? 'cancelada' : '';
      f.periodo = ['pendente', 'cancelar_nota'].includes(k) ? 'tudo' : 'mes';
    }
    desenharChips();
    carregar();
  });
  $('#fv-busca', raiz).addEventListener('input', debounce((e) => { f.busca = e.target.value; carregar(); }));
  $('#fv-periodo', raiz).addEventListener('change', (e) => { f.periodo = e.target.value; carregar(); });
  $('#fv-pag', raiz).addEventListener('change', (e) => { f.pagamento = e.target.value; carregar(); });
  $('#fv-sit', raiz).addEventListener('change', (e) => { f.status = e.target.value; carregar(); });

  supabase.from('formas_pagamento').select('nome').eq('ativo', true).order('ordem').then(({ data: fs }) => {
    formas = fs ?? [];
    $('#fv-pag', raiz).insertAdjacentHTML('beforeend', formas.map((x) => `<option>${esc(x.nome)}</option>`).join(''));
  });
  desenharChips();
  await Promise.all([carregar(), carregarContadores()]);
  if (selecionada && ehNotebook()) ver(selecionada);
}

// ---------- detalhe (painel no notebook, tela no celular) ----------

async function renderDetalheCelular(raiz, numero) {
  raiz.innerHTML = '<div class="carregando">Carregando…</div>';
  await montarDetalhe(raiz, numero, { compacto: false, aoMudar: () => renderDetalheCelular(raiz, numero) });
}

async function montarDetalhe(el, numero, { compacto, aoMudar }) {
  let v;
  let itens;
  try {
    v = ok(await supabase.from('vw_vendas_lista').select('*').eq('numero', numero).single());
    itens = ok(await supabase.from('vw_venda_itens_detalhe')
      .select('modelo, marca, quantidade, preco_unitario, total_item, garantia_ate').eq('venda_id', v.id).order('modelo'));
  } catch (e) {
    el.innerHTML = `<p class="msg-erro">Venda nº ${numero}: ${esc(mensagemDeErro(e))}</p>`;
    return;
  }
  const cancelada = v.status === 'cancelada';
  const garantia = [...new Set(itens.map((i) => i.garantia_ate).filter(Boolean))];
  const cabecalho = compacto ? `
      <div class="rotulo-linha"><h2 class="titulo-m">Venda nº ${v.numero}</h2>
        <strong class="${cancelada ? 'vermelho' : 'verde'} texto-p">${cancelada ? 'Cancelada' : 'Concluída'}</strong></div>
      <p class="texto-aux">${diaHora(v.data_hora)} · ${ATENDIMENTO[v.tipo_atendimento]}${v.local_atendimento ? ` · ${esc(v.local_atendimento)}` : ''}</p>`
    : `
      <header class="cabecalho">
        <a href="#vendas" class="btn-icone" aria-label="Voltar para vendas">${icone('voltar', 26, 2.2)}</a>
        <div class="cabecalho-titulo"><h1 class="titulo">Venda nº ${v.numero}</h1>
          <p class="texto-aux">${data(v.data_hora)} ${hora(v.data_hora)} · ${cancelada ? '<span class="vermelho forte">Cancelada</span>' : 'Concluída'}</p></div>
      </header>`;

  let cartaoNota = '';
  if (v.situacao_nota === 'pendente') {
    cartaoNota = `
      <div class="cartao-nota nota-pendente">
        ${compacto ? `<div class="rotulo-linha"><strong>Nota fiscal</strong><span class="texto-p forte amarelo">Pendente</span></div>
          <p class="texto-p">Emita no Tiranota e cole a chave aqui.</p>`
        : `<div class="cartao-nota-topo">${icone('documento', 28)}<div><strong>Nota fiscal ainda não informada</strong>
          <p>Emita no Tiranota e registre aqui o número ou a chave.</p></div></div>`}
        <button type="button" class="btn btn-primario ${compacto ? '' : 'btn-grande'}" data-editar>Informar nota fiscal</button>
      </div>`;
  } else if (v.situacao_nota === 'emitida') {
    cartaoNota = `
      <div class="cartao-nota nota-ok">
        <div class="rotulo-linha"><strong>${esc(rotuloNota(v.nota_modelo, v.nota_numero))} · série ${v.nota_serie}</strong><span class="selo selo-ok">Emitida</span></div>
        ${v.nota_chave ? `<p class="texto-p chave-txt">${esc(chaveEmBlocos(v.nota_chave))}</p>` : ''}
      </div>`;
  } else if (v.situacao_nota === 'cancelar_nota') {
    cartaoNota = `
      <div class="cartao-nota nota-perigo">
        <div class="rotulo-linha"><strong>${esc(rotuloNota(v.nota_modelo, v.nota_numero))}</strong><span class="selo selo-perigo">Cancelar nota</span></div>
        <p class="texto-p">A venda foi cancelada, mas a nota continua emitida. Cancele no Tiranota e marque aqui.</p>
        <button type="button" class="btn btn-perigo" data-editar>Marcar nota como cancelada</button>
      </div>`;
  }

  const c = v.cliente_id ? { nome: v.cliente_nome, telefone: v.cliente_telefone } : null;
  el.innerHTML = `
    <div class="detalhe-venda ${compacto ? '' : 'detalhe-cheio'}">
      ${cabecalho}
      ${cartaoNota}
      ${cancelada && v.motivo_cancelamento ? `<p class="nota nota-alerta">${icone('alerta', 18)}<span>Cancelada: ${esc(v.motivo_cancelamento)}</span></p>` : ''}
      ${compacto && c ? `<div class="cliente-escolhido"><div class="min0"><strong>${esc(c.nome)}</strong>
          <div class="texto-aux">${esc(telefone(c.telefone))}</div></div></div>` : ''}
      <div class="${compacto ? '' : 'cartao'} contas">
        ${itens.map((i) => `<div class="linha-conta"><span>${i.quantidade}× ${compacto ? '' : `Bateria ${esc(i.marca)} `}${esc(i.modelo)}</span><span>${dinheiro(i.quantidade * i.preco_unitario)}</span></div>`).join('')}
        <div class="linha-conta texto-aux"><span>Desconto</span><span>${dinheiro(v.desconto_total)}</span></div>
        <div class="linha-conta linha-conta-total"><strong>Total</strong><strong class="riscavel ${cancelada ? 'cancelada' : ''}">${dinheiro(v.total)}</strong></div>
        <div class="linha-conta texto-aux"><span>Pagamento</span><span>${esc(v.pagamentos_resumo ?? '-')}</span></div>
        ${compacto && !cancelada ? `<div class="linha-conta verde forte"><span>Lucro bruto</span><span>${dinheiro(v.lucro_bruto)}</span></div>` : ''}
        ${garantia.length ? `<div class="linha-conta texto-aux"><span>Garantia até</span><span>${garantia.map((g) => data(`${g}T12:00`)).join(', ')}</span></div>` : ''}
      </div>
      ${compacto ? '' : `
      <div class="cartao">
        ${c ? `<div class="cliente-topo"><span class="avatar avatar-g">${esc(iniciais(c.nome))}</span>
          <div class="min0"><strong class="d-bloco">${esc(c.nome)}</strong><span class="texto-aux">${esc(telefone(c.telefone))}</span></div></div>
          <div class="sep"></div>` : ''}
        <div class="linha-conta"><span class="texto-aux">Atendimento</span><span>${ATENDIMENTO[v.tipo_atendimento]}${v.local_atendimento ? ` · ${esc(v.local_atendimento)}` : ''}</span></div>
        ${v.obs ? `<p class="texto-p"><span class="texto-aux">Observação:</span> ${esc(v.obs)}</p>` : ''}
      </div>`}
      ${compacto && v.obs ? `<p class="texto-p"><span class="texto-aux">Observação:</span> ${esc(v.obs)}</p>` : ''}
      <div class="acoes-detalhe">
        <button type="button" class="btn btn-secundario" data-editar>Editar venda</button>
        <button type="button" class="btn btn-escuro" data-reenviar>Reenviar comprovante</button>
        ${cancelada ? '' : '<button type="button" class="btn btn-perigo" data-cancelar>Cancelar venda</button>'}
      </div>
    </div>`;

  el.querySelectorAll('[data-editar]').forEach((b) => b.addEventListener('click', async () => {
    if (await abrirEditarVenda(v.id)) aoMudar();
  }));
  el.querySelector('[data-reenviar]').addEventListener('click', async () => {
    const { data: loja } = await supabase.from('loja_config').select('*').single();
    const texto = textoComprovante(v, itens, loja);
    const tel = String(v.cliente_telefone ?? '').replace(/\D/g, '');
    window.open(`https://wa.me/${tel ? `55${tel}` : ''}?text=${encodeURIComponent(texto)}`, '_blank', 'noopener');
  });
  el.querySelector('[data-cancelar]')?.addEventListener('click', async (e) => {
    const motivo = await pedirTexto({
      titulo: `Cancelar venda nº ${v.numero}`,
      rotulo: 'Motivo do cancelamento',
      sim: 'Cancelar venda e devolver estoque',
      perigo: true,
    });
    if (!motivo) return;
    await ocupado(e.target, async () => {
      try {
        ok(await supabase.rpc('cancelar_venda', { p_venda_id: v.id, p_motivo: motivo }));
        aviso(v.situacao_nota === 'emitida'
          ? `Venda nº ${v.numero} cancelada. Cancele também a nota no Tiranota.`
          : `Venda nº ${v.numero} cancelada e estoque devolvido.`, 'ok');
        aoMudar();
      } catch (err) {
        aviso(mensagemDeErro(err), 'erro');
        if (/já está cancelada/i.test(err.message)) aoMudar();
      }
    }, 'Cancelando…');
  });
}
