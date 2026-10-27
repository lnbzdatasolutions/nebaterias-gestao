// Janela "Novo cliente" (e edição de cliente). Usada na venda e na tela Clientes.
// Resolve com o cliente salvo ({ id, nome, telefone, veiculo, placa, ... }) ou null.
import { supabase, ok, mensagemDeErro } from '../supabase.js';
import { abrirJanela, confirmar } from './janela.js';
import { icone } from '../icones.js';
import { $, esc, telefone, ocupado } from '../util.js';

const CAMPOS = 'id, nome, telefone, cpf_cnpj, veiculo, placa, obs';

export function abrirJanelaCliente({ cliente = null, textoBotao = 'Salvar cliente', nomeInicial = '' } = {}) {
  const c = cliente ?? {};
  return abrirJanela({
    titulo: cliente ? 'Editar cliente' : 'Novo cliente',
    subtitulo: 'Só o nome é obrigatório',
    html: `
      <form class="form" novalidate>
        <div class="campo">
          <label for="cl-nome">Nome *</label>
          <input id="cl-nome" name="nome" autocomplete="off" autocapitalize="words" required autofocus value="${esc(c.nome ?? nomeInicial)}">
        </div>
        <div class="campo">
          <label for="cl-tel">Telefone / WhatsApp</label>
          <input id="cl-tel" name="telefone" type="tel" inputmode="tel" autocomplete="off" placeholder="(85) 99999-1234" value="${esc(telefone(c.telefone))}">
        </div>
        <div class="grade-2">
          <div class="campo">
            <label for="cl-veic">Veículo</label>
            <input id="cl-veic" name="veiculo" autocomplete="off" placeholder="Onix 2019" value="${esc(c.veiculo ?? '')}">
          </div>
          <div class="campo">
            <label for="cl-placa">Placa</label>
            <input id="cl-placa" name="placa" autocomplete="off" autocapitalize="characters" placeholder="ABC1D23" value="${esc(c.placa ?? '')}">
          </div>
        </div>
        <div class="campo">
          <label for="cl-doc">CPF ou CNPJ <span class="opcional">(opcional)</span></label>
          <input id="cl-doc" name="cpf_cnpj" inputmode="numeric" autocomplete="off" placeholder="Só se o cliente pedir" value="${esc(c.cpf_cnpj ?? '')}">
        </div>
        ${cliente ? `
        <div class="campo">
          <label for="cl-obs">Observações</label>
          <input id="cl-obs" name="obs" autocomplete="off" value="${esc(c.obs ?? '')}">
        </div>` : ''}
        <p class="nota nota-alerta">${icone('alerta', 20)}<span>Se já existir cliente com este telefone, o sistema avisa antes de salvar.</span></p>
        <p class="msg-erro" role="alert" hidden></p>
        <button class="btn btn-primario btn-grande" type="submit">${esc(textoBotao)}</button>
      </form>`,
    montar(corpo, fechar) {
      const form = $('form', corpo);
      const erro = $('.msg-erro', corpo);
      const mostrarErro = (t) => { erro.textContent = t; erro.hidden = !t; };

      form.placa.addEventListener('input', () => {
        form.placa.value = form.placa.value.toUpperCase();
      });

      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const dados = {
          nome: form.nome.value.trim(),
          telefone: form.telefone.value.replace(/\D/g, '') || null,
          veiculo: form.veiculo.value.trim() || null,
          placa: form.placa.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase() || null,
          cpf_cnpj: form.cpf_cnpj.value.replace(/\D/g, '') || null,
        };
        if (form.obs) dados.obs = form.obs.value.trim() || null;
        if (!dados.nome) return mostrarErro('Informe o nome do cliente.');
        if (dados.telefone && dados.telefone.length < 10) return mostrarErro('Telefone incompleto: use DDD + número.');
        mostrarErro('');

        await ocupado($('button[type=submit]', form), async () => {
          try {
            if (dados.telefone) {
              let q = supabase.from('clientes').select('id, nome').eq('telefone', dados.telefone).limit(1);
              if (cliente) q = q.neq('id', cliente.id);
              const [existe] = ok(await q);
              if (existe && !(await confirmar({
                titulo: 'Telefone já cadastrado',
                texto: `${existe.nome} já usa este telefone. Salvar mesmo assim?`,
                sim: 'Salvar mesmo assim',
              }))) return;
            }
            const consulta = cliente
              ? supabase.from('clientes').update(dados).eq('id', cliente.id)
              : supabase.from('clientes').insert(dados);
            fechar(ok(await consulta.select(CAMPOS).single()));
          } catch (err) {
            mostrarErro(mensagemDeErro(err));
          }
        });
      });
    },
  });
}
