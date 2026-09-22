# Barreira de Glosas — Clínica Vitalis

Aplicação local Cloudflare Workers + React para conferir guias, bloquear liberações inseguras,
preservar versões/evidências e expor consulta controlada por MCP.

## Executar localmente

```powershell
corepack pnpm install --frozen-lockfile
corepack pnpm db:migrate:local
corepack pnpm seed:local
corepack pnpm dev --local --port 8787
```

O Worker fica em `http://127.0.0.1:8787`. A sessão visual de demonstração é criada por
`POST /api/session` com `{"papel":"SECRETARIA"}`, `{"papel":"FINANCEIRO"}` ou
`{"papel":"DIRECAO"}`. O cookie é HttpOnly e assinado por `LINK_SIGNING_KEY`.

## Verificação

```powershell
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
```

O seed oficial carrega 80 guias e pode ser repetido; ele também limpa evidências e merges locais
antes de recarregar o domínio, permitindo restaurar o estado da demonstração.

## MCP

O endpoint stateless é `POST /mcp` usando `Authorization: Bearer ...`. Os tokens locais ficam em
`.dev.vars` e nunca devem ser commitados ou exibidos. As cinco tools são:

- `consultar_regra`
- `verificar_guia`
- `registrar_guia` (somente Secretaria)
- `minhas_pendencias`
- `consultar_historico`

`verificar_guia` não persiste. A Skill operacional está em
[`skills/conferir-guia-vitalis/SKILL.md`](skills/conferir-guia-vitalis/SKILL.md) e exige confirmação
explícita antes de registrar uma guia.

## Limites importantes

- IA só interpreta observação e retorna schema validado; falha vira revisão humana.
- MCP não corrige, libera, envia, encerra ou mescla.
- Evidências ficam no R2 privado, com hash e links HMAC temporários.
- Deploy remoto não foi executado automaticamente: exige conta, `database_id`, secrets e
  autorização do proprietário. O comando preparado é `corepack pnpm exec wrangler deploy` depois da configuração de
  produção descrita em [`docs/CONFIG.md`](docs/CONFIG.md).
- O histórico Git inicial contém um screenshot privado no commit `14335e2`; o arquivo não está
  no índice atual, mas a remoção histórica precisa ser decidida pelo dono antes de publicar o
  repositório. Não reescreva o histórico sem autorização explícita.

## Evidência da execução faseada

- [Estado](docs/PROGRESS/STATE.md)
- [Fase 0](docs/PROGRESS/phase-0-handoff.md)
- [Fase 1](docs/PROGRESS/phase-1-handoff.md)
- [Fase 2](docs/PROGRESS/phase-2-handoff.md)
- [Fase 3](docs/PROGRESS/phase-3-handoff.md)
- [Fase 4](docs/PROGRESS/phase-4-handoff.md)
- [Fase 5](docs/PROGRESS/phase-5-handoff.md)
