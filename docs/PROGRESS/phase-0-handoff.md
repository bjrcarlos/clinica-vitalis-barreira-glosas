# Handoff — Fase 0 (Fundação e proteção)

Medido em disco e por execução real de comando nesta sessão (20/09/2026), não copiado de handoff anterior sem checagem.

## 1. O que ficou pronto

- `wrangler.jsonc` — Worker `vitalis-barreira-glosas`, bindings `DB` (D1), `EVIDENCE` (R2),
  `AI` (Workers AI), `ASSETS` (Static Assets servindo `dist/client`, SPA). Comentário junto
  ao binding `AI` documenta que ele é sempre remoto e exige `CLOUDFLARE_ACCOUNT_ID`.
- `migrations/0001_init.sql` — schema D1 com as 10 tabelas de domínio (§19 do PRD):
  `rule_sets`, `protocols`, `guide_versions`, `validation_runs`, `validation_issues`,
  `tasks`, `workflow_events`, `evidence_objects`, `evidence_links`, `protocol_merges`,
  mais os 10 índices de `docs/PRD-SDD.md` §20. Aplicada e conferida nesta sessão (ver §2).
- `migrations/README.md` — regra de migração append-only (nunca editar arquivo já aplicado).
- `src/worker/index.ts` — handler mínimo do Worker: `GET /api/health` reporta os três
  bindings de dados; qualquer outra rota cai em `env.ASSETS.fetch`.
- `src/ui/{main.tsx,App.tsx}`, `src/ui/styles/global.css`, `index.html` — shell React 19 +
  Vite mínimo, sem telas de produto (isso é Fase 2).
- Diretórios vazios com `.gitkeep` para `src/application`, `src/domain`, `src/rules`,
  `src/http/handlers`, `src/mcp/tools`, `src/infrastructure/{ai,auth,d1,r2,signing}` —
  marcam a fronteira de dependência do `CLAUDE.md` (`ui/mcp/http → application → domain+rules`)
  sem implementar nada ainda.
- `tests/fundacao.test.ts` — 4 testes unitários (Vitest puro, Node, sem
  `@cloudflare/vitest-pool-workers`) que leem `wrangler.jsonc` e conferem os 4 bindings.
- `package.json`, `pnpm-lock.yaml` — todas as versões fixadas exatas, sem `^`/`~`/`@latest`
  (confirmado lendo o arquivo nesta sessão): `react` 19.3.0, `react-dom` 19.3.0,
  `react-router-dom` 7.18.4, `zod` 4.6.5, `typescript` 7.0.2, `vite` 8.3.0,
  `@vitejs/plugin-react` 6.1.1, `wrangler` 4.135.0, `vitest` 5.0.1,
  `@cloudflare/workers-types` 5.20260920.1, `@types/react` 19.3.0, `@types/react-dom` 19.3.0.
- `tsconfig.json` (base, `strict: true`, sem DOM/JSX), `tsconfig.app.json` (estende a base,
  adiciona `lib: DOM`, `jsx: react-jsx`, `types: vite/client`, `include: src/ui`),
  `tsconfig.worker.json` (estende a base, `types: @cloudflare/workers-types`,
  `include: src/worker`) — checagem de tipos separada cliente vs. Worker.
- `vite.config.ts` (build em `dist/client`), `vitest.config.ts` (roda `tests/**/*.test.ts`
  em ambiente Node).
- `scripts/seed.ts` — placeholder (`console.log` + `process.exit(0)`); carga real das 80
  guias é Fase 1. Note-se que este arquivo **não está incluído em nenhum tsconfig**
  (nem `app` nem `worker`), então não é checado por `pnpm typecheck` hoje — ver §5.
- `docs/CONFIG.md` — bindings, secrets, passo a passo dev local/produção, incluindo a
  seção "Selecionar a conta Cloudflare para o dev local".
- `.dev.vars.example` — template dos 3 secrets (`MCP_SECRETARIA_TOKEN`,
  `MCP_FINANCEIRO_TOKEN`, `LINK_SIGNING_KEY`), todos com valor de exemplo, nenhum real.
- `.gitignore` — cobre `/Posicionamento/`, `/posicionamento/`, `/screenshot-*.png`,
  artefatos de build/cache (`node_modules`, `dist`, `.wrangler`, `.dev.vars`, `*.local.*`,
  `.env*`, `coverage`, `*.log`).
- Fora do escopo desta fase mas já presente em disco (não tocado por mim): `design-reference/`
  (9 telas `.dc.html` + `canvas.json`) e `docs/DESIGN.md`, commitados em `b00712a` e `c08d6e6`
  — referência visual para a Fase 2, produzida em paralelo à Fase 0. `guias.csv` (81 linhas,
  cabeçalho + 80 guias) e `regras_convenio.json.txt` (95 linhas) — materiais oficiais de
  entrada, intactos, nunca editados.

## 2. Como verificar

Comandos rodados nesta sessão, no diretório do projeto (`cd "C:/Users/bjr-c/Downloads/Clinica Vitalis"`):

```bash
pnpm install                     # idempotente; resolve as versões fixadas do lockfile
pnpm run typecheck                # tsc --noEmit nos dois tsconfig (app + worker)
pnpm run test                     # vitest run
pnpm run build                    # vite build (dist/client) + tsc --noEmit worker
pnpm run db:migrate:local         # aplica migrations/0001_init.sql no D1 local
pnpm exec wrangler d1 execute DB --local --command \
  "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"
export CLOUDFLARE_ACCOUNT_ID=<account_id_de_qualquer_conta_autenticada>  # ver `wrangler whoami`
pnpm run dev                      # sobe worker + assets
curl http://127.0.0.1:8787/api/health
```

**Resultado real medido:**

- `pnpm install`: resolve sem erro (12 dependências diretas, versões batendo com o lockfile).
- `pnpm run typecheck`: **exit 0**, sem erro.
- `pnpm run test`: **1 arquivo, 4 testes, 4 passando**, ~180ms.
- `pnpm run build`: `dist/client` gerado sem erro —
  `index.html` 0,42 kB, `index-*.css` 0,23 kB, `index-*.js` 219,84 kB (gzip 68,71 kB).
- `pnpm run db:migrate:local`: "✅ No migrations to apply!" (já aplicada em execução
  anterior desta mesma sessão de trabalho; `.wrangler/state/v3/d1` local persiste entre
  comandos). `SELECT name FROM sqlite_master WHERE type='table'` lista as 10 tabelas de
  domínio (`rule_sets`, `protocols`, `guide_versions`, `validation_runs`,
  `validation_issues`, `tasks`, `workflow_events`, `evidence_objects`, `evidence_links`,
  `protocol_merges`) mais `d1_migrations`/`sqlite_sequence`/`_cf_METADATA` internos. O
  mesmo para `type='index'`: os 10 índices de `docs/PRD-SDD.md` §20 estão todos presentes.
- `wrangler whoami`: token OAuth válido, 5 contas Cloudflare autenticadas na máquina; usei
  `<account_id da conta Cloudflare, obtido com `wrangler whoami`>` (conta Cloudflare autenticada no wrangler) para o teste.
- `pnpm run dev` com `CLOUDFLARE_ACCOUNT_ID` exportado: sobe em ~8s, log mostra
  `env.DB`/`env.EVIDENCE`/`env.ASSETS` em modo `local` e `env.AI` em modo `remote`
  (proxy, aviso de possível cobrança de uso — esperado, nenhum recurso é criado), termina
  em `[wrangler:info] Ready on http://127.0.0.1:8787`.
- `GET /api/health`: **HTTP 200**,
  `{"status":"ok","app":"vitalis-barreira-glosas","bindings":{"DB":true,"EVIDENCE":true,"AI":true}}`.
- `GET /`: **HTTP 200**, serve o `index.html` da SPA (fallback de `env.ASSETS.fetch`
  funcionando). Servidor de dev encerrado ao final da verificação.

**Atenção — comportamento observado com o proxy RTK nesta sessão:** rodar `rtk pnpm typecheck`
(a forma que o hook `PreToolUse` normalmente substitui automaticamente no lugar de
`pnpm typecheck`) produziu 23 erros falsos (JSX, DOM, Node types faltando) porque a
chamada não repassou os dois `-p tsconfig.*.json` do script — caiu num `tsc --noEmit` sem
projeto, checando o `tsconfig.json` base contra todos os arquivos `.ts`/`.tsx` do
repositório de uma vez. Rodar o script real do `package.json` diretamente
(`pnpm run typecheck`, sem `rtk` na frente) dá exit 0, como acima. **Se um portão verde
de fase futura reportar erro de typecheck via RTK, rode `pnpm run typecheck` sem o
prefixo `rtk` antes de assumir regressão real** — ver §5.

## 3. Contratos publicados

- **Bindings do Worker** (nomes fixos para todas as fases seguintes): `DB` (D1,
  `database_name = vitalis-glosas`, declarado em `wrangler.jsonc`), `EVIDENCE` (R2,
  `bucket_name = vitalis-evidencias`, `wrangler.jsonc`), `AI` (Workers AI,
  `wrangler.jsonc`), `ASSETS` (Static Assets, `dist/client`, SPA fallback,
  `wrangler.jsonc`). Tipos correspondentes em `src/worker/index.ts` (`Env`).
- **Secrets declarados** (nomes fixos, sem valor real, documentados em `docs/CONFIG.md` e
  `.dev.vars.example`): `MCP_SECRETARIA_TOKEN`, `MCP_FINANCEIRO_TOKEN`,
  `LINK_SIGNING_KEY` — opcionais no tipo `Env` até a Fase 4 consumi-los.
- **Rota viva**: `GET /api/health` → `{ status, app, bindings: { DB, EVIDENCE, AI } }`.
  Qualquer outra rota é servida por `env.ASSETS.fetch` (SPA).
- **Schema D1** (`migrations/0001_init.sql`), 10 tabelas listadas em §1/§2 acima. Enums
  fechados por `CHECK`: `validation_status`/`result_status` (`OK`, `CORRIGIR`,
  `REVISAO_HUMANA`, `NAO_FATURAR_CONVENIO`), `workflow_status` (`EM_TRATAMENTO`,
  `LIBERADA_PARA_ENVIO`, `ENVIADA`, `ENCERRADA_PARTICULAR`, `ENCERRADA_CANCELADA`,
  `MESCLADA`), `actor_role`/`assigned_area`/`created_by_role`/`uploaded_by_role`
  (`SECRETARIA`, `FINANCEIRO`, `SISTEMA`), `ai_status` (`NAO_EXECUTADA`, `CONCLUIDA`,
  `FALHOU`). Migração é append-only: próxima mudança de schema é `0002_*.sql`, nunca
  edição do `0001`.
- **Versões fixadas** (`package.json`, sem `^`/`~`/`@latest`): lista completa em §1.
- **Fronteira de dependência marcada em disco**: `src/{domain,rules,application,http,
  infrastructure,mcp,ui}` já existem como diretórios, prontos para a Fase 1 em diante
  respeitar `ui/mcp/http → application → domain+rules` sem precisar criá-los.
- **Scripts npm fixos** (`package.json`): `typecheck`, `test`, `build`, `dev`,
  `db:migrate:local`, `seed:local` — nomes e comportamento não devem mudar sem registrar
  aqui, fases seguintes vão chamá-los pelo nome.

## 4. Decisões tomadas

- Git inicializado em `main`; `Posicionamento/` fora do índice desde o primeiro commit
  (confirmado: não aparece em `git ls-files`).
- XLSX é parseado no cliente (nunca no bundle do Worker) — decisão já registrada em
  `STATE.md`, mantida; nada de SheetJS existe no Worker nesta fase.
- Static Assets via `wrangler.jsonc`, sem Cloudflare Pages.
- `wrangler.jsonc` **não fixa `account_id`**: o repositório será público (porta de saída
  da Fase 5) e o `account_id` de produção é decisão do dono, na Fase 5. Para `pnpm dev`
  funcionar localmente sem travar — o binding `AI` sempre abre proxy remoto e a máquina
  de desenvolvimento tem 5 contas Cloudflare autenticadas simultaneamente (confirmado via
  `wrangler whoami` nesta sessão) — a seleção de conta em modo local é feita por
  `CLOUDFLARE_ACCOUNT_ID` como variável de ambiente do shell (nunca em `.dev.vars`, que só
  popula bindings do Worker, não o processo do Wrangler CLI). Documentado em
  `docs/CONFIG.md` e no comentário de `wrangler.jsonc`. Confirmado nesta sessão: usar a
  a conta Cloudflare autenticada (`<account_id da conta Cloudflare, obtido com `wrangler whoami`>`) resolve o `pnpm dev`
  local sem criar ou tocar recurso remoto nenhum — D1/R2/Assets continuam `local`; só o
  proxy do binding `AI` é aberto (com aviso de possível cobrança de uso, não de criação
  de recurso).
- `scripts/seed.ts` fica deliberadamente fora dos dois `tsconfig` (não é UI nem Worker) —
  decisão implícita do scaffold original, mantida por não ser problema hoje (placeholder
  de 2 linhas); a Fase 1, ao implementar o seed de verdade, decide se cria um terceiro
  `tsconfig` para `scripts/` ou inclui o arquivo em um dos existentes.

## 5. Dívidas e lacunas

- **Print privado ainda está no índice Git nesta sessão, não só no histórico.** O arquivo
  `screenshot-[genteegestao.expertintegrado.com.br]-20260920-093049.png` (nome real do
  dono e rubrica de avaliação do contratante) foi commitado no primeiro commit
  (`14335e2`). Nesta sessão o arquivo foi apagado do diretório de trabalho e
  `/screenshot-*.png` foi adicionado ao `.gitignore` — mas **isso por si só não remove o
  arquivo do índice Git**: medido agora, `git ls-files` ainda lista o arquivo (a remoção
  está pendente, sem stage, como `D` no `git status`) e `git cat-file -e HEAD:...` confirma
  que o blob **continua na árvore do commit atual** (`c08d6e6`). Ou seja: até o
  orquestrador rodar `git add`/`git commit` (fora do escopo desta tarefa, por regra), o
  arquivo formalmente **ainda aparece no índice Git** — a porta de saída da Fase 0 sobre
  material privado não está 100% atendida neste exato instante, só a caminho de ser
  (ver §6). Mesmo depois desse commit, o **blob permanece no histórico** (recuperável via
  `git show 14335e2`), e isso só se resolve reescrevendo o histórico (`git filter-repo` ou
  reinicializar o repositório) — operação destrutiva, decisão e execução do dono,
  obrigatória antes da Fase 5 tornar o repositório público (PRD §28 e §33). O arquivo
  original está preservado fora do projeto, em
  `C:/Users/bjr-c/Downloads/screenshot-[...].png`.
- `account_id` de produção continua indefinido — decisão do dono na Fase 5.
- `@cloudflare/vitest-pool-workers` não foi configurado: os 4 testes de fundação rodam em
  Vitest puro (Node), sem simular bindings de verdade. Fica para a fase que precisar de
  teste de integração real contra D1/R2 (fallback: teste de integração contra
  `wrangler dev` local, já documentado em `STATE.md`).
- **RTK (proxy de comandos do hook global) reescreve mal `pnpm typecheck` quando o comando
  chega como script composto** (`tsc ... && tsc ...`): observado nesta sessão que
  `rtk pnpm typecheck` cai num `tsc --noEmit` sem `-p`, varrendo o projeto inteiro com o
  `tsconfig.json` base (sem DOM/JSX/Node types) e produzindo 23 erros que não existem no
  portão real. `pnpm run typecheck` direto (sem `rtk`) dá exit 0. Registrar como risco de
  instrumento para as próximas fases, não como bug do projeto — ver `STATE.md`.
- `scripts/seed.ts` é placeholder (`console.log` + `exit(0)`), sem lógica — carga real é
  Fase 1, dentro do escopo dela.
- Nenhuma regra de negócio, motor de validação, UI de produto, MCP ou IA foi tocado nesta
  sessão — fora do escopo da Fase 0 (PRD §33) por definição.

## 6. Porta de saída (PRD §33, Fase 0) — resultado real

| Critério | Resultado |
|---|---|
| Aplicação local abre | **Atende.** `pnpm run dev` com `CLOUDFLARE_ACCOUNT_ID` exportado sobe em ~8s sem travar; `GET /api/health` responde HTTP 200 com os três bindings de dados `true`; `GET /` serve a SPA (HTTP 200). |
| Material privado não aparece no índice Git | **Parcial, com ressalva ativa.** `Posicionamento/` nunca esteve no índice (confirmado via `git ls-files`). Um print privado (`screenshot-[...]-20260920-093049.png`, contém nome real e rubrica de avaliação do dono) foi commitado no primeiro commit (`14335e2`) antes desta fase auditar o índice. Nesta sessão foi apagado do disco e bloqueado por `.gitignore`, mas **continua rastreado no índice Git atual** (`git ls-files` ainda o lista; a remoção está no `git status` como alteração não staged) até o orquestrador commitar a deleção. Mesmo depois disso, o blob permanece no histórico (`14335e2`) e só sai com reescrita de histórico — decisão destrutiva do dono, pendente antes da Fase 5. |
| Testes vazios e build executam | **Atende.** `pnpm run test` — 4/4 passando. `pnpm run build` — `dist/client` gerado sem erro (219,84 kB JS / 68,71 kB gzip). `pnpm run typecheck` sem erro (não é critério explícito da porta, mas parte do portão verde do `CLAUDE.md`). |
