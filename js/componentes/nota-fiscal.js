// Nota fiscal na venda: leitura da chave de acesso e selos de situação.
// O sistema não emite nota (a loja emite no Tiranota); só guarda a referência.
import { esc } from '../util.js';

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
export const NOME_MODELO = { 55: 'NF-e', 65: 'NFC-e' };

/** Mesmo cálculo do banco (fn_chave_nfe_valida): 44 dígitos e dígito verificador módulo 11. */
export function chaveValida(chave) {
  if (!/^\d{44}$/.test(chave)) return false;
  let soma = 0;
  let peso = 2;
  for (let i = 42; i >= 0; i--) {
    soma += Number(chave[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  let dv = 11 - (soma % 11);
  if (dv >= 10) dv = 0;
  return dv === Number(chave[43]);
}

/**
 * Lê a chave colada (com ou sem espaços) e devolve o que dá para preencher.
 * { digitos, completa, valida, modelo, serie, numero, mesAno, erro }
 */
export function analisarChave(texto) {
  const digitos = String(texto ?? '').replace(/\D/g, '');
  const r = { digitos, completa: digitos.length === 44 };
  if (!digitos) return r;
  if (!r.completa) return { ...r, erro: `A chave tem ${digitos.length} números; precisa ter 44` };
  r.valida = chaveValida(digitos);
  if (!r.valida) return { ...r, erro: 'Chave inválida: confira se foi colada inteira' };
  r.modelo = Number(digitos.slice(20, 22));
  if (![55, 65].includes(r.modelo)) return { ...r, valida: false, erro: `A chave não é de NF-e nem de NFC-e (modelo ${r.modelo})` };
  r.serie = Number(digitos.slice(22, 25));
  r.numero = Number(digitos.slice(25, 34));
  const mes = Number(digitos.slice(4, 6));
  r.mesAno = `${MESES[mes - 1] ?? '?'}/20${digitos.slice(2, 4)}`;
  return r;
}

/** "2326 1012 3456 …" para mostrar a chave em blocos de 4 */
export const chaveEmBlocos = (chave) => String(chave ?? '').replace(/(\d{4})(?=\d)/g, '$1 ');

/** "NFC-e 129" */
export function rotuloNota(modelo, numero) {
  return `${NOME_MODELO[modelo] ?? 'Nota'} ${numero}`;
}

/** Selo da situação da nota numa linha de vw_vendas_lista. */
export function seloNota(v) {
  switch (v.situacao_nota) {
    case 'pendente': return '<span class="selo selo-alerta">Sem nota</span>';
    case 'emitida': return `<span class="selo selo-ok">${esc(rotuloNota(v.nota_modelo, v.nota_numero))}</span>`;
    case 'cancelar_nota': return '<span class="selo selo-perigo">Cancelar nota</span>';
    default: return '';
  }
}
