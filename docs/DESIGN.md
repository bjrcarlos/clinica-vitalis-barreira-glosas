# Sistema visual — Barreira de Glosas Vitalis

A direção visual já está decidida e desenhada. As nove telas de referência estão em `design-reference/*.dc.html`, exportadas do canvas de design aprovado pelo dono do produto:

| Arquivo | Tela |
|---|---|
| `Relatorio.dc.html` | Relatório do Dr. Renato (4 blocos narrativos, motivos, quem resolve, pendências antigas) |
| `Dashboard.dc.html` | Dashboard operacional (KPIs, risco por semana, rosca de estados, pendências e correções recentes) |
| `Guias.dc.html` | Todas as guias (chips de filtro, tabela, paginação) |
| `Protocolo.dc.html` | Página do protocolo (próxima ação, trava, problemas, versões, diff, evidências, linha do tempo) |
| `Pendencias.dc.html` | Minhas pendências por área + demonstração do MCP |
| `Importar.dc.html` | Importação CSV/XLSX com resumo antes de confirmar |
| `NovaGuia.dc.html` | Cadastro individual |
| `Regras.dc.html` | Regras versionadas |
| `Merge.dc.html` | Comparação e merge de duplicidade |

**Como usar:** cada arquivo é HTML estático com CSS inline e classes utilitárias. Traduza a estrutura e os tokens para componentes React + CSS custom properties. Não copie a sintaxe `<x-dc>`, `<helmet>` ou o `<script type="text/x-dc">` — isso pertence ao editor de design, não à aplicação. Copie markup semântico, hierarquia, espaçamento, cor e estados.

## Tokens

```css
:root {
  /* superfícies */
  --cor-fundo: #F4F3ED;
  --cor-superficie: #FBFAF6;      /* sidebar, topbar, cabeçalho de tabela */
  --cor-card: #FFFFFF;
  --cor-borda: #E3E1D8;
  --cor-borda-suave: #E6E4DB;
  --cor-divisoria: #F1F0EA;
  --cor-divisoria-forte: #EFEDE5;

  /* texto */
  --cor-texto: #14241E;
  --cor-texto-2: #3E5249;
  --cor-texto-3: #6B7A72;
  --cor-texto-4: #7B877F;

  /* verde institucional */
  --cor-primaria: #0F3B2E;
  --cor-primaria-clara: #1B6B4F;
  --cor-mint: #DDF3E4;
  --cor-mint-hover: #EEF6F0;
  --cor-verde-ok: #2FA86A;
  --cor-verde-texto: #155C3F;
  --cor-verde-sobre-escuro: #CFF1DB;

  /* estados de validação */
  --cor-corrigir-bg: #FFF1D6;     --cor-corrigir-txt: #7A4B0C;
  --cor-revisao-bg: #E9E3FF;      --cor-revisao-txt: #4B3A9E;
  --cor-nao-faturar-bg: #FCE3DF;  --cor-nao-faturar-txt: #8F2B22;
  --cor-ok-bg: #DDF3E4;           --cor-ok-txt: #155C3F;

  /* gradientes dos blocos do relatório */
  --grad-verificadas: linear-gradient(160deg, #C9F2D8, #A9E9C3);   /* texto #0F3B2E */
  --grad-atencao:     linear-gradient(160deg, #FFE9BF, #FFD98F);   /* texto #5A3608 */
  --grad-risco:       linear-gradient(160deg, #FFD6CF, #F8B8AE);   /* texto #6E1F17 */

  /* barras e séries */
  --serie-verde: #0F3B2E;  --serie-roxo: #7C5CD6;
  --serie-vermelho: #E0574A; --serie-neutra: #B9B4A3;
  --trilho: #EFEDE5;

  /* forma */
  --raio-card: 18px;
  --raio-bloco: 14px;
  --raio-item: 10px;
  --raio-pill: 999px;
  --sidebar-largura: 236px;
  --sombra-hover: 0 12px 28px -14px rgba(15, 59, 46, .35);
}
```

## Tipografia

- **Bricolage Grotesque** (500/600/700): títulos, números e protocolos. Sempre com `font-variant-numeric: tabular-nums` e `letter-spacing: -.03em` em números grandes.
- **Instrument Sans** (400/500/600): corpo, tabelas, rótulos.
- **Instrument Serif itálico**: só para o destaque de saudação no relatório ("Dr. Renato").

Carregar por Google Fonts com `display=swap`, apenas os pesos acima.

## Padrões de componente

- **Sidebar** 236px, item ativo com fundo mint e peso 600; contador de pendências em pílula âmbar; rodapé com avatar e papel do usuário (a identidade do papel importa: Secretaria, Financeiro ou Direção).
- **Topbar**: busca em pílula, selo "Regras agosto/2026 ativas" com ponto verde, relógio com data por extenso e "horário de Brasília".
- **Bloco do relatório**: gradiente, rótulo numerado em caixa alta, número grande, frase explicativa, seta no canto; é um link para a lista filtrada; hover levanta 2px.
- **Badge de estado**: pílula pequena, fundo claro e texto escuro do par correspondente ao estado de validação.
- **Estado de fluxo**: texto discreto com ponto colorido (cinza em tratamento, verde liberada, escuro enviada, roxo mesclada).
- **Tabela**: cabeçalho em caixa alta 11px sobre `--cor-superficie`, linhas com divisória suave, hover de linha, coluna de valor alinhada à direita em tabular-nums, protocolo como link em Bricolage.
- **Chips de filtro**: pílula com contagem embutida; o chip ativo inverte para verde escuro.

## Acessibilidade e desempenho (obrigatórios)

- Elementos reais: `<button>`, `<a href>`, `<input>` + `<label>`. Nunca `onClick` em `div`.
- `aria-label` em botão que é só ícone; `aria-live` no resultado de validação.
- Contraste mínimo 4.5:1 para texto normal. Os pares de badge acima já foram escolhidos para passar.
- Nada de animação que não seja `transform`/`opacity`. Respeitar `prefers-reduced-motion`.
- Layout precisa sobreviver a 1280px e a telas menores: a referência foi desenhada em 1440px.
