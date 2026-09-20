# Estado da execução — Barreira de Glosas Vitalis

Atualizado ao fim de cada fase. Quem começa uma fase lê: este arquivo, o handoff da fase anterior, `CLAUDE.md` e a seção do PRD da sua fase.

## Método

Execução faseada conforme `docs/PRD-SDD.md` §33–35. Cada fase roda com contexto zerado: agentes novos, sem memória das fases anteriores, alimentados apenas por este diretório e pelo código em disco. Dentro de cada fase, loop Ralph: implementar → verificar (`pnpm typecheck && pnpm test && pnpm build`) → reparar → repetir até verde, depois revisão adversarial contra a porta de saída da fase.

## Fases

| Fase | Objetivo | Estado |
|---|---|---|
| 0 | Fundação, scaffold, schema D1 | concluída com ressalvas (ver `phase-0-handoff.md` §5–6) |
| 1 | Núcleo determinístico e dados (80 guias) | não iniciada |
| 2 | Produto utilizável (relatório, lista, protocolo, correção) | não iniciada |
| 3 | Governança, evidência e merge | não iniciada |
| 4 | IA, MCP e Skill | não iniciada |
| 5 | Entrega, deploy e demonstração | não iniciada |

## Decisões técnicas tomadas

- Repositório Git inicializado em `main`; material privado (`Posicionamento/`) fora do índice.
- XLSX parseado no cliente para não inflar o bundle do Worker.
- Static Assets via `wrangler.jsonc` (`assets.directory = dist/client`), sem Pages.
- Deploy em conta Cloudflare só na Fase 5, com confirmação explícita do dono.
- `wrangler.jsonc` não fixa `account_id` (repositório público). Para `pnpm dev` funcionar
  com o binding `AI` (sempre remoto) quando há várias contas Cloudflare autenticadas na
  máquina, exportar `CLOUDFLARE_ACCOUNT_ID` como variável de ambiente do shell antes de
  rodar — não em `.dev.vars`. Detalhe em `docs/CONFIG.md`.
- Versões fixadas exatas no `package.json` (sem `^`/`~`/`@latest`), verificado lendo o
  arquivo na Fase 0: `react`/`react-dom` 19.3.0, `react-router-dom` 7.18.4, `zod` 4.6.5,
  `typescript` 7.0.2, `vite` 8.3.0, `wrangler` 4.135.0, `vitest` 5.0.1,
  `@cloudflare/workers-types` 5.20260920.1.

## Pendências de decisão do dono

- Deploy real (cria D1/R2/Worker na conta Cloudflare) — confirmar antes da Fase 5.
- **Histórico Git contém um print privado, e o índice atual ainda o rastreia.**
  `screenshot-[genteegestao.expertintegrado.com.br]-20260920-093049.png` foi commitado em
  `14335e2` (primeiro commit) antes de a Fase 0 auditar o índice. Nesta fase o arquivo foi
  apagado do diretório de trabalho e bloqueado por `.gitignore`, mas isso não some do
  índice sozinho: medido nesta sessão, `git ls-files` **ainda lista o arquivo** (a remoção
  está pendente de `git add`/commit, que é papel do orquestrador, não desta fase). Depois
  desse commit, o blob **continua no histórico** (visível via `git show 14335e2` a quem
  clonar). Reescrever histórico (`git filter-repo` ou reinicializar o repositório) é
  operação destrutiva — decisão e execução do dono, obrigatória antes de tornar o
  repositório público (porta de saída da Fase 5, PRD §28 e §33). Detalhe completo em
  `phase-0-handoff.md` §5.

## Riscos abertos

- `@cloudflare/vitest-pool-workers` pode ficar caro de configurar; fallback documentado é teste de integração contra `wrangler dev` local.
- Compatibilidade de versão entre `zod` e o MCP SDK precisa ser travada no lockfile na fase que introduzir o MCP.
- **RTK (hook global de proxy de comandos) reescreve mal `pnpm typecheck` quando o comando
  é um script composto** (`tsc -p a && tsc -p b`): medido na Fase 0, `rtk pnpm typecheck`
  caiu num `tsc --noEmit` sem `-p`, contra o `tsconfig.json` base, gerando 23 erros falsos
  em arquivos fora do escopo de cada tsconfig real. `pnpm run typecheck` direto (sem `rtk`)
  dá exit 0 — é o resultado que vale. Se um portão de fase futura reportar erro de
  typecheck via hook automático, rodar o script sem o prefixo `rtk` antes de assumir
  regressão real.
