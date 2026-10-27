// Gera js/config.js com as chaves públicas do Supabase e, com --dist,
// monta a pasta dist/ que o Netlify publica (só os arquivos do app).
//
//   node scripts/build.mjs          → só gera js/config.js (uso local)
//   node scripts/build.mjs --dist   → gera js/config.js e copia o app para dist/
//
// As chaves vêm das variáveis de ambiente SUPABASE_URL e SUPABASE_ANON_KEY
// (no Netlify: Site configuration → Environment variables). Localmente,
// também são lidas do arquivo .env, que fica fora do Git.
// Nunca use aqui a chave service_role / secret.

import { existsSync, readFileSync, writeFileSync, rmSync, mkdirSync, cpSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');

function lerEnvLocal() {
  const arq = join(raiz, '.env');
  if (!existsSync(arq)) return {};
  const vars = {};
  for (const linha of readFileSync(arq, 'utf8').split(/\r?\n/)) {
    const m = linha.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) vars[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return vars;
}

const env = { ...lerEnvLocal(), ...process.env };
const url = env.SUPABASE_URL;
const chave = env.SUPABASE_ANON_KEY;

if (!url || !chave) {
  console.error('Faltam SUPABASE_URL e/ou SUPABASE_ANON_KEY (variáveis de ambiente ou arquivo .env).');
  process.exit(1);
}
if (/service_role|sb_secret_/.test(chave)) {
  console.error('SUPABASE_ANON_KEY parece ser a chave service_role/secret. Use a chave anon/publishable.');
  process.exit(1);
}

const config = `// Gerado por scripts/build.mjs — não editar nem versionar.
export const SUPABASE_URL = ${JSON.stringify(url)};
export const SUPABASE_ANON_KEY = ${JSON.stringify(chave)};
`;
mkdirSync(join(raiz, 'js'), { recursive: true });
writeFileSync(join(raiz, 'js', 'config.js'), config);
console.log('js/config.js gerado.');

if (process.argv.includes('--dist')) {
  const dist = join(raiz, 'dist');
  rmSync(dist, { recursive: true, force: true });
  mkdirSync(dist);
  const doApp = ['index.html', 'manifest.json', 'sw.js', 'css', 'js', 'icones'];
  for (const item of doApp) {
    const origem = join(raiz, item);
    if (existsSync(origem)) cpSync(origem, join(dist, item), { recursive: true });
  }
  console.log('dist/ montado com:', doApp.filter((i) => existsSync(join(raiz, i))).join(', '));
}
