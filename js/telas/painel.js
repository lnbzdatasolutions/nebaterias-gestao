// Painel (#painel): quanto vendi, quanto lucrei e o que mais vende no período.
// Números prontos do banco (só vendas concluídas). Chart.js é carregado só aqui.
import { supabase, ok, mensagemDeErro } from '../supabase.js';
import { icone } from '../icones.js';
import { escolherBateria } from '../componentes/escolher-bateria.js';
import {
  $, esc, dinheiro, percentual, saldo, hojeISO, linhaCurta, baixarCSV, ehNotebook, aviso, FUSO,
} from '../util.js';

const CHART_JS = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js';
const ATENDIMENTO = { balcao: 'Balcão', entrega: 'Entrega', socorro: 'Socorro' };
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const MESES_LONGOS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

let carregandoChart = null;
function carregarChart() {
  if (window.Chart) return Promise.resolve(window.Chart);
  carregandoChart ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = CHART_JS;
    s.onload = () => resolve(window.Chart);
    s.onerror = () => { carregandoChart = null; reject(new Error('Não foi possível carregar o gráfico.')); };
    document.head.append(s);
  });
  return carregandoChart;
}

// ---------- datas ----------
const iso = (d) => d.toISOString().slice(0, 10);
const utc = (s) => new Date(`${s}T00:00:00Z`);
const somarDias = (s, n) => iso(new Date(utc(s).getTime() + n * 864e5));
const diasEntre = (a, b) => Math.round((utc(b) - utc(a)) / 864e5) + 1;

/** Período escolhido e o período anterior equivalente. */
function periodos(tipo, ini, fim) {
  const hoje = hojeISO();
  const [a, m, d] = hoje.split('-').map(Number);
  const nomeMes = (mes) => MESES_LONGOS[(mes + 12) % 12];
  switch (tipo) {
    case 'hoje':
      return { atual: [hoje, hoje], anterior: [somarDias(hoje, -1), somarDias(hoje, -1)], titulo: 'Hoje', vs: 'ontem' };
    case '7dias':
      return { atual: [somarDias(hoje, -6), hoje], anterior: [somarDias(hoje, -13), somarDias(hoje, -7)], titulo: 'Últimos 7 dias', vs: '7 dias antes' };
    case 'ano': {
      const fimAnt = `${a - 1}${hoje.slice(4)}`;
      return { atual: [`${a}-01-01`, hoje], anterior: [`${a - 1}-01-01`, fimAnt === `${a - 1}-02-29` ? `${a - 1}-02-28` : fimAnt], titulo: `${a}`, vs: `${a - 1}` };
    }
    case 'personalizado': {
      const n = diasEntre(ini, fim);
      return { atual: [ini, fim], anterior: [somarDias(ini, -n), somarDias(ini, -1)], titulo: `${fmtData(ini)} a ${fmtData(fim)}`, vs: `${n} dias antes` };
    }
    default: { // mês: 1º até hoje, contra o mesmo trecho do mês anterior
      const ultimoAnt = new Date(Date.UTC(a, m - 1, 0)).getUTCDate();
      const ma = m === 1 ? 12 : m - 1;
      const aa = m === 1 ? a - 1 : a;
      const mm = String(ma).padStart(2, '0');
      const titulo = `${nomeMes(m - 1).replace(/^./, (c) => c.toUpperCase())} de ${a}`;
      return {
        atual: [`${hoje.slice(0, 8)}01`, hoje],
        anterior: [`${aa}-${mm}-01`, `${aa}-${mm}-${String(Math.min(d, ultimoAnt)).padStart(2, '0')}`],
        titulo, vs: nomeMes(ma - 1),
      };
    }
  }
}
const fmtData = (s) => new Date(`${s}T12:00`).toLocaleDateString('pt-BR', { timeZone: FUSO, day: '2-digit', month: '2-digit' });

/** R$ 18.420 (sem centavos, para cartões grandes) */
const dinheiroInteiro = (v) => `R$ ${Math.round(Number(v) || 0).toLocaleString('pt-BR')}`;
const milhar = (v) => (Math.abs(v) >= 1000 ? `${(v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}k` : String(Math.round(v)));

function variacao(atual, anterior, { pontos = false } = {}) {
  const a = Number(atual);
  const b = Number(anterior);
  if (pontos) {
    if (atual === null || anterior === null) return '';
    const dif = Math.round((a - b) * 10) / 10;
    if (!dif) return '<span class="var-neutra">= período anterior</span>';
    return `<span class="${dif > 0 ? 'var-sobe' : 'var-desce'}">${dif > 0 ? '▲' : '▼'} ${percentual(Math.abs(dif)).replace('%', '')} ponto${Math.abs(dif) >= 2 ? 's' : ''}</span>`;
  }
  if (!b) return '';
  const v = Math.round(((a - b) / Math.abs(b)) * 100);
  if (!v) return '<span class="var-neutra">= período anterior</span>';
  return `<span class="${v > 0 ? 'var-sobe' : 'var-desce'}">${v > 0 ? '▲' : '▼'} ${Math.abs(v)}%</span>`;
}

function barras(lista, cor) {
  if (!lista.length) return '<p class="texto-aux">Sem vendas no período.</p>';
  return lista.map(([nome, pct]) => `
    <div class="barra-linha">
      <span>${esc(nome)}</span>
      <span class="barra-trilho"><span class="barra-cheia ${cor}" style="width:${Math.max(Number(pct) || 0, 2)}%"></span></span>
      <strong>${Math.round(Number(pct) || 0)}%</strong>
    </div>`).join('');
}

// ---------- filtro por bateria ----------
// As funções do painel no banco agregam todas as baterias. Com uma bateria escolhida,
// os números saem dos itens vendidos dela (vw_venda_itens_detalhe), poucos por período.
// Taxas, formas de pagamento e atendimento de cada venda entram na proporção do valor
// que essa bateria teve na venda.

function indicadoresItens(itens, taxas = 0) {
  const fat = itens.reduce((s, i) => s + Number(i.total_item), 0);
  const cmv = itens.reduce((s, i) => s + Number(i.custo_total), 0);
  const desc = itens.reduce((s, i) => s + Number(i.desconto_rateado), 0);
  const qtd = itens.reduce((s, i) => s + Number(i.quantidade), 0);
  const n = new Set(itens.map((i) => i.venda_id)).size;
  const r1 = (v) => Math.round(v * 10) / 10;
  return {
    faturamento: fat, cmv, lucro_bruto: fat - cmv, taxas, lucro_liquido: fat - cmv - taxas,
    margem_pct: fat > 0 ? r1(((fat - cmv) / fat) * 100) : null,
    markup_pct: cmv > 0 ? r1((fat / cmv - 1) * 100) : null,
    qtd_vendas: n, qtd_baterias: qtd, ticket_medio: n ? fat / n : 0,
    descontos: desc, desconto_pct: fat + desc > 0 ? r1((desc / (fat + desc)) * 100) : 0,
  };
}

async function dadosDaBateria(produto, per, inicio12) {
  const colunas = 'venda_id, venda_numero, data_hora, data_local, quantidade, total_item, desconto_rateado, custo_total, lucro_bruto';
  const itensDe = (ini, fim) => supabase.from('vw_venda_itens_detalhe').select(colunas)
    .eq('produto_id', produto.id).eq('status', 'concluida').gte('data_local', ini).lte('data_local', fim)
    .order('data_hora', { ascending: false }).then(ok);
  const [itens, itensAnt, itens12, prod] = await Promise.all([
    itensDe(...per.atual), itensDe(...per.anterior), itensDe(inicio12, hojeISO()),
    supabase.from('vw_produtos_estoque').select('*').eq('id', produto.id).single().then(ok),
  ]);

  const ids = [...new Set(itens.map((i) => i.venda_id))];
  let vendas = [];
  let pagamentos = [];
  if (ids.length) {
    [vendas, pagamentos] = await Promise.all([
      supabase.from('vw_vendas_lista').select('id, total, taxas, tipo_atendimento').in('id', ids).then(ok),
      supabase.from('venda_pagamentos').select('venda_id, valor, formas_pagamento(nome)').in('venda_id', ids).then(ok),
    ]);
  }
  const valorNaVenda = new Map();
  for (const i of itens) valorNaVenda.set(i.venda_id, (valorNaVenda.get(i.venda_id) ?? 0) + Number(i.total_item));
  const parte = new Map(vendas.map((v) => [v.id, Number(v.total) > 0 ? (valorNaVenda.get(v.id) ?? 0) / Number(v.total) : 0]));

  const taxas = vendas.reduce((s, v) => s + Number(v.taxas) * (parte.get(v.id) ?? 0), 0);
  const participacao = (mapa) => {
    const total = [...mapa.values()].reduce((s, v) => s + v, 0);
    return [...mapa.entries()].sort((a, b) => b[1] - a[1]).map(([nome, v]) => [nome, total ? (v / total) * 100 : 0]);
  };
  const porForma = new Map();
  for (const p of pagamentos) {
    const nome = p.formas_pagamento?.nome ?? '?';
    porForma.set(nome, (porForma.get(nome) ?? 0) + Number(p.valor) * (parte.get(p.venda_id) ?? 0));
  }
  const porAtend = new Map();
  for (const v of vendas) porAtend.set(v.tipo_atendimento, (porAtend.get(v.tipo_atendimento) ?? 0) + (valorNaVenda.get(v.id) ?? 0));

  const porMes = new Map();
  for (const i of itens12) {
    const mes = `${i.data_local.slice(0, 7)}-01`;
    const m = porMes.get(mes) ?? { mes, faturamento: 0, lucro_bruto: 0 };
    m.faturamento += Number(i.total_item);
    m.lucro_bruto += Number(i.lucro_bruto);
    porMes.set(mes, m);
  }

  const k = indicadoresItens(itens, taxas);
  const unidades = Math.max(Number(prod.estoque_atual), 0);
  return {
    k, kA: indicadoresItens(itensAnt), itens, prod,
    meses: [...porMes.values()],
    formas: participacao(porForma),
    atend: participacao(porAtend).map(([t, pct]) => [ATENDIMENTO[t] ?? t, pct]),
    linhas: k.faturamento ? [{ linha: prod.linha, margem_pct: k.margem_pct }] : [],
    valor: { unidades, valor_custo: unidades * Number(prod.custo_medio), valor_venda_potencial: unidades * Number(prod.preco_venda ?? 0) },
  };
}

function segPeriodo(tipo, comPersonalizado) {
  const opcoes = [['hoje', 'Hoje'], ['7dias', '7 dias'], ['mes', 'Mês'], ['ano', 'Ano'], ...(comPersonalizado ? [['personalizado', 'Personalizado']] : [])];
  return `<div class="seg-periodo" role="radiogroup" aria-label="Período">
    ${opcoes.map(([k, t]) => `<button type="button" data-periodo="${k}" aria-pressed="${k === tipo}">${t}</button>`).join('')}
  </div>`;
}

export async function render(raiz) {
  let tipo = 'mes';
  let ordenarTop = 'quantidade';
  let custom = [hojeISO().slice(0, 8) + '01', hojeISO()];
  let produto = null; // { id, modelo, linha } quando filtrado por uma bateria
  let grafico = null;

  raiz.innerHTML = `
    <header class="cabecalho cabecalho-painel">
      <div class="cabecalho-titulo">
        <h1 class="titulo">Painel</h1>
        <p class="texto-aux so-notebook" id="subtitulo">&nbsp;</p>
      </div>
      <div class="acoes-topo periodo so-notebook">
        <div class="datas-custom" id="datas-custom" hidden>
          <input type="date" id="dt-ini" aria-label="Data inicial" value="${custom[0]}" max="${hojeISO()}">
          <span>até</span>
          <input type="date" id="dt-fim" aria-label="Data final" value="${custom[1]}" max="${hojeISO()}">
        </div>
        ${segPeriodo(tipo, true)}
        <button type="button" class="btn btn-secundario" id="exportar">Exportar CSV</button>
      </div>
    </header>
    <div class="so-celular">${segPeriodo(tipo, false)}</div>
    <div class="filtro-bateria" id="filtro-bateria"></div>
    <section class="kpis" id="kpis" aria-label="Indicadores"></section>
    <div class="grade-painel">
      <section class="cartao grafico-cartao">
        <div class="grafico-topo">
          <div><h2 class="cartao-h" id="t-grafico">Faturamento por mês</h2><p class="melhor-mes" id="melhor-mes"></p></div>
          <div class="legenda so-notebook"><span><i class="leg-cinza"></i>Faturamento</span><span><i class="leg-verde"></i>Lucro bruto</span></div>
          <span class="texto-aux so-celular">últimos 6 meses</span>
        </div>
        <div class="grafico-area"><canvas id="grafico" aria-label="Faturamento e lucro por mês"></canvas></div>
      </section>
      <div class="pilha">
        <section class="cartao cartao-escuro estoque-parado" id="parado"></section>
        <section class="cartao" id="repor"></section>
      </div>
      <section class="cartao" id="top"></section>
      <section class="cartao" id="distribuicao"></section>
    </div>
    <p class="texto-aux legenda-margem"><strong>Markup</strong>: quanto se acrescentou sobre o custo. <strong>Margem</strong>: quanto do preço de venda virou lucro.</p>`;

  function desenharFiltro() {
    $('#filtro-bateria', raiz).innerHTML = produto
      ? `<span class="chip-filtro">${icone('produtos', 18)}<strong>${esc(produto.modelo)}</strong><span class="texto-aux">${esc(linhaCurta(produto.linha))}</span>
          <button type="button" class="btn-icone" data-limpar-bateria aria-label="Ver todas as baterias">${icone('fechar', 18)}</button></span>
         <button type="button" class="link-btn" data-escolher-bateria>Trocar</button>`
      : `<button type="button" class="btn btn-secundario btn-filtro" data-escolher-bateria>${icone('busca', 18)}Todas as baterias</button>`;
  }

  async function carregar() {
    const per = periodos(tipo, ...custom);
    const [ini, fim] = per.atual;
    const [iniA, fimA] = per.anterior;
    const inicio12 = iso(new Date(Date.UTC(Number(hojeISO().slice(0, 4)), Number(hojeISO().slice(5, 7)) - 12, 1)));
    $('#subtitulo', raiz).textContent = `${per.titulo} · comparado a ${per.vs}${produto ? ` · só ${produto.modelo}` : ''}`;
    $('#kpis', raiz).innerHTML = '<p class="texto-aux">Carregando…</p>';
    desenharFiltro();
    try {
      if (produto) {
        const d = await dadosDaBateria(produto, per, inicio12);
        desenharKpis(d.k, d.kA, per);
        desenharGrafico(d.meses);
        desenharVendasDaBateria(d.itens, d.prod, per);
        desenharDistribuicao(d.formas, d.atend, d.linhas);
        desenharEstoque(d.valor, null, d.prod);
        return;
      }
      const [k, kA, meses, formas, top, linhas, atend, valor, baixo] = await Promise.all([
        supabase.rpc('painel_indicadores', { p_inicio: ini, p_fim: fim }).single().then(ok),
        supabase.rpc('painel_indicadores', { p_inicio: iniA, p_fim: fimA }).single().then(ok),
        supabase.from('vw_resumo_mensal').select('mes, faturamento, lucro_bruto').gte('mes', inicio12).order('mes').then(ok),
        supabase.rpc('painel_por_forma_pagamento', { p_inicio: ini, p_fim: fim }).then(ok),
        supabase.rpc('painel_top_produtos', { p_inicio: ini, p_fim: fim, p_ordenar: ordenarTop, p_limite: 10 }).then(ok),
        supabase.rpc('painel_por_linha', { p_inicio: ini, p_fim: fim }).then(ok),
        supabase.rpc('painel_por_atendimento', { p_inicio: ini, p_fim: fim }).then(ok),
        supabase.from('vw_valor_estoque').select('*').single().then(ok),
        supabase.from('vw_estoque_baixo').select('id, modelo, linha, estoque_atual, estoque_minimo').then(ok),
      ]);
      desenharKpis(k, kA, per);
      desenharGrafico(meses);
      desenharTop(top, per);
      desenharDistribuicao(
        formas.map((f) => [f.forma_pagamento, f.participacao_pct]),
        atend.map((a) => [ATENDIMENTO[a.tipo_atendimento] ?? a.tipo_atendimento, a.participacao_pct]),
        linhas,
      );
      desenharEstoque(valor, baixo);
    } catch (e) {
      $('#kpis', raiz).innerHTML = `<p class="msg-erro">${esc(mensagemDeErro(e))}</p>`;
    }
  }

  function desenharVendasDaBateria(itens, prod, per) {
    $('#top', raiz).innerHTML = `
      <div class="rotulo-linha topo-top"><h2 class="cartao-h">Vendas da ${esc(prod.modelo)} ${per.titulo === 'Hoje' ? 'hoje' : 'no período'}</h2></div>
      ${!itens.length ? '<p class="texto-aux">Nenhuma venda desta bateria no período.</p>' : `
      <ul class="lista-simples">
        ${itens.slice(0, 15).map((i) => `<li><a class="linha-venda-bateria" href="#vendas/${i.venda_numero}">
          <span><strong>Nº ${i.venda_numero}</strong> <span class="texto-aux">${fmtData(i.data_local)} · ${i.quantidade} un</span></span>
          <span>${dinheiro(i.total_item)} <span class="verde forte">+${dinheiroInteiro(i.lucro_bruto)}</span></span></a></li>`).join('')}
      </ul>${itens.length > 15 ? `<p class="texto-aux texto-p">E mais ${itens.length - 15} vendas no período.</p>` : ''}`}`;
  }

  function desenharKpis(k, kA, per) {
    const vs = `vs. ${per.vs}`;
    const cartao = (rotulo, valor, sub, classe = '') =>
      `<div class="cartao kpi ${classe}"><div class="kpi-rotulo">${rotulo}</div><div class="kpi-valor">${valor}</div><div class="kpi-sub">${sub}</div></div>`;
    const n = Number(k.qtd_vendas);
    $('#kpis', raiz).innerHTML = [
      cartao('Faturamento', dinheiroInteiro(k.faturamento), variacao(k.faturamento, kA.faturamento) ? `${variacao(k.faturamento, kA.faturamento)} <span class="texto-aux">${vs}</span>` : '&nbsp;'),
      cartao('Lucro bruto', `<span class="verde">${dinheiroInteiro(k.lucro_bruto)}</span>`, variacao(k.lucro_bruto, kA.lucro_bruto) || '&nbsp;'),
      cartao('Lucro líquido', dinheiroInteiro(k.lucro_liquido), `após ${dinheiroInteiro(k.taxas)} de taxas`, 'so-notebook'),
      cartao('Margem', percentual(k.margem_pct), `<span class="so-celular-inline">do preço vira lucro</span><span class="so-notebook-inline">${variacao(k.margem_pct, kA.margem_pct, { pontos: true }) || 'do preço vira lucro'}</span>`),
      cartao('Markup', percentual(k.markup_pct), 'sobre o custo'),
      cartao('Vendas', n, `${k.qtd_baterias} ${Number(k.qtd_baterias) === 1 ? 'bateria' : 'baterias'}`, 'so-celular'),
      cartao('Ticket médio', ehNotebook() ? dinheiro(k.ticket_medio) : dinheiroInteiro(k.ticket_medio),
        `<span class="so-celular-inline">${variacao(k.ticket_medio, kA.ticket_medio) || '&nbsp;'}</span><span class="so-notebook-inline">${n} ${n === 1 ? 'venda' : 'vendas'} · ${k.qtd_baterias} baterias</span>`),
      Number(k.descontos) > 0 ? cartao('Descontos', dinheiroInteiro(k.descontos), `${percentual(k.desconto_pct)} do valor bruto`, 'kpi-extra') : '',
    ].join('');
  }

  async function desenharGrafico(meses) {
    // 12 meses fixos (zerados quando não houve venda)
    const hoje = hojeISO();
    const [a, m] = hoje.split('-').map(Number);
    const serie = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(Date.UTC(a, m - 1 - i, 1));
      const chave = iso(d);
      const linha = meses.find((x) => x.mes === chave);
      serie.push({ mes: chave, nome: MESES[d.getUTCMonth()], longo: MESES_LONGOS[d.getUTCMonth()], fat: Number(linha?.faturamento ?? 0), lucro: Number(linha?.lucro_bruto ?? 0) });
    }
    const notebook = ehNotebook();
    const usados = notebook ? serie : serie.slice(-6);
    const melhorFat = serie.reduce((b, x) => (x.fat > b.fat ? x : b), serie[0]);
    const melhorLucro = serie.reduce((b, x) => (x.lucro > b.lucro ? x : b), serie[0]);
    const temVenda = melhorFat.fat > 0;
    const anoAtual = melhorFat.mes.slice(0, 4) === String(a);
    $('#t-grafico', raiz).textContent = notebook && temVenda
      ? `${melhorFat.longo.replace(/^./, (c) => c.toUpperCase())} foi o melhor mês ${anoAtual ? 'do ano' : 'dos últimos 12'}: ${dinheiroInteiro(melhorFat.fat)}`
      : notebook ? 'Faturamento e lucro por mês' : 'Faturamento por mês';
    $('#melhor-mes', raiz).textContent = !temVenda ? 'Ainda sem vendas nos últimos 12 meses.'
      : notebook ? (melhorLucro.mes !== melhorFat.mes ? `Melhor mês em lucro: ${melhorLucro.longo} · ${dinheiroInteiro(melhorLucro.lucro)}` : '')
      : `Melhor mês: ${melhorFat.longo} · ${dinheiroInteiro(melhorFat.fat)}${melhorLucro.mes !== melhorFat.mes ? ` · em lucro: ${melhorLucro.longo}` : ''}`;

    let Chart;
    try { Chart = await carregarChart(); } catch (e) {
      $('.grafico-area', raiz).innerHTML = `<p class="texto-aux">${esc(e.message)}</p>`;
      return;
    }
    const css = getComputedStyle(document.documentElement);
    const cinza = '#9AA2AE';
    const amarelo = css.getPropertyValue('--primaria').trim() || '#FFC21A';
    const verde = css.getPropertyValue('--ok').trim() || '#1F7A4D';
    const texto = css.getPropertyValue('--texto-2').trim() || '#5B6472';
    const datasets = [{
      label: 'Faturamento', data: usados.map((x) => x.fat), borderRadius: 6,
      backgroundColor: usados.map((x) => (temVenda && x.mes === melhorFat.mes ? amarelo : cinza)),
    }];
    if (notebook) datasets.push({ label: 'Lucro bruto', data: usados.map((x) => x.lucro), backgroundColor: verde, borderRadius: 6 });
    // rótulos em cima das barras no celular
    const rotulos = {
      id: 'rotulos',
      afterDatasetsDraw(c) {
        if (notebook) return;
        const ctx = c.ctx;
        ctx.save();
        ctx.fillStyle = texto;
        ctx.font = '12px Inter, sans-serif';
        ctx.textAlign = 'center';
        c.getDatasetMeta(0).data.forEach((bar, i) => {
          const v = usados[i].fat;
          if (v > 0) ctx.fillText(milhar(v), bar.x, bar.y - 6);
        });
        ctx.restore();
      },
    };
    grafico?.destroy();
    grafico = new Chart($('#grafico', raiz), {
      type: 'bar',
      data: { labels: usados.map((x) => x.nome), datasets },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        layout: { padding: { top: notebook ? 4 : 22 } },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${dinheiro(c.parsed.y)}` } },
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: texto } },
          y: { display: notebook, beginAtZero: true, suggestedMax: temVenda ? undefined : 1000, grid: { color: 'rgba(128,128,128,.12)' }, ticks: { color: texto, callback: (v) => milhar(v) } },
        },
      },
      plugins: [rotulos],
    });
  }

  function desenharTop(top, per) {
    const titulo = tipo === 'mes' ? 'do mês' : tipo === 'ano' ? 'do ano' : 'do período';
    $('#top', raiz).innerHTML = `
      <div class="rotulo-linha topo-top">
        <h2 class="cartao-h"><span class="so-celular">Mais vendidas ${titulo}</span><span class="so-notebook">Top baterias ${titulo}</span></h2>
        <div class="seg-mini" role="radiogroup" aria-label="Ordenar por">
          ${[['quantidade', 'Quantidade'], ['faturamento', 'Faturamento'], ['lucro', 'Lucro']].map(([k, t]) =>
            `<button type="button" data-ordenar="${k}" aria-pressed="${k === ordenarTop}">${t}</button>`).join('')}
        </div>
      </div>
      ${!top.length ? `<p class="texto-aux">Sem vendas ${per.titulo === 'Hoje' ? 'hoje' : 'no período'}.</p>` : `
      <ol class="lista-top so-celular">
        ${top.slice(0, 5).map((p, i) => `<li data-produto='${esc(JSON.stringify({ id: p.produto_id, modelo: p.modelo, linha: p.linha }))}'><span class="texto-aux">${i + 1}</span><strong class="modelo-p">${esc(p.modelo)}</strong>
          <span class="texto-aux">${p.quantidade} un</span><strong class="verde">${dinheiroInteiro(ordenarTop === 'faturamento' ? p.faturamento : p.lucro_bruto)}</strong></li>`).join('')}
      </ol>
      <p class="texto-aux texto-p dica-top">Toque numa bateria para ver só ela.</p>
      <div class="tabela-rolagem so-notebook">
        <table class="tabela tabela-leve">
          <thead><tr><th>Modelo</th><th>Linha</th><th class="num">Qtd</th><th class="num">Faturamento</th><th class="num">Lucro</th><th class="num">Margem</th></tr></thead>
          <tbody>${top.map((p) => `<tr data-produto='${esc(JSON.stringify({ id: p.produto_id, modelo: p.modelo, linha: p.linha }))}' title="Ver só esta bateria"><td><strong class="modelo-p">${esc(p.modelo)}</strong></td><td class="texto-medio">${esc(linhaCurta(p.linha))}</td>
            <td class="num">${p.quantidade}</td><td class="num">${dinheiroInteiro(p.faturamento)}</td>
            <td class="num verde forte">${dinheiroInteiro(p.lucro_bruto)}</td><td class="num">${percentual(p.margem_pct)}</td></tr>`).join('')}</tbody>
        </table>
      </div>`}`;
  }

  function desenharDistribuicao(formas, atend, linhas) {
    $('#distribuicao', raiz).innerHTML = `
      <h2 class="cartao-h">Como pagaram</h2>
      ${barras(formas, 'barra-escura')}
      <h2 class="cartao-h sub-dist">Atendimento</h2>
      ${barras(atend, 'barra-amarela')}
      <h2 class="cartao-h sub-dist">${produto ? 'Margem da bateria' : 'Margem por linha'}</h2>
      ${linhas.length ? `<ul class="lista-simples">${linhas.map((l) => `<li><span>${esc(l.linha)}</span><strong>${percentual(l.margem_pct)}</strong></li>`).join('')}</ul>`
        : '<p class="texto-aux">Sem vendas no período.</p>'}`;
  }

  function desenharEstoque(valor, baixo, prod = null) {
    $('#parado', raiz).innerHTML = `
      <div class="texto-sub">${prod ? `Dinheiro parado em ${esc(prod.modelo)}` : 'Dinheiro parado em bateria'}</div>
      <div class="kpi-valor">${dinheiroInteiro(valor.valor_custo)}</div>
      <div class="texto-sub">${valor.unidades} ${Number(valor.unidades) === 1 ? 'unidade' : 'unidades'} · ${dinheiroInteiro(valor.valor_venda_potencial)} a preço de venda</div>`;
    if (prod) {
      $('#repor', raiz).innerHTML = `
        <h2 class="cartao-h">Estoque da ${esc(prod.modelo)}</h2>
        <ul class="lista-simples">
          <li><span>Em estoque</span><strong class="${prod.estoque_atual <= 0 ? 'vermelho' : prod.abaixo_minimo ? 'amarelo' : 'verde'}">${saldo(prod.estoque_atual)} (mín. ${prod.estoque_minimo})</strong></li>
          <li><span>Custo médio</span><strong>${Number(prod.custo_medio) > 0 ? dinheiro(prod.custo_medio) : '-'}</strong></li>
          <li><span>Preço de venda</span><strong>${prod.preco_venda ? dinheiro(prod.preco_venda) : '-'}</strong></li>
          <li><span>Margem no preço atual</span><strong>${percentual(prod.margem_pct)}</strong></li>
        </ul>
        <a class="link" href="#estoque/${encodeURIComponent(prod.modelo)}">Abrir no estoque</a>`;
      return;
    }
    $('#repor', raiz).innerHTML = `
      <h2 class="cartao-h">Repor estoque</h2>
      ${baixo.length ? `<ul class="lista-simples lista-repor-painel">${baixo.slice(0, 5).map((p) => `
        <li><a href="#entrada"><span><strong>${esc(p.modelo)}</strong> <span class="texto-aux">${esc(linhaCurta(p.linha))}</span></span>
          <strong class="${p.estoque_atual <= 0 ? 'vermelho' : 'amarelo'}">${saldo(p.estoque_atual)}${p.estoque_atual > 0 ? ` (mín. ${p.estoque_minimo})` : ''}</strong></a></li>`).join('')}
        </ul>${baixo.length > 5 ? `<a class="link" href="#estoque">+ ${baixo.length - 5} no estoque</a>` : ''}`
        : '<p class="texto-aux">Nenhuma bateria abaixo do mínimo.</p>'}`;
  }

  async function exportar() {
    const [ini, fim] = periodos(tipo, ...custom).atual;
    try {
      const itens = ok(await supabase.from('vw_venda_itens_detalhe')
        .select('venda_numero, data_hora, status, cliente_nome, marca, modelo, linha, quantidade, preco_unitario, desconto_rateado, total_item, custo_unitario, custo_total, lucro_bruto, garantia_ate')
        .gte('data_local', ini).lte('data_local', fim).match(produto ? { produto_id: produto.id } : {}).order('data_hora'));
      baixarCSV(`vendas-${produto ? `${produto.modelo}-` : ''}${ini}-a-${fim}.csv`, [
        ['Venda', 'Data', 'Hora', 'Situação', 'Cliente', 'Marca', 'Modelo', 'Linha', 'Qtd', 'Preço unitário', 'Desconto rateado', 'Total do item', 'Custo unitário', 'Custo total', 'Lucro bruto', 'Garantia até'],
        ...itens.map((i) => [i.venda_numero, new Date(i.data_hora).toLocaleDateString('pt-BR', { timeZone: FUSO }),
          new Date(i.data_hora).toLocaleTimeString('pt-BR', { timeZone: FUSO, hour: '2-digit', minute: '2-digit' }),
          i.status, i.cliente_nome, i.marca, i.modelo, i.linha, i.quantidade, Number(i.preco_unitario), Number(i.desconto_rateado),
          Number(i.total_item), Number(i.custo_unitario), Number(i.custo_total), Number(i.lucro_bruto),
          i.garantia_ate ? new Date(`${i.garantia_ate}T12:00`).toLocaleDateString('pt-BR') : '']),
      ]);
    } catch (e) {
      aviso(mensagemDeErro(e), 'erro');
    }
  }

  raiz.addEventListener('click', (e) => {
    const b = e.target.closest('[data-periodo], [data-ordenar], #exportar, [data-escolher-bateria], [data-limpar-bateria], [data-produto]');
    if (!b) return;
    if (b.id === 'exportar') return exportar();
    if (b.dataset.limparBateria !== undefined) { produto = null; carregar(); return; }
    if (b.dataset.produto) { produto = JSON.parse(b.dataset.produto); carregar(); window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    if (b.dataset.escolherBateria !== undefined) {
      escolherBateria({ titulo: 'Ver painel de uma bateria', permitirNova: false, somenteAtivos: false }).then((p) => {
        if (p) { produto = { id: p.id, modelo: p.modelo, linha: p.linha }; carregar(); }
      });
      return;
    }
    if (b.dataset.ordenar) {
      ordenarTop = b.dataset.ordenar;
      const [ini, fim] = periodos(tipo, ...custom).atual;
      supabase.rpc('painel_top_produtos', { p_inicio: ini, p_fim: fim, p_ordenar: ordenarTop, p_limite: 10 })
        .then(ok).then((top) => desenharTop(top, periodos(tipo, ...custom))).catch((err) => aviso(mensagemDeErro(err), 'erro'));
      return;
    }
    tipo = b.dataset.periodo;
    raiz.querySelectorAll('[data-periodo]').forEach((x) => x.setAttribute('aria-pressed', x.dataset.periodo === tipo));
    $('#datas-custom', raiz).hidden = tipo !== 'personalizado';
    carregar();
  });
  raiz.addEventListener('change', (e) => {
    if (e.target.id !== 'dt-ini' && e.target.id !== 'dt-fim') return;
    const ini = $('#dt-ini', raiz).value;
    const fim = $('#dt-fim', raiz).value;
    if (!ini || !fim || ini > fim) return aviso('Escolha uma data inicial antes da final.', 'erro');
    custom = [ini, fim];
    carregar();
  });

  await carregar();
  return () => grafico?.destroy();
}
