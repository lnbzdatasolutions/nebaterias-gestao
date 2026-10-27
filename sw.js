// Service worker: guarda a casca do app para abrir mesmo com sinal ruim.
// Dados do Supabase nunca são guardados em cache (sempre vão à rede).
// Arquivos do app: usa o cache na hora e atualiza em segundo plano.

const CACHE = 'nebaterias-v5';
const CASCA = [
  '/', '/index.html', '/manifest.json', '/css/app.css', '/css/telas.css',
  '/js/app.js', '/js/supabase.js', '/js/config.js', '/js/util.js', '/js/icones.js',
  '/js/telas/login.js', '/js/telas/inicio.js', '/js/telas/mais.js',
  '/js/telas/em-breve.js', '/js/telas/nova-senha.js',
  '/js/telas/vender.js', '/js/telas/venda-registrada.js', '/js/telas/estoque.js',
  '/js/telas/entrada.js', '/js/telas/clientes.js', '/js/telas/produtos.js',
  '/js/componentes/janela.js', '/js/componentes/janela-novo-cliente.js',
  '/js/componentes/janela-nova-bateria.js', '/js/componentes/escolher-bateria.js',
  '/js/componentes/nota-fiscal.js', '/js/componentes/janela-editar-venda.js', '/js/telas/vendas.js', '/js/telas/painel.js', '/js/exportar.js',
  '/icones/icone-192.png', '/icones/icone.svg',
];
const EXTERNOS = ['fonts.googleapis.com', 'fonts.gstatic.com', 'cdn.jsdelivr.net'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CASCA)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((chaves) => Promise.all(chaves.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const mesmoSite = url.origin === self.location.origin;
  if (!mesmoSite && !EXTERNOS.includes(url.hostname)) return; // Supabase e outros: direto na rede

  // Navegação: sempre a casca do app (as rotas são por hash).
  const chave = req.mode === 'navigate' ? '/index.html' : req;

  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const emCache = await cache.match(chave);
      const daRede = fetch(req)
        .then((resp) => {
          if (resp.ok || resp.type === 'opaque') cache.put(chave, resp.clone());
          return resp;
        })
        .catch(() => emCache);
      if (emCache) {
        e.waitUntil(daRede);
        return emCache;
      }
      return daRede;
    }),
  );
});
