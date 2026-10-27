// Formatação e pequenos utilitários usados por todas as telas.

export const FUSO = 'America/Fortaleza';

const fmtDinheiro = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtNumero = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });

/** R$ 1.234,56 */
export function dinheiro(valor) {
  return fmtDinheiro.format(Number(valor) || 0).replace(/ /g, ' ');
}

/** 37,8% (ou — quando não há valor) */
export function percentual(valor) {
  if (valor === null || valor === undefined) return '—';
  return fmtNumero.format(Number(valor)) + '%';
}

/** '2026-10-27' no fuso da loja */
export function hojeISO() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: FUSO });
}

/** dd/mm/aaaa */
export function data(valor) {
  return new Date(valor).toLocaleDateString('pt-BR', { timeZone: FUSO });
}

/** 14:32 */
export function hora(valor) {
  return new Date(valor).toLocaleTimeString('pt-BR', { timeZone: FUSO, hour: '2-digit', minute: '2-digit' });
}

/** "14:32" se for hoje, "ontem" ou "dd/mm" */
export function quando(valor) {
  const dia = new Date(valor).toLocaleDateString('sv-SE', { timeZone: FUSO });
  const hoje = hojeISO();
  if (dia === hoje) return hora(valor);
  const ontem = new Date(Date.now() - 864e5).toLocaleDateString('sv-SE', { timeZone: FUSO });
  if (dia === ontem) return 'ontem';
  return new Date(valor).toLocaleDateString('pt-BR', { timeZone: FUSO, day: '2-digit', month: '2-digit' });
}

/** "Terça, 27 de outubro" */
export function dataPorExtenso(comAno = false) {
  const txt = new Date().toLocaleDateString('pt-BR', {
    timeZone: FUSO, weekday: 'long', day: 'numeric', month: 'long', ...(comAno && { year: 'numeric' }),
  }).replace('-feira', '');
  return txt.charAt(0).toUpperCase() + txt.slice(1);
}

/** "outubro" */
export function nomeDoMes() {
  return new Date().toLocaleDateString('pt-BR', { timeZone: FUSO, month: 'long' });
}

/** Bom dia / Boa tarde / Boa noite, no horário da loja */
export function saudacao() {
  const h = Number(new Date().toLocaleString('pt-BR', { timeZone: FUSO, hour: '2-digit', hour12: false }));
  return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
}

/** Escapa texto vindo do banco antes de ir para innerHTML */
export function esc(texto) {
  return String(texto ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

/** Atalho para document.querySelector dentro de um elemento */
export const $ = (seletor, raiz = document) => raiz.querySelector(seletor);

/** Mensagem curta no rodapé da tela */
export function aviso(texto, tipo = 'info') {
  const el = document.createElement('div');
  el.className = `toast toast-${tipo}`;
  el.setAttribute('role', 'status');
  el.textContent = texto;
  document.body.append(el);
  setTimeout(() => el.remove(), 4000);
}
