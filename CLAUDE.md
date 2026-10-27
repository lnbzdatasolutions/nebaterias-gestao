# N E Baterias — sistema de gestão (guia para o Claude Code)

Sistema web interno da loja N E Baterias (Fortaleza-CE): vendas, estoque, entradas de compra, clientes e painel de resultados. Usado pelo dono (quase sempre no celular, com uma mão) e pela esposa (celular e notebook).

## Antes de programar, leia

1. `docs/especificacao.md` — escopo, telas, regras de negócio, requisitos e critérios de aceite.
2. `docs/banco-de-dados.md` — tabelas, funções RPC, views e a **consulta pronta de cada tela** (seção 6).
3. `design/DESIGN.md` — cores, fontes, medidas e mapa de telas.
4. `design/imagens/` — olhe a imagem da tela antes de construí-la. `design/telas/` tem o HTML com as medidas exatas.

## Stack (não mudar sem combinar)

- HTML + CSS + JavaScript puro (ES modules). **Sem framework, sem bundler, sem biblioteca de UI.**
- Supabase (Postgres, Auth, API) via `@supabase/supabase-js` por CDN. Chart.js só na tela Painel.
- Netlify (site estático). PWA com `manifest.json` e service worker.
- Um único app responsivo: layout de celular abaixo de ~900 px, de notebook acima.

## Regras que não podem ser quebradas

- Venda, compra, cancelamento e ajuste de estoque **só por RPC**: `registrar_venda`, `registrar_compra`, `cancelar_venda`, `cancelar_compra`, `ajustar_estoque`. O banco recusa insert direto nessas tabelas.
- Nunca enviar `estoque_atual` ou `custo_medio` ao salvar produto; o banco mantém esses campos.
- O front usa só a chave `anon` do Supabase, lida de variável de ambiente. Nunca a `service_role`.
- Dinheiro sempre formatado `R$ 1.234,56`; datas `dd/mm/aaaa`; fuso `America/Fortaleza`.
- Campos de formulário com fonte de no mínimo 16 px; alvos de toque de no mínimo 44 px.
- Os dados nas imagens são de exemplo. Tudo vem do banco.

## Banco

- `supabase/schema.sql` e `supabase/seed.sql` já estão prontos e testados. Não reescreva; se precisar mudar, crie um novo arquivo de migração.
- Testes locais do banco (Postgres 16): `./testes/rodar.sh` (precisa de `PGHOST`/`PGPORT`/`PGUSER` apontando para um Postgres local). São 20 cenários.

## Estrutura sugerida do front

```
index.html            # shell + navegação (rodapé no celular, barra lateral no notebook)
css/app.css           # tokens do design/DESIGN.md como variáveis CSS
js/app.js             # roteamento por hash (#inicio, #vender, #estoque, ...)
js/supabase.js        # cliente e chamadas (copiar de docs/banco-de-dados.md seção 6)
js/telas/*.js         # uma tela por arquivo
js/componentes/       # janela-novo-cliente.js, janela-nova-bateria.js (usadas nos dois tamanhos)
manifest.json
sw.js
```

## Ordem de entrega

1. Base: login, navegação, PWA, deploy no Netlify.
2. Operação: Produtos, Clientes, Entrada, Vender (com as janelas rápidas), Estoque.
3. Gestão: Painel, Histórico, comprovante por WhatsApp, exportar CSV.
4. Estabilização: testar num Android de entrada e num iPhone; rotina `.github/workflows/manutencao-supabase.yml` ativa.
