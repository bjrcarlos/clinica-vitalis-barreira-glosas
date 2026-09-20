# Estado da execução — Barreira de Glosas Vitalis

Atualizado ao fim de cada fase. Quem começa uma fase lê: este arquivo, o handoff da fase anterior, `CLAUDE.md` e a seção do PRD da sua fase.

## Método

Execução faseada conforme `docs/PRD-SDD.md` §33–35. Cada fase roda com contexto zerado: agentes novos, sem memória das fases anteriores, alimentados apenas por este diretório e pelo código em disco. Dentro de cada fase, loop Ralph: implementar → verificar (`pnpm typecheck && pnpm test && pnpm build`) → reparar → repetir até verde, depois revisão adversarial contra a porta de saída da fase.

## Fases

| Fase | Objetivo | Estado |
|---|---|---|
| 0 | Fundação, scaffold, schema D1 | não iniciada |
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

## Pendências de decisão do dono

- Deploy real (cria D1/R2/Worker na conta Cloudflare) — confirmar antes da Fase 5.

## Riscos abertos

- `@cloudflare/vitest-pool-workers` pode ficar caro de configurar; fallback documentado é teste de integração contra `wrangler dev` local.
- Compatibilidade de versão entre `zod` e o MCP SDK precisa ser travada no lockfile na fase que introduzir o MCP.
