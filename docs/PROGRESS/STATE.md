# Estado da execução — Barreira de Glosas Vitalis

Atualizado ao fim de cada fase. Quem começa uma fase lê: este arquivo, o handoff da fase anterior, `CLAUDE.md` e a seção do PRD da sua fase.

## Método

Execução faseada conforme `docs/PRD-SDD.md` §33–35. Cada fase roda com contexto zerado: agentes novos, sem memória das fases anteriores, alimentados apenas por este diretório e pelo código em disco. Dentro de cada fase, loop Ralph: implementar → verificar (`pnpm typecheck && pnpm test && pnpm build`) → reparar → repetir até verde, depois revisão adversarial contra a porta de saída da fase.

## Fases

| Fase | Objetivo | Estado |
|---|---|---|
| 0 | Fundação, scaffold, schema D1 | concluída com ressalvas (ver `phase-0-handoff.md` §5–6) |
| 1 | Núcleo determinístico e dados (80 guias) | concluída com ressalvas (ver `phase-1-handoff.md` §7–8) |
| 2 | Produto utilizável (relatório, lista, protocolo, correção) | concluída com ressalvas (ver `phase-2-handoff.md` §7–8) |
| 3 | Governança, evidência e merge | concluída localmente (ver `phase-3-handoff.md`) |
| 4 | IA, MCP e Skill | concluída localmente, IA remota pendente (ver `phase-4-handoff.md`) |
| 5 | Entrega, deploy e demonstração | gate local aprovado; deploy remoto pendente de autoridade (ver `phase-5-handoff.md`) |

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
- Fase 1: seed determinístico (`scripts/seed.ts`) gera SQL a partir dos casos de uso reais
  (`registrarGuia`+`validarGuia`) com adapters em memória, nunca fala com D1 direto; reexecução
  é segura porque o SQL gerado limpa e reinsere as tabelas do seed e as tabelas de governança
  dependentes, dentro de uma transação. Ids internos do seed são derivados do `id_guia` de origem (nunca
  `crypto.randomUUID()`), para o SQL sair byte-a-byte igual a cada execução — confirmado nesta
  sessão com `diff` entre duas execuções.
- Fase 1: nesta fase nenhum problema de validação é `bloqueante: false` — todo `Problema` vira
  uma `Tarefa` bloqueante (RF-09 exige zero pendência aberta para liberar); granularidade mais
  fina de bloqueio fica para fase futura, se necessário.
- Fase 2: as 9 rotas de `/api/*` (PRD §24) estão implementadas e testadas ponta a ponta contra
  `wrangler dev` local (relatório, lista, detalhe, cadastro, correção, liberação, importação,
  regras, sessão) — nenhuma decide regra de negócio, todas chamam o motor/casos de uso da Fase 1.
  Detalhe completo, exemplos reais de resposta e o mapa de telas em `phase-2-handoff.md` §1–4.
- Fase 2: identidade da demonstração via cookie HttpOnly assinado com HMAC-SHA256
  (`LINK_SIGNING_KEY`), papel resolvido uma vez por requisição no roteador
  (`src/http/routes.ts`) e injetado em todo handler — nenhum handler de mutação lê papel do
  corpo, exceto `POST /api/session` (propósito da rota). Ver `phase-2-handoff.md` §3.3 para onde
  a Fase 3 engancha o mesmo padrão em envio/encerramento.
- Fase 2: dependência nova `read-excel-file@9.3.10` (exata), só no bundle do cliente, carregada
  por `import()` dinâmico — converte `.xlsx` para CSV e reusa `parseCsv` (Fase 1) em vez de um
  segundo parser. `src/application/import/parse-csv.ts` (Fase 1) foi movido para
  `src/domain/parse-csv.ts` (função pura, a UI precisava importá-la sem violar
  `ui → application → domain+rules`).
- Fase 2: a duplicidade-contra-si-mesma de `registrarGuia` foi corrigida na origem: a busca de
  candidatos acontece antes da criação da versão inicial, e cadastro/importação usam o repositório
  real. O wrapper histórico permanece apenas como código legado sem uso.
- Fase 3: as rotas de evidência, envio, encerramento, revisão e merge estão integradas ao Worker;
  o detalhe carrega evidências, merge e envio. O seed limpa também vínculos/objetos de evidência e
  merges antes de restaurar a demonstração.
- Fase 4: o MCP é um endpoint JSON-RPC stateless compatível com o contrato do PRD, sem dependência
  de SDK externo no lockfile; a IA usa schema estruturado e fallback conservador quando o binding
  local não está disponível.
- Fase 5: workflows Ralph por fase, handoffs, README e Skill estão versionados; não houve deploy
  remoto porque a conta, IDs de produção e autorização do proprietário não foram fornecidos.

## Pendências de decisão do dono

- Deploy real (cria D1/R2/Worker na conta Cloudflare) — confirmar antes da publicação remota.
- **Histórico Git contém um print privado.** O arquivo não está no índice atual, mas o blob
  continua no histórico do commit `14335e2`; reescrever histórico antes de publicação pública
  é decisão destrutiva do dono.
  `screenshot-[genteegestao.expertintegrado.com.br]-20260920-093049.png` foi commitado em
  `14335e2` (primeiro commit) antes de a Fase 0 auditar o índice. Nesta fase o arquivo foi
  apagado do diretório de trabalho e bloqueado por `.gitignore`; o índice atual não o lista.
  Depois desse commit, o blob **continua no histórico** (visível via `git show 14335e2` a quem
  clonar). Reescrever histórico (`git filter-repo` ou reinicializar o repositório) é
  operação destrutiva — decisão e execução do dono, obrigatória antes de tornar o
  repositório público (porta de saída da Fase 5, PRD §28 e §33). Detalhe completo em
  `phase-0-handoff.md` §5.

## Riscos abertos

- `@cloudflare/vitest-pool-workers` pode ficar caro de configurar; fallback documentado é teste de integração contra `wrangler dev` local. Fase 1 cobriu os repositórios D1 contra `node:sqlite` + migração real (`tests/repositories.test.ts`), o que reduz a urgência mas não substitui o runtime do Worker.
- Compatibilidade de versão entre `zod` e o MCP SDK precisa ser travada no lockfile na fase que introduzir o MCP.
- `docs/BASELINE.md` foi reconciliado com a correção de duplicidade e deve ser lido junto ao
  handoff da Fase 1 para distinguir a análise histórica dos números atuais do seed.
- A causa de auto-duplicidade em `registrarGuia` foi corrigida: candidatos são buscados antes da
  criação da versão inicial e cadastro/importação usam o repositório real.
- **RTK (hook global de proxy de comandos) reescreve mal `pnpm typecheck` quando o comando
  é um script composto** (`tsc -p a && tsc -p b`): medido na Fase 0, `rtk pnpm typecheck`
  caiu num `tsc --noEmit` sem `-p`, contra o `tsconfig.json` base, gerando 23 erros falsos
  em arquivos fora do escopo de cada tsconfig real. `pnpm run typecheck` direto (sem `rtk`)
  dá exit 0 — é o resultado que vale. Se um portão de fase futura reportar erro de
  typecheck via hook automático, rodar o script sem o prefixo `rtk` antes de assumir
  regressão real.
- O wrapper `semAutoDuplicidade` permanece como legado sem uso nas rotas; a aplicação não depende
  mais dele para evitar auto-duplicidade.
- **Nenhum commit da Fase 2 foi feito** — o repositório já tem histórico (4 commits, até
  `dcb962b` da Fase 1), mas toda a Fase 2 existe só como *working tree* não commitado (handlers,
  contrato HTTP, identidade, UI, testes novos — `git status --short` no fim da Fase 2 lista a
  árvore completa). Ninguém commitou por instrução explícita do orquestrador em ambas as fases.
  Até o primeiro commit acontecer, qualquer `git checkout -- .`/`reset --hard` acidental perderia
  todo o trabalho desta fase sem deixar rastro em nenhum commit — decisão de quando commitar é
  do orquestrador, não desta fase.
- **`.playwright-mcp/` e `.vitest/`** (diretórios não rastreados, provavelmente artefato de
  ferramenta) não estão no `.gitignore` — risco de serem commitados por engano no primeiro
  commit da Fase 2 se ninguém decidir antes.
