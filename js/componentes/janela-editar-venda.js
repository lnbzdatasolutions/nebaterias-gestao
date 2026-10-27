// Janela "Editar venda nº X": nota fiscal + cliente, atendimento e observação.
// Um único componente nos dois tamanhos (celular: folha cheia; notebook: janela larga).
// Itens, valores e pagamento NÃO se editam (para corrigir: cancelar e registrar de novo).
// Resolve true quando algo foi salvo.
import { supabase, ok, mensagemDeErro } from '../supabase.js';
import { abrirJanela, pedirTexto } from './janela.js';
import { abrirJanelaCliente } from './janela-novo-cliente.js';
import { analisarChave, chaveEmBlocos, NOME_MODELO } from './nota-fiscal.js';
import { icone } from '../icones.js';
import { $, esc, dinheiro, numero, valorCampo, telefone, iniciais, data, hora, hojeISO, debounce, aviso, ocupado } from '../util.js';

const ATENDIMENTOS = [['balcao', 'Balcão'], ['entrega', 'Entrega'], ['socorro', 'Socorro']];
const BUCKET = 'notas-fiscais';

export async function abrirEditarVenda(vendaId) {
  let venda;
  let nota = null;
  let cliente = null;
  try {
    venda = ok(await supabase.from('vw_vendas_lista')
      .select('id, numero, data_hora, total, status, itens_resumo, pagamentos_resumo, tipo_atendimento, local_atendimento, obs, cliente_id, nota_id, situacao_nota')
      .eq('id', vendaId).single());
    const [n, c] = await Promise.all([
      venda.nota_id ? supabase.from('notas_fiscais').select('*').eq('id', venda.nota_id).single().then(ok) : null,
      venda.cliente_id ? supabase.from('clientes').select('id, nome, telefone, veiculo, placa').eq('id', venda.cliente_id).single().then(ok) : null,
    ]);
    nota = n;
    cliente = c;
  } catch (e) {
    aviso(mensagemDeErro(e), 'erro');
    return false;
  }

  const cancelada = venda.status === 'cancelada';
  const podeNotaNova = !cancelada && !nota;
  const subtitulo = `${data(venda.data_hora)} ${hora(venda.data_hora)} · ${String(venda.itens_resumo ?? '').replace(/(\d+)x /g, '$1× ')} · ${dinheiro(venda.total)}${venda.pagamentos_resumo ? ` · ${venda.pagamentos_resumo}` : ''}`;

  const n = nota ?? {};
  const htmlNota = (cancelada && !nota) ? `
      <p class="nota">${icone('alerta', 20)}<span>Venda cancelada: não recebe nota fiscal.</span></p>` : `
      <p class="texto-aux">Emita no Tiranota e cole aqui a chave de acesso. Número, série e tipo são preenchidos sozinhos.</p>
      ${cancelada ? `<p class="msg-erro">${icone('alerta', 18)} Esta venda foi cancelada e a nota continua emitida. Cancele a nota no Tiranota e marque abaixo.</p>` : ''}
      <div class="campo">
        <label for="nf-chave">Chave de acesso (44 números)</label>
        <div class="linha-chave">
          <input id="nf-chave" inputmode="numeric" autocomplete="off" placeholder="Cole a chave aqui" value="${esc(chaveEmBlocos(n.chave))}">
          <button type="button" class="btn btn-secundario" id="nf-colar">Colar</button>
        </div>
        <p class="texto-p forte" id="nf-chave-msg" aria-live="polite"></p>
      </div>
      <div class="campo">
        <span class="rotulo-campo">Tipo</span>
        <div class="segmentos segmentos-2" role="radiogroup" aria-label="Tipo da nota">
          <button type="button" class="seg" data-modelo="65" aria-pressed="${(n.modelo ?? 65) === 65}">NFC-e</button>
          <button type="button" class="seg" data-modelo="55" aria-pressed="${n.modelo === 55}">NF-e</button>
        </div>
      </div>
      <div class="grade-2">
        <div class="campo"><label for="nf-num">Número *</label><input id="nf-num" inputmode="numeric" autocomplete="off" value="${esc(n.numero ?? '')}"></div>
        <div class="campo"><label for="nf-serie">Série</label><input id="nf-serie" inputmode="numeric" autocomplete="off" placeholder="1" value="${esc(n.serie ?? '')}"></div>
      </div>
      <div class="grade-2">
        <div class="campo"><label for="nf-data">Data de emissão</label><input id="nf-data" type="date" max="${hojeISO()}" value="${esc(n.data_emissao ?? hojeISO())}"></div>
        <div class="campo"><label for="nf-valor">Valor da nota</label><input id="nf-valor" inputmode="decimal" autocomplete="off" value="${valorCampo(n.valor ?? venda.total)}"></div>
      </div>
      <p class="texto-p vermelho forte" id="nf-valor-msg" hidden></p>
      <div class="campo">
        <label for="nf-doc">CPF/CNPJ na nota <span class="opcional">(se o cliente pediu)</span></label>
        <input id="nf-doc" autocomplete="off" autocapitalize="characters" placeholder="Só números ou letras do CNPJ" value="${esc(n.cpf_cnpj_destinatario ?? '')}">
      </div>
      <label class="btn btn-tracejado btn-anexo">${icone('anexo', 20)}<span id="nf-pdf-txt">${n.arquivo_path ? 'Trocar PDF da nota' : 'Anexar PDF da nota (opcional)'}</span>
        <input type="file" id="nf-pdf" accept="application/pdf" hidden></label>
      ${n.arquivo_path ? '<button type="button" class="link-btn" id="nf-ver-pdf">Ver PDF anexado</button>' : ''}
      ${nota ? '<button type="button" class="link-btn vermelho forte centro" id="nf-cancelar">A nota foi cancelada no Tiranota? Marcar como cancelada</button>' : ''}`;

  return abrirJanela({
    titulo: `Editar venda nº ${venda.numero}`,
    subtitulo,
    largura: 820,
    html: `
      <form class="editar-venda" novalidate>
        <div class="grade-editar">
          <section class="pilha-p">
            <div class="rotulo-linha"><h3 class="cartao-h">Nota fiscal</h3><span id="nf-estado"></span></div>
            ${htmlNota}
          </section>
          <section class="pilha-p">
            <h3 class="cartao-h">Dados da venda</h3>
            <div id="ev-cliente"></div>
            <div class="campo">
              <span class="rotulo-campo">Atendimento</span>
              <div class="segmentos segmentos-3" role="radiogroup" aria-label="Atendimento">
                ${ATENDIMENTOS.map(([v, t]) => `<button type="button" class="seg" data-atend="${v}" aria-pressed="${venda.tipo_atendimento === v}">${t}</button>`).join('')}
              </div>
              <input id="ev-local" autocomplete="off" placeholder="Bairro ou endereço" aria-label="Bairro ou endereço" value="${esc(venda.local_atendimento ?? '')}" ${venda.tipo_atendimento === 'balcao' ? 'hidden' : ''}>
            </div>
            <div class="campo">
              <label for="ev-obs">Observação</label>
              <textarea id="ev-obs" rows="3">${esc(venda.obs ?? '')}</textarea>
            </div>
            <p class="nota">${icone('cadeado', 18)}<span>Itens, valores e pagamento não se editam, para não bagunçar estoque e lucro. Para corrigir, cancele a venda e registre de novo.</span></p>
          </section>
        </div>
        <p class="msg-erro" role="alert" hidden></p>
        <div class="rodape-janela">
          <button type="button" class="btn btn-secundario" data-fechar>Cancelar</button>
          <button type="submit" class="btn btn-primario btn-grande">Salvar alterações</button>
        </div>
      </form>`,
    montar(corpo, fechar) {
      const form = $('form', corpo);
      const erro = $('.msg-erro', form);
      const mostrarErro = (t) => { erro.textContent = t; erro.hidden = !t; if (t) erro.scrollIntoView({ block: 'nearest' }); };
      const temNota = !!$('#nf-chave', corpo);
      let modelo = n.modelo ?? 65;
      let atendimento = venda.tipo_atendimento;
      let clienteAtual = cliente;
      let pdf = null;

      // ---------- nota ----------
      function lerChave() {
        const campo = $('#nf-chave', corpo);
        const msg = $('#nf-chave-msg', corpo);
        const a = analisarChave(campo.value);
        campo.classList.toggle('campo-ok', !!a.valida);
        campo.classList.toggle('campo-erro', !!a.erro);
        if (a.valida) {
          modelo = a.modelo;
          corpo.querySelectorAll('[data-modelo]').forEach((b) => b.setAttribute('aria-pressed', Number(b.dataset.modelo) === modelo));
          $('#nf-num', corpo).value = a.numero;
          $('#nf-serie', corpo).value = a.serie;
          ['#nf-num', '#nf-serie'].forEach((s) => $(s, corpo).classList.add('auto'));
          msg.className = 'texto-p forte verde';
          msg.innerHTML = `${icone('check', 16, 2.6)} Chave confere · ${NOME_MODELO[a.modelo]} nº ${a.numero} · série ${a.serie} · ${a.mesAno}`;
        } else {
          ['#nf-num', '#nf-serie'].forEach((s) => $(s, corpo).classList.remove('auto'));
          msg.className = 'texto-p forte vermelho';
          msg.textContent = a.erro ?? '';
        }
        estado();
        return a;
      }

      function estado() {
        const el = $('#nf-estado', corpo);
        if (!temNota) { el.innerHTML = ''; return; }
        const a = analisarChave($('#nf-chave', corpo).value);
        const numeroOk = Number($('#nf-num', corpo).value) > 0;
        if (cancelada) el.innerHTML = '<span class="selo selo-perigo">Cancelar nota</span>';
        else if (a.erro) el.innerHTML = '<span class="selo selo-perigo">Chave com erro</span>';
        else if (numeroOk) el.innerHTML = `<span class="selo selo-ok">${nota ? 'Nota registrada' : 'Pronta para salvar'}</span>`;
        else el.innerHTML = '<span class="selo selo-alerta">Pendente</span>';
        const v = $('#nf-valor', corpo);
        const msg = $('#nf-valor-msg', corpo);
        const dif = v.value.trim() && Math.abs(numero(v.value) - Number(venda.total)) > 0.004;
        msg.hidden = !dif;
        msg.textContent = dif ? `Valor diferente do total da venda (${dinheiro(venda.total)}).` : '';
      }

      if (temNota) {
        const chave = $('#nf-chave', corpo);
        chave.addEventListener('input', debounce(() => {
          const pos = chave.value.replace(/\D/g, '');
          chave.value = chaveEmBlocos(pos.slice(0, 44));
          lerChave();
        }, 150));
        $('#nf-colar', corpo).addEventListener('click', async () => {
          try {
            const texto = await navigator.clipboard.readText();
            chave.value = chaveEmBlocos(texto.replace(/\D/g, '').slice(0, 44));
            lerChave();
          } catch {
            chave.focus();
            aviso('Não foi possível ler a área de transferência. Toque no campo e cole.', 'erro');
          }
        });
        corpo.querySelectorAll('[data-modelo]').forEach((b) => b.addEventListener('click', () => {
          modelo = Number(b.dataset.modelo);
          corpo.querySelectorAll('[data-modelo]').forEach((x) => x.setAttribute('aria-pressed', x === b));
        }));
        ['#nf-num', '#nf-valor'].forEach((s) => $(s, corpo).addEventListener('input', (e) => { e.target.classList.remove('auto'); estado(); }));
        $('#nf-pdf', corpo).addEventListener('change', (e) => {
          pdf = e.target.files[0] ?? null;
          $('#nf-pdf-txt', corpo).textContent = pdf ? `PDF: ${pdf.name}` : 'Anexar PDF da nota (opcional)';
        });
        $('#nf-ver-pdf', corpo)?.addEventListener('click', async () => {
          const { data: link, error } = await supabase.storage.from(BUCKET).createSignedUrl(n.arquivo_path, 120);
          if (error) return aviso(mensagemDeErro(error), 'erro');
          window.open(link.signedUrl, '_blank', 'noopener');
        });
        $('#nf-cancelar', corpo)?.addEventListener('click', async () => {
          const motivo = await pedirTexto({ titulo: 'Marcar nota como cancelada', rotulo: 'Motivo (ex.: venda cancelada, nota com erro)', sim: 'Marcar como cancelada', perigo: true });
          if (!motivo) return;
          try {
            ok(await supabase.from('notas_fiscais').update({ situacao: 'cancelada', motivo_cancelamento: motivo }).eq('id', nota.id));
            aviso('Nota marcada como cancelada.', 'ok');
            fechar(true);
          } catch (err) {
            mostrarErro(mensagemDeErro(err));
          }
        });
        if (n.chave) lerChave(); else estado();
      }

      // ---------- cliente ----------
      function desenharCliente(buscando = false) {
        const el = $('#ev-cliente', corpo);
        const c = clienteAtual;
        el.innerHTML = `
          <div class="rotulo-linha"><span class="rotulo-campo">Cliente</span>
            ${buscando ? '<button type="button" class="link-btn link-forte" data-novo-cli>+ Novo cliente</button>'
              : `<button type="button" class="link-btn link-forte" data-trocar>${c ? 'Trocar' : 'Escolher'}</button>`}</div>
          ${buscando ? `
            <label class="busca">${icone('busca', 20)}<input type="search" id="ev-busca-cli" placeholder="Nome, telefone ou placa" autocomplete="off" aria-label="Buscar cliente"></label>
            <ul class="linhas resultados-cliente" id="ev-res-cli"></ul>
            ${c ? '<button type="button" class="link-btn vermelho" data-tirar>Tirar cliente da venda</button>' : ''}`
          : c ? `
            <div class="cliente-escolhido">
              <span class="avatar">${esc(iniciais(c.nome))}</span>
              <div class="min0"><strong>${esc(c.nome)}</strong>
                <div class="texto-aux">${[telefone(c.telefone), c.veiculo, c.placa].filter(Boolean).map(esc).join(' · ')}</div></div>
            </div>` : '<p class="texto-aux">Venda sem cliente.</p>'}`;
        const busca = $('#ev-busca-cli', el);
        if (!busca) return;
        busca.focus();
        busca.addEventListener('input', debounce(async () => {
          const t = busca.value.trim();
          const ul = $('#ev-res-cli', el);
          if (!t) { ul.innerHTML = ''; return; }
          try {
            const lista = ok(await supabase.rpc('buscar_clientes', { p_termo: t, p_limite: 6 }));
            ul.innerHTML = lista.length ? lista.map((cl) => `
              <li><button type="button" class="linha-botao" data-cli='${esc(JSON.stringify(cl))}'>
                <span class="avatar avatar-p">${esc(iniciais(cl.nome))}</span>
                <span class="min0"><strong class="d-bloco">${esc(cl.nome)}</strong>
                  <span class="texto-aux d-bloco elipse">${[telefone(cl.telefone), cl.veiculo, cl.placa].filter(Boolean).map(esc).join(' · ')}</span></span>
              </button></li>`).join('') : '<li class="texto-aux pad-v">Nenhum cliente encontrado.</li>';
          } catch (err) {
            ul.innerHTML = `<li class="msg-erro">${esc(mensagemDeErro(err))}</li>`;
          }
        }));
      }

      corpo.addEventListener('click', async (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        if (b.dataset.trocar !== undefined) desenharCliente(true);
        else if (b.dataset.cli) { clienteAtual = JSON.parse(b.dataset.cli); desenharCliente(); }
        else if (b.dataset.tirar !== undefined) { clienteAtual = null; desenharCliente(); }
        else if (b.dataset.novoCli !== undefined) {
          const novo = await abrirJanelaCliente({ textoBotao: 'Salvar e usar nesta venda' });
          if (novo) { clienteAtual = novo; desenharCliente(); }
        } else if (b.dataset.atend) {
          atendimento = b.dataset.atend;
          corpo.querySelectorAll('[data-atend]').forEach((x) => x.setAttribute('aria-pressed', x === b));
          $('#ev-local', corpo).hidden = atendimento === 'balcao';
          if (atendimento !== 'balcao') $('#ev-local', corpo).focus();
        } else if (b.dataset.fechar !== undefined) fechar(false);
      });
      desenharCliente();

      // ---------- salvar ----------
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        mostrarErro('');
        const local = $('#ev-local', corpo).value.trim();
        if (atendimento !== 'balcao' && !local) return mostrarErro('Informe o bairro ou endereço da entrega/socorro.');

        // dados da venda (só o que mudou)
        const mudancas = {};
        if ((clienteAtual?.id ?? null) !== (venda.cliente_id ?? null)) mudancas.cliente_id = clienteAtual?.id ?? null;
        if (atendimento !== venda.tipo_atendimento) mudancas.tipo_atendimento = atendimento;
        const localFinal = atendimento === 'balcao' ? null : local;
        if ((localFinal || null) !== (venda.local_atendimento || null)) mudancas.local_atendimento = localFinal;
        const obs = $('#ev-obs', corpo).value.trim();
        if ((obs || null) !== (venda.obs || null)) mudancas.obs = obs || null;

        // nota
        let dadosNota = null;
        if (temNota && !(cancelada && nota)) {
          const a = analisarChave($('#nf-chave', corpo).value);
          if (a.erro) return mostrarErro(a.erro);
          const num = parseInt($('#nf-num', corpo).value, 10) || null;
          const serieTxt = $('#nf-serie', corpo).value.trim();
          const preenchida = a.valida || num;
          if (preenchida) {
            if (!num) return mostrarErro('Informe o número da nota.');
            const d = $('#nf-data', corpo).value;
            if (d > hojeISO()) return mostrarErro('A data de emissão não pode ser futura.');
            dadosNota = {
              chave: a.valida ? a.digitos : null,
              modelo,
              serie: serieTxt === '' ? 1 : parseInt(serieTxt, 10),
              numero: num,
              data_emissao: d || hojeISO(),
              valor: $('#nf-valor', corpo).value.trim() ? numero($('#nf-valor', corpo).value) : Number(venda.total),
              cpf_cnpj_destinatario: $('#nf-doc', corpo).value.trim() || null,
            };
          } else if (nota) {
            return mostrarErro('Para tirar a nota, use "Marcar como cancelada".');
          }
        }

        if (!Object.keys(mudancas).length && !dadosNota && !pdf) return fechar(false);

        await ocupado($('button[type=submit]', form), async () => {
          try {
            if (Object.keys(mudancas).length) {
              ok(await supabase.rpc('atualizar_venda', { p_venda_id: venda.id, p: mudancas }));
            }
            let notaId = nota?.id ?? null;
            if (dadosNota) {
              if (nota) {
                const alterado = Object.fromEntries(Object.entries(dadosNota).filter(([k, v]) => String(v ?? '') !== String(nota[k] ?? '')));
                if (Object.keys(alterado).length) ok(await supabase.from('notas_fiscais').update(alterado).eq('id', nota.id));
              } else if (podeNotaNova) {
                notaId = ok(await supabase.from('notas_fiscais').insert({ venda_id: venda.id, ...dadosNota }).select('id').single()).id;
              }
            }
            if (pdf && notaId) {
              const caminho = `${new Date().getFullYear()}/${venda.numero}-${dadosNota?.numero ?? nota?.numero}.pdf`;
              const up = await supabase.storage.from(BUCKET).upload(caminho, pdf, { upsert: true, contentType: 'application/pdf' });
              if (up.error) aviso(`Nota salva, mas o PDF não foi enviado: ${mensagemDeErro(up.error)}`, 'erro');
              else ok(await supabase.from('notas_fiscais').update({ arquivo_path: caminho }).eq('id', notaId));
            } else if (pdf) {
              aviso('Informe a nota antes de anexar o PDF.', 'erro');
            }
            aviso('Venda atualizada.', 'ok');
            fechar(true);
          } catch (err) {
            mostrarErro(err?.code === '23505'
              ? (/numero/.test(err.message) ? 'Já existe outra nota com este número e série.' : /chave/.test(err.message) ? 'Esta chave já foi usada em outra venda.' : 'Esta venda já tem nota; cancele a anterior antes.')
              : mensagemDeErro(err));
          }
        });
      });
    },
  }).then((r) => r === true);
}
