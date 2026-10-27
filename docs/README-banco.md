# N E Baterias · Banco de dados (Supabase)

Banco do sistema interno de vendas, estoque e painel da N E Baterias (Fortaleza-CE).
A especificação completa está no documento "Sistema de Gestão — N E Baterias", aba **Banco de dados**.

## Nomes

| Item | Nome |
| --- | --- |
| Projeto Supabase | `nebaterias-gestao` (região São Paulo, `sa-east-1`) |
| Banco / schema | `postgres` / `public` (padrão do Supabase) |
| Repositório GitHub | `nebaterias-gestao` |
| Site Netlify | `nebaterias-gestao.netlify.app` |

## Como criar o banco (uma vez)

1. Criar o projeto no Supabase com o e-mail da loja.
2. SQL Editor → colar e rodar `supabase/schema.sql`.
3. SQL Editor → colar e rodar `supabase/seed.sql`.
4. Authentication → Sign In / Providers → desligar **Allow new users to sign up**.
5. Authentication → Users → **Add user** para o dono e para a esposa.
6. Copiar `Project URL` e a chave `anon` para as variáveis de ambiente do Netlify.
7. GitHub → Settings → Secrets: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_DB_URL`
   (ativa a rotina `.github/workflows/manutencao-supabase.yml`: anti-pausa e backup semanal).

## Arquivos

| Arquivo | O que é |
| --- | --- |
| `supabase/schema.sql` | Tabelas, índices, triggers, funções RPC, views, RLS e permissões |
| `supabase/seed.sql` | Dados da loja, formas de pagamento e catálogo inicial Moura |
| `supabase/consultas.sql` | Consulta pronta de cada tela, em SQL e em supabase-js |
| `testes/` | Testes locais (Postgres 16): `./testes/rodar.sh` — 20 cenários |
| `.github/workflows/manutencao-supabase.yml` | Ping a cada 3 dias + `pg_dump` aos domingos |

## Regras que o app precisa respeitar

- Venda, compra, cancelamento e ajuste: **só por RPC** (`registrar_venda`, `registrar_compra`,
  `cancelar_venda`, `cancelar_compra`, `ajustar_estoque`). Insert direto nessas tabelas é negado.
- `produtos.estoque_atual` e `produtos.custo_medio` são mantidos pelo banco; o app não os envia.
- Erro `ESTOQUE_INSUFICIENTE` em `registrar_venda`: perguntar ao usuário e repetir com
  `p_permitir_estoque_negativo: true`.
