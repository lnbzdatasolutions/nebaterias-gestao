# Design — N E Baterias

Referência visual do sistema. Cada tela existe em três formas:

| Pasta | O que tem | Para quê |
| --- | --- | --- |
| `imagens/` | PNG de cada tela | Ver como a tela deve ficar |
| `telas/` | HTML estático de cada tela (abre no navegador; links entre telas funcionam) | Copiar medidas, cores, espaçamentos e estrutura |
| `fonte-canvas/` | Arquivos originais do protótipo (`.dc.html`) | Só referência: usam a linguagem do editor de design (`{{ }}`, `<sc-for>`) e não abrem sozinhos |

Os números, nomes e clientes nas telas são **dados de exemplo**. No app real, tudo vem do Supabase (ver `docs/banco-de-dados.md`, seção 6).

## Princípios

1. **Uma tarefa por tela.** A ação principal fica embaixo, no alcance do polegar, num botão amarelo grande.
2. **Feito para Android simples e uso no sol.** Fundo claro, texto quase preto, números grandes, sem animações pesadas.
3. **Cor só quando significa algo.** Verde = ok / lucro. Amarelo-escuro = no mínimo / atenção. Vermelho = falta / cancelado / perigo.
4. **Lucro escondido na venda.** Só aparece com um toque em "Ver lucro", para não aparecer na frente do cliente.
5. **Mesmo menu nos dois aparelhos.** Celular: barra no rodapé com 5 abas. Notebook: barra lateral escura com 9 itens.

## Cores

| Uso | Cor |
| --- | --- |
| Texto principal, botão escuro, barra lateral | `#12161C` |
| Texto secundário | `#5B6472` |
| Texto médio | `#3D4652` |
| Fundo da página | `#F5F6F8` |
| Cartões e campos | `#FFFFFF` |
| Borda de cartão | `#E1E4E9` |
| Borda de campo e botão secundário | `#C9CED6` |
| Divisória dentro de cartão | `#EEF0F3` |
| **Ação principal** (Nova venda, Confirmar, Registrar) | `#FFC21A` (texto `#12161C`) |
| Aba ativa do rodapé (celular) | `#FFE8A3` |
| Linha selecionada em tabela | `#FFF8E1` |
| Alerta (fundo / borda / texto) | `#FFF4D6` / `#F2D27A` / `#7A4E00` |
| OK, lucro (texto / fundo) | `#1F7A4D` / `#E3F4EA` |
| Falta, cancelado, perigo (texto / fundo / borda) | `#B42318` / `#FDE7E5` / `#F1B5AF` |
| Links | `#1D4ED8` |
| Barras neutras de gráfico | `#9AA2AE` |
| Barras de atendimento | `#E0A500` |
| Fundo atrás de janela aberta | `rgba(18, 22, 28, 0.55)` |

## Tipografia

- **Barlow** 600/700: títulos de tela, nomes de modelo de bateria, valores em destaque (totais, cartões do painel).
- **Inter** 400/500/600: todo o resto.
- Carregar do Google Fonts: `family=Barlow:wght@600;700&family=Inter:wght@400;500;600`.

| Elemento | Tamanho |
| --- | --- |
| Título de tela | 26 px celular / 32 px notebook (Barlow 700) |
| Total da venda | 26–32 px (Barlow 700) |
| Valor de cartão do painel | 24–30 px (Barlow 700) |
| Modelo da bateria em lista | 17–20 px (Barlow 700) |
| Texto normal | 14–16 px |
| Texto auxiliar | 12–13 px |
| **Campos de formulário** | **mínimo 16 px** (evita o zoom automático do iPhone) |

## Medidas

| Item | Celular | Notebook |
| --- | --- | --- |
| Largura de referência | 390 px (funcionar a partir de 360 px) | 1440 px (funcionar a partir de 1024 px) |
| Margem lateral | 16 px | 32 px |
| Botão de ação principal | 56–58 px de altura, cantos 14 px | 52–54 px, cantos 12 px |
| Campos | 48–52 px, cantos 12 px | 40–46 px, cantos 10 px |
| Alvo de toque mínimo | 44 × 44 px | 34 px em tabelas, 44 px no resto |
| Cartão | cantos 16 px, borda 1 px `#E1E4E9`, padding 14–16 px | cantos 16 px, padding 16–20 px |
| Chips de filtro | 40 px, cantos 999 px | 40 px |
| Espaço entre blocos | 14–16 px | 16–18 px |

## Estrutura das telas

**Celular** (`telas/celular/`): cabeçalho com título, conteúdo rolável, barra fixa no rodapé com Início, Vender, Estoque, Entrada e Painel. Em Vender e Entrada, uma barra de ação fixa acima do rodapé mostra o total e o botão principal. "Mais" (Clientes, Produtos, senha, exportar, sair) abre pelo botão de menu no topo do Início.

**Notebook** (`telas/notebook/`): barra lateral escura de 232 px à esquerda (Início, Vender, Estoque, Entrada, Painel, Vendas, Clientes, Produtos, Configurações) e conteúdo à direita. A barra lateral vira bloco no topo quando a tela é estreita (`flex-wrap`). Tabelas largas rolam na horizontal dentro do cartão.

**Janelas rápidas** (`telas/janelas/`): **Novo cliente** e **Nova bateria** são um único componente usado nos dois aparelhos. No celular, sobem de baixo como folha; no notebook, abrem centralizadas (máx. 460 px). Abrem por cima da venda sem perder o que já foi preenchido; ao salvar, o cliente/bateria já entra na venda.

## Mapa de telas

| Tela | Celular | Notebook | Rota no app |
| --- | --- | --- | --- |
| Login | `celular/01-login` | `notebook/01-login` | `#login` |
| Início | `celular/02-inicio` | `notebook/02-inicio` | `#inicio` |
| Vender | `celular/03-vender-itens` + `04-vender-pagamento` (2 passos) | `notebook/03-vender` (1 tela) | `#vender` |
| Venda registrada | `celular/05-venda-registrada` | `notebook/04-venda-registrada` | `#vender/ok` |
| Estoque | `celular/06-estoque` | `notebook/05-estoque` (tabela + detalhe e ajuste ao lado) | `#estoque` |
| Entrada | `celular/07-entrada` | `notebook/06-entrada` | `#entrada` |
| Painel | `celular/08-painel` | `notebook/07-painel` | `#painel` |
| Histórico de vendas | (lista em Início) | `notebook/08-historico-vendas` | `#vendas` |
| Clientes | `celular/10-clientes` | `notebook/09-clientes` | `#clientes` |
| Produtos | `celular/11-produtos` | `notebook/10-produtos` | `#produtos` |
| Mais / Configurações | `celular/09-mais-configuracoes` | `notebook/11-configuracoes` | `#mais` |
| Novo cliente (janela) | `janelas/01`, `03` | `janelas/05` | sem rota (sobrepõe a tela) |
| Nova bateria (janela) | `janelas/02`, `04` | `janelas/06` | sem rota (sobrepõe a tela) |

Um único código, responsivo: abaixo de ~900 px de largura usa o layout de celular; acima, o de notebook.

## Comportamentos que as imagens não mostram

- Busca de bateria: dispara 250 ms após parar de digitar; procura por modelo **ou carro** ("onix", "hilux diesel"), sem acento.
- Saldo de estoque: verde se acima do mínimo, amarelo-escuro no mínimo, vermelho se zero ou negativo.
- Venda sem estoque suficiente: o banco devolve `ESTOQUE_INSUFICIENTE`; perguntar "vender mesmo assim?" e repetir com permissão.
- Pagamento dividido: mostrar "Valores fecham com o total" em verde só quando a soma bate.
- Botão de confirmar fica desabilitado enquanto salva (evita venda duplicada).
- Comprovante: abre `https://wa.me/55<telefone>?text=...` com o texto da tela "Venda registrada".
- Atalho `#estoque` abre direto a consulta, com o cursor na busca.
