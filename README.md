# N E Baterias — sistema de gestão

Sistema web interno (celular e notebook) para vendas, estoque, entradas, clientes e painel da N E Baterias, em Fortaleza-CE. Supabase (plano gratuito) + Netlify (plano gratuito).

| Pasta / arquivo | Conteúdo |
| --- | --- |
| `CLAUDE.md` | Guia para quem for programar (lido automaticamente pelo Claude Code) |
| `docs/especificacao.md` | Especificação completa do sistema |
| `docs/banco-de-dados.md` | Banco: tabelas, funções, views, consultas por tela |
| `docs/README-banco.md` | Passo a passo para criar o banco no Supabase |
| `design/DESIGN.md` | Cores, fontes, medidas e mapa de telas |
| `design/imagens/` | Imagem de cada tela (celular, notebook, janelas rápidas) |
| `design/telas/` | HTML estático de cada tela; abra `design/telas/celular/02-inicio.html` no navegador |
| `design/fonte-canvas/` | Arquivos originais do protótipo |
| `supabase/` | `schema.sql`, `seed.sql`, `consultas.sql` |
| `testes/` | Testes locais do banco |
| `.github/workflows/` | Anti-pausa e backup semanal do Supabase |
| `scripts/build.mjs` | Gera `js/config.js` com as chaves públicas do Supabase e monta `dist/` para o Netlify |
| `netlify.toml` | Build e cabeçalhos do Netlify (publica só `dist/`) |

## Rodar localmente

1. Copie `.env.example` para `.env` e preencha `SUPABASE_URL` e `SUPABASE_ANON_KEY` (chave anon/publishable, nunca a service_role).
2. `npm run dev` → gera `js/config.js` e abre o app em http://localhost:5173.

No Netlify, as mesmas duas variáveis ficam em *Site configuration → Environment variables*.

Para começar com o Claude Code: abra esta pasta no terminal, rode `claude` e peça, por exemplo, *"leia o CLAUDE.md e comece pela etapa 1"*.
