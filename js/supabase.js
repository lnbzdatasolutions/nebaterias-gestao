// Cliente do Supabase. Usa só a chave pública (anon/publishable), gerada em
// js/config.js pelo scripts/build.mjs a partir das variáveis de ambiente.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.4/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

/** Lança o erro do Supabase, se houver, e devolve os dados. */
export function ok({ data, error }) {
  if (error) throw error;
  return data;
}

/** Traduz os erros mais comuns para o usuário. */
export function mensagemDeErro(erro) {
  const msg = erro?.message || String(erro);
  if (/Invalid login credentials/i.test(msg)) return 'E-mail ou senha incorretos.';
  if (/Email not confirmed/i.test(msg)) return 'E-mail ainda não confirmado.';
  if (/Failed to fetch|NetworkError|network/i.test(msg)) return 'Sem conexão com a internet. Tente de novo.';
  if (/rate limit|too many/i.test(msg)) return 'Muitas tentativas. Aguarde um minuto e tente de novo.';
  if (/should be at least|weak password/i.test(msg)) return 'A senha precisa ter pelo menos 8 caracteres.';
  if (/JWT|session/i.test(msg) || erro?.code === 'PGRST301') {
    supabase.auth.signOut(); // sessão inválida: volta para o login
    return 'Sua sessão expirou. Entre de novo.';
  }
  return msg;
}
