# Clínica Vitalis — Barreira de Glosas · contrato técnico

Fonte da verdade do produto: `docs/PRD-SDD.md` (PRD + SDD + plano faseado).
Estado vivo da execução: `docs/PROGRESS/STATE.md`. Handoff por fase: `docs/PROGRESS/phase-N-handoff.md`.

Leia o trecho do PRD relativo à sua tarefa antes de escrever código. Não invente requisito que o PRD não pede (§8 Não objetivos, §8 Anti-padrões da SPEC).

## Stack fixada (não trocar sem registrar no handoff)

- TypeScript strict, Node 24, pnpm.
- Cloudflare Workers (`src/worker/index.ts` é o `main`), Static Assets servindo a SPA.
- React 19 + Vite. Build do cliente em `dist/client`; `not_found_handling: "single-page-application"`.
- D1 (migrações SQL explícitas em `migrations/`), R2 privado, Workers AI por binding.
- MCP: `createMcpHandler` do Agents SDK + MCP SDK. Nunca `McpAgent`.
- Zod em toda fronteira (HTTP, MCP, IA).
- Vitest. Unitários em Node puro; integração com `@cloudflare/vitest-pool-workers` quando viável.
- XLSX é parseado no **cliente** (browser) e enviado normalizado; o Worker recebe CSV/JSON. Nunca colocar SheetJS no bundle do Worker.

## Regra de dependência (não violar)

`ui / mcp / http → application → domain + rules`

`src/rules/**` e `src/domain/**` são puros: sem `fetch`, sem D1, sem R2, sem `Date.now()` implícito (o relógio entra por parâmetro), sem React. Infraestrutura (`src/infrastructure/**`) implementa interfaces declaradas pela aplicação.

Uma única implementação de regras serve UI, MCP e Skill. Nunca duplicar lógica de validação por canal.

## Invariantes de domínio

- Dinheiro em **centavos inteiros** (`*_cents`). Nunca float em cálculo ou persistência.
- Datas canônicas em **ISO UTC**; exibição `dd/MM/aaaa HH:mm:ss` em `America/Sao_Paulo` ("horário de Brasília").
- Todo registro de ação separa `occurred_at_utc` (fato) de `recorded_at_utc` (gravação).
- Histórico é append-only: correção cria **nova versão**, nunca edita a anterior. `workflow_events` nunca sofre UPDATE/DELETE.
- Risco conta **uma vez por protocolo**, mesmo com vários problemas; protocolo mesclado não soma de novo.
- Autorização é válida **no próprio dia** do vencimento (comparação inclusiva).
- Nenhuma tool MCP corrige, libera, envia, encerra ou mescla. Decisão humana é só da interface.
- Papel vem da credencial, nunca de parâmetro de entrada.
- IA nunca produz `OK`, nunca altera campo: falha ou saída fora do schema vira `REVISÃO HUMANA` com `ai_status = FAILED`.
- Códigos de problema (`code`) são estáveis: mudar texto é permitido, mudar código não.

## Convenções de código

- Arquivos pequenos e focados (alvo 200–400 linhas, teto 800).
- Nomes de domínio em português quando são termos do negócio (`protocolo`, `guia`, `convenio`); infra e tipos técnicos em inglês.
- SQL sempre parametrizado (`.bind()`), nunca interpolado.
- Erros de domínio retornam código estável (`GUIDE_NOT_READY`, `OPEN_BLOCKING_TASKS`, `EVIDENCE_REQUIRED`, `ROLE_NOT_ALLOWED`, `INVALID_STATE_TRANSITION`, `DUPLICATE_MERGE_CONFLICT`, `AI_REVIEW_REQUIRED`) e mensagem curta em português, sem stack trace.
- Sem secret em código, log ou commit. Token nunca aparece inteiro em resposta ou log.
- Mensagens de interface em português operacional: o que aconteceu, por que importa, qual o próximo passo.

## Comandos

```bash
pnpm install            # deps fixadas pelo lockfile
pnpm typecheck          # tsc --noEmit
pnpm test               # vitest run
pnpm build              # build do cliente + checagem do worker
pnpm dev                # wrangler dev (worker + assets)
pnpm db:migrate:local   # aplica migrations no D1 local
pnpm seed:local         # carrega regras + 80 guias no D1 local
```

Portão verde = `pnpm typecheck && pnpm test && pnpm build` sem erro. Nenhuma fase fecha vermelha.

## Materiais da prova (entrada, não editar)

- `guias.csv` — 80 guias fictícias.
- `regras_convenio.json.txt` — regras oficiais `agosto/2026`.
- `Posicionamento/` — material privado do dono. **Nunca** ler, citar, copiar ou versionar. Já ignorado pelo Git.

## Git

Commits em português, formato `<tipo>: <descrição>` (feat, fix, refactor, docs, test, chore). Um commit por entrega de fase, no mínimo. Nunca commitar `node_modules/`, `.wrangler/`, `dist/`, `.dev.vars`, `*.local.*`, nem nada sob `Posicionamento/`.
