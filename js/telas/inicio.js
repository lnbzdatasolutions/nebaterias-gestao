// Início (#inicio): cartões do dia e do mês, atalhos, estoque baixo e últimas vendas.
import { supabase, ok, mensagemDeErro } from '../supabase.js';
import { icone } from '../icones.js';
import { $, esc, dinheiro, percentual, hojeISO, quando, dataPorExtenso, nomeDoMes, saudacao } from '../util.js';

const ATENDIMENTO = { balcao: 'Balcão', entrega: 'Entrega', socorro: 'Socorro' };

/** Mesmo intervalo de dias no mês anterior (1º até o mesmo dia, limitado ao fim do mês). */
function periodoMesAnterior(hoje) {
  const [a, m, d] = hoje.split('-').map(Number);
  const ultimoDia = new Date(Date.UTC(a, m - 1, 0)).getUTCDate();
  const ano = m === 1 ? a - 1 : a;
  const mes = String(m === 1 ? 12 : m - 1).padStart(2, '0');
  return { inicio: `${ano}-${mes}-01`, fim: `${ano}-${mes}-${String(Math.min(d, ultimoDia)).padStart(2, '0')}` };
}

function variacao(atual, anterior) {
  if (!anterior) return null;
  return ((atual - anterior) / anterior) * 100;
}

const nomeMesAnterior = () => {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return d.toLocaleDateString('pt-BR', { month: 'long' });
};

export async function render(raiz) {
  const hoje = hojeISO();
  const inicioDoMes = hoje.slice(0, 8) + '01';
  const anterior = periodoMesAnterior(hoje);

  raiz.innerHTML = `
    <header class="cabecalho cabecalho-inicio">
      <div class="so-celular marca-topo">
        <span class="logo logo-p">${icone('bateria', 24)}</span>
        <div><div class="marca-nome">N E Baterias</div><div class="texto-aux">${dataPorExtenso()}</div></div>
      </div>
      <a href="#mais" class="btn-icone btn-borda so-celular" aria-label="Mais opções: clientes, produtos, configurações">${icone('menu')}</a>
      <div class="so-notebook">
        <h1 class="titulo">${saudacao()}</h1>
        <div class="texto-aux">${dataPorExtenso(true)}</div>
      </div>
      <div class="acoes-topo so-notebook">
        <a href="#entrada" class="btn btn-secundario">${icone('download', 20)}Nova entrada</a>
        <a href="#vender" class="btn btn-primario">${icone('mais', 20, 2.4)}Nova venda</a>
      </div>
    </header>

    <a href="#vendas/sem-nota" id="aviso-notas-nb" class="aviso-notas so-notebook" hidden></a>

    <section class="cartoes-resumo" aria-label="Resumo">
      <div class="cartao kpi"><div class="kpi-rotulo">Vendas hoje</div><div class="kpi-valor" id="k-vendas">-</div><div class="kpi-sub" id="k-vendas-sub">&nbsp;</div></div>
      <div class="cartao kpi"><div class="kpi-rotulo">Lucro hoje</div><div class="kpi-valor verde" id="k-lucro">-</div><div class="kpi-sub" id="k-lucro-sub">&nbsp;</div></div>
      <div class="cartao kpi kpi-escuro">
        <div><div class="kpi-rotulo">Faturamento de ${nomeDoMes()}</div><div class="kpi-valor" id="k-mes">-</div></div>
        <div class="kpi-var"><div class="kpi-rotulo">vs. ${nomeMesAnterior()}</div><div id="k-mes-var">&nbsp;</div></div>
      </div>
      <div class="cartao kpi so-notebook"><div class="kpi-rotulo">Valor em estoque</div><div class="kpi-valor" id="k-estoque">-</div><div class="kpi-sub" id="k-estoque-sub">&nbsp;</div></div>
    </section>

    <a href="#vender" class="btn btn-primario btn-nova-venda so-celular">${icone('mais', 26, 2.4)}Nova venda</a>
    <div class="atalhos so-celular">
      <a href="#estoque" class="cartao atalho">${icone('busca', 24)}<span>Consultar estoque</span></a>
      <a href="#entrada" class="cartao atalho">${icone('entrada', 24)}<span>Nova entrada</span></a>
    </div>
    <a href="#vendas/sem-nota" id="aviso-notas-cel" class="aviso-notas so-celular" hidden></a>

    <div class="grade-inicio">
      <section class="cartao ultimas" aria-labelledby="t-ultimas">
        <div class="cartao-cabeca">
          <h2 id="t-ultimas">Últimas vendas</h2>
          <a href="#vendas" class="link-forte"><span class="so-celular">Histórico</span><span class="so-notebook">Ver todas</span></a>
        </div>
        <div id="lista-vendas"><p class="texto-aux">Carregando…</p></div>
      </section>

      <div class="pilha">
        <section class="cartao so-notebook">
          <h2 class="cartao-h">Consulta rápida de estoque</h2>
          <form id="busca-rapida" class="busca">
            ${icone('busca', 20)}
            <input type="search" name="termo" placeholder="Modelo ou carro (ex.: Hilux)" aria-label="Buscar bateria por modelo ou carro">
          </form>
          <a href="#estoque" class="link">Abrir estoque completo</a>
        </section>
        <section id="estoque-baixo" class="alerta" hidden aria-label="Estoque baixo"></section>
      </div>
    </div>`;

  mostrarAvisoNotas(raiz);

  $('#busca-rapida', raiz).addEventListener('submit', (e) => {
    e.preventDefault();
    const termo = e.target.termo.value.trim();
    location.hash = termo ? `estoque/${encodeURIComponent(termo)}` : 'estoque';
  });

  try {
    const [dia, mes, mesAnt, baixo, ultimas, valor] = await Promise.all([
      supabase.rpc('painel_indicadores', { p_inicio: hoje, p_fim: hoje }).single().then(ok),
      supabase.rpc('painel_indicadores', { p_inicio: inicioDoMes, p_fim: hoje }).single().then(ok),
      supabase.rpc('painel_indicadores', { p_inicio: anterior.inicio, p_fim: anterior.fim }).single().then(ok),
      supabase.from('vw_estoque_baixo').select('id, modelo, linha, estoque_atual, estoque_minimo').then(ok),
      supabase.from('vw_vendas_lista')
        .select('id, numero, data_hora, cliente_nome, total, status, itens_resumo, pagamentos_resumo, tipo_atendimento')
        .order('data_hora', { ascending: false }).limit(5).then(ok),
      supabase.from('vw_valor_estoque').select('unidades, valor_custo').single().then(ok),
    ]);

    const n = Number(dia.qtd_vendas);
    $('#k-vendas', raiz).textContent = dinheiro(dia.faturamento);
    $('#k-vendas-sub', raiz).textContent =
      `${n} ${n === 1 ? 'venda' : 'vendas'} · ${dia.qtd_baterias} ${Number(dia.qtd_baterias) === 1 ? 'bateria' : 'baterias'}`;
    $('#k-lucro', raiz).textContent = dinheiro(dia.lucro_bruto);
    $('#k-lucro-sub', raiz).textContent = `Margem ${percentual(dia.margem_pct)}`;
    $('#k-mes', raiz).textContent = dinheiro(mes.faturamento);
    const v = variacao(Number(mes.faturamento), Number(mesAnt.faturamento));
    const elVar = $('#k-mes-var', raiz);
    if (v === null) { elVar.className = 'neutro'; elVar.textContent = '-'; }
    else {
      elVar.className = v >= 0 ? 'sobe' : 'desce';
      elVar.textContent = `${v >= 0 ? '▲' : '▼'} ${percentual(Math.abs(Math.round(v)))}`;
    }
    $('#k-estoque', raiz).textContent = dinheiro(valor.valor_custo);
    $('#k-estoque-sub', raiz).textContent = `${valor.unidades} baterias a preço de custo`;

    mostrarEstoqueBaixo($('#estoque-baixo', raiz), baixo);
    mostrarUltimas($('#lista-vendas', raiz), ultimas);
  } catch (erro) {
    console.error(erro);
    $('#lista-vendas', raiz).innerHTML = `<p class="msg-erro">Não foi possível carregar os dados: ${esc(mensagemDeErro(erro))}</p>`;
  }
}

/** Aviso de vendas sem nota fiscal e de notas para cancelar no Tiranota (migração 002). */
async function mostrarAvisoNotas(raiz) {
  const { data: r, error } = await supabase.from('vw_resumo_notas').select('*').maybeSingle();
  if (error || !r) return; // sem a migração 002 o Início continua funcionando
  const semNota = Number(r.vendas_sem_nota);
  const cancelar = Number(r.notas_para_cancelar);
  if (!semNota && !cancelar) return;
  const plural = (n, s, p) => `${n} ${n === 1 ? s : p}`;
  const cel = $('#aviso-notas-cel', raiz);
  cel.hidden = false;
  cel.innerHTML = `${icone('documento', 28)}
    <span class="min0">
      <strong class="d-bloco">${semNota ? `${plural(semNota, 'venda', 'vendas')} sem nota fiscal` : `${plural(cancelar, 'nota', 'notas')} para cancelar`}</strong>
      <span class="texto-aux">${semNota ? `${dinheiro(r.valor_sem_nota)} · toque para informar` : 'cancele no Tiranota e marque no sistema'}</span>
    </span>${icone('seta', 22)}`;
  if (!semNota) cel.href = '#vendas';
  const nb = $('#aviso-notas-nb', raiz);
  nb.hidden = false;
  if (!semNota) nb.href = '#vendas';
  const partes = [
    semNota ? `<strong>${plural(semNota, 'venda', 'vendas')} sem nota fiscal</strong> (${dinheiro(r.valor_sem_nota)})` : '',
    cancelar ? `<strong>${plural(cancelar, 'nota', 'notas')} para cancelar</strong> no Tiranota` : '',
  ].filter(Boolean).join(' e ');
  nb.innerHTML = `${icone('documento', 22)}<span class="min0">${partes}</span><span class="link-alerta">Resolver no histórico →</span>`;
}

function corSaldo(p) {
  return p.estoque_atual <= 0 ? 'vermelho' : 'amarelo';
}

function mostrarEstoqueBaixo(el, baixo) {
  if (!baixo.length) return;
  const qtd = baixo.length;
  el.hidden = false;
  el.innerHTML = `
    <div class="cartao-cabeca">
      <strong class="so-celular">${qtd} ${qtd === 1 ? 'bateria' : 'baterias'} no mínimo ou abaixo</strong>
      <strong class="so-notebook">Repor estoque</strong>
      <a href="#entrada" class="link-alerta so-celular">Ver</a>
    </div>
    <div class="chips so-celular">
      ${baixo.map((p) => `<span class="chip-alerta">${esc(p.modelo)} · <strong class="${corSaldo(p)}">${fmtSaldo(p.estoque_atual)}</strong></span>`).join('')}
    </div>
    <ul class="lista-repor so-notebook">
      ${baixo.map((p) => `<li><a href="#entrada"><span><strong>${esc(p.modelo)}</strong> ${esc(linhaCurta(p.linha))}</span>
        <strong class="${corSaldo(p)}">${fmtSaldo(p.estoque_atual)}</strong></a></li>`).join('')}
    </ul>`;
}

const fmtSaldo = (n) => (n < 0 ? `-${Math.abs(n)}` : String(n));
const linhaCurta = (linha) => String(linha ?? '').replace(/^Moura\s+(Log\s+)?/i, '');
const itens = (txt) => esc(String(txt ?? '').replace(/(\d+)x /g, '$1× '));

function mostrarUltimas(el, vendas) {
  if (!vendas.length) {
    el.innerHTML = '<p class="texto-aux vazio-lista">Nenhuma venda registrada ainda.</p>';
    return;
  }
  const situacao = (v) => (v.status === 'cancelada'
    ? '<span class="vermelho">Cancelada</span>' : '<span class="verde">Concluída</span>');
  const detalhe = (v) => [v.pagamentos_resumo, ATENDIMENTO[v.tipo_atendimento]].filter(Boolean).map(esc).join(' · ');

  el.innerHTML = `
    <ul class="lista-vendas so-celular">
      ${vendas.map((v) => `
        <li class="${v.status === 'cancelada' ? 'cancelada' : ''}">
          <a href="#vendas/${v.id}">
            <div class="min0">
              <div class="item-titulo riscavel">${itens(v.itens_resumo)}</div>
              <div class="texto-aux">Nº ${v.numero} · ${quando(v.data_hora)} · ${v.cliente_nome ? esc(v.cliente_nome) : detalhe(v)}</div>
            </div>
            <div class="direita">
              <div class="item-titulo riscavel">${dinheiro(v.total)}</div>
              <div class="situacao">${situacao(v)}</div>
            </div>
          </a>
        </li>`).join('')}
    </ul>
    <div class="tabela-rolagem so-notebook">
      <table class="tabela">
        <thead><tr><th>Nº</th><th>Hora</th><th>Baterias</th><th>Pagamento · atendimento</th><th class="num">Total</th><th class="num">Situação</th></tr></thead>
        <tbody>
          ${vendas.map((v) => `
            <tr class="${v.status === 'cancelada' ? 'cancelada' : ''}" data-href="#vendas/${v.id}">
              <td><strong>#${v.numero}</strong></td>
              <td class="texto-aux">${quando(v.data_hora)}</td>
              <td>${itens(v.itens_resumo)}</td>
              <td class="texto-medio">${detalhe(v)}</td>
              <td class="num"><strong class="riscavel">${dinheiro(v.total)}</strong></td>
              <td class="num situacao">${situacao(v)}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
  el.querySelectorAll('tr[data-href]').forEach((tr) => tr.addEventListener('click', () => { location.hash = tr.dataset.href; }));
}
