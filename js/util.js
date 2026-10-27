// Formatação e pequenos utilitários usados por todas as telas.

export const FUSO = 'America/Fortaleza';

const fmtDinheiro = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtNumero = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });

/** R$ 1.234,56 */
export function dinheiro(valor) {
  return fmtDinheiro.format(Number(valor) || 0).replace(/ /g, ' ');
}

/** 37,8% (ou - quando não há valor) */
export function percentual(valor) {
  if (valor === null || valor === undefined) return '-';
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

/** Lê um valor digitado ("1.234,56", "R$ 450", "450.5") como número. */
export function numero(texto) {
  if (typeof texto === 'number') return texto;
  let s = String(texto ?? '').replace(/[^\d,.-]/g, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

/** 450 → "450,00" (para preencher campos de valor) */
export function valorCampo(n) {
  if (n === null || n === undefined || n === '') return '';
  return Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Arredonda em centavos */
export const centavos = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/** 85999991234 → (85) 99999-1234 */
export function telefone(digitos) {
  const d = String(digitos ?? '').replace(/\D/g, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return d;
}

/** "João da Silva" → "JS" */
export function iniciais(nome) {
  const partes = String(nome ?? '').trim().split(/\s+/).filter((p) => p.length > 2 || /^[A-Z]/.test(p));
  const ini = (partes[0]?.[0] ?? '') + (partes.length > 1 ? partes[partes.length - 1][0] : '');
  return ini.toUpperCase() || '?';
}

/** Categoria do filtro de Estoque a partir da linha ("Moura Log Diesel" → "Diesel") */
export function categoria(linha) {
  const l = String(linha ?? '').toLowerCase();
  if (l.includes('moto')) return 'Moto';
  if (l.includes('efb')) return 'EFB';
  if (l.includes('agm')) return 'AGM';
  if (l.includes('diesel')) return 'Diesel';
  return 'Automotiva';
}
export const CATEGORIAS = ['Automotiva', 'EFB', 'AGM', 'Moto', 'Diesel'];

/** "Moura Log Diesel" → "Diesel"; "Moura Automotiva" → "Automotiva" */
export const linhaCurta = (linha) => String(linha ?? '').replace(/^(Moura|Heliar|Zetta)\s+(Log\s+)?/i, '');

/** "Chevrolet Onix, Hyundai HB20" → "Onix, HB20" */
export function aplicacoesCurtas(txt) {
  return String(txt ?? '')
    .replace(/\b(Chevrolet|Hyundai|Fiat|Toyota|Honda|VW|Volkswagen|Ford|Jeep|Renault|Yamaha|Mercedes-Benz|MB|Nissan|Peugeot|Citroën)\s+/g, '')
    .replace(/\s*,\s*/g, ', ');
}

/** Saldo com sinal de menos tipográfico */
export const saldo = (n) => (Number(n) < 0 ? `-${Math.abs(n)}` : String(n ?? 0));

/** Classe de cor do saldo: verde acima do mínimo, amarelo no mínimo, vermelho zero ou negativo */
export function corSaldo(atual, minimo) {
  if (Number(atual) <= 0) return 'saldo-falta';
  if (Number(atual) <= Number(minimo)) return 'saldo-minimo';
  return 'saldo-ok';
}

/** Executa fn só depois de `ms` sem novas chamadas */
export function debounce(fn, ms = 250) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

/** Desabilita o botão enquanto a promessa roda (evita toque duplo). */
export async function ocupado(botao, fn, textoOcupado = 'Salvando…') {
  if (botao.disabled) return;
  const original = botao.innerHTML;
  botao.disabled = true;
  botao.textContent = textoOcupado;
  try {
    return await fn();
  } finally {
    botao.disabled = false;
    botao.innerHTML = original;
  }
}

/** Gera e baixa um CSV (separador ; para abrir certo no Excel em português). */
export function baixarCSV(nomeArquivo, linhas) {
  const celula = (v) => {
    const s = v === null || v === undefined ? '' : typeof v === 'number' ? String(v).replace('.', ',') : String(v);
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = '﻿' + linhas.map((l) => l.map(celula).join(';')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: nomeArquivo });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** true quando a tela está no layout de notebook */
export const ehNotebook = () => window.matchMedia('(min-width: 900px)').matches;

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
