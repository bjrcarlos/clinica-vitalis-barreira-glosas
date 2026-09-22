# Barreira de Glosas — Clínica Vitalis

**Aplicação no ar:** <https://vitalis-barreira-glosas.bjrcarlos04.workers.dev>
**Endpoint MCP:** `POST https://vitalis-barreira-glosas.bjrcarlos04.workers.dev/mcp` (Bearer por área)

Publicada em 22/09/2026 em Cloudflare Workers, com D1 (`vitalis-glosas`), R2 (`vitalis-evidencias`) e Workers AI. As 80 guias da prova foram carregadas pela própria rota de importação, com 80 linhas aceitas e nenhuma rejeitada.

Aplicação local Cloudflare Workers + React para conferir guias, bloquear liberações inseguras,
preservar versões/evidências e expor consulta controlada por MCP.

## Problema

A Clínica Vitalis fatura ~R$ 452 mil/mês em convênios e estima 8% disso em glosa, dos quais 40%
(~R$ 14,5 mil/mês) vêm de erro evitável: preenchimento incorreto ou autorização vencida que só
aparece quando o convênio devolve a cobrança, 45 a 90 dias depois. O erro nasce no intervalo entre
o lançamento da guia pela secretaria e o envio pelo financeiro — hoje sem verificação nenhuma
nesse meio. O produto atua exatamente aí: aplica as regras do convênio logo após o lançamento,
encaminha ambiguidade para quem decide e bloqueia o avanço enquanto houver pendência — sem
substituir o sistema atual da clínica. Detalhe completo do problema e da hipótese em
[`docs/PRD-SDD.md`](docs/PRD-SDD.md) §1–4.

## Decisão de arquitetura

Cloudflare Workers foi escolhido para hospedar interface, API e servidor MCP num único runtime.
D1 guarda protocolos/versões/eventos (dados relacionais com filtros e auditoria); R2 guarda
evidências e importações (arquivos, não linhas); Workers AI interpreta apenas texto livre da
recepção — nunca decide um estado de validação sozinho, e sua falha degrada para revisão humana
sem travar as regras determinísticas. Durable Objects, Queues, Workflows e KV foram
deliberadamente descartados: nenhum coordena concorrência, fila ou execução longa que justifique
o custo conceitual no volume desta prova (80 guias). Racional completo, com o que foi descartado e
por quê, em [`docs/PRD-SDD.md`](docs/PRD-SDD.md) §16–18.

## Executar localmente

```powershell
corepack pnpm install --frozen-lockfile
copy .dev.vars.example .dev.vars   # gere valores próprios (openssl rand -hex 32); nunca commite .dev.vars
corepack pnpm db:migrate:local
corepack pnpm seed:local
corepack pnpm dev --local --port 8787
```

`.dev.vars` é ignorado pelo Git — sem esse passo, `POST /api/session` (troca de identidade na SPA)
e toda chamada MCP falham, porque `LINK_SIGNING_KEY` e os tokens ficam indefinidos. `.dev.vars.example`
já documenta como gerar cada valor de teste.

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

## Não implementado nesta prova

Não objetivos declarados desde o PRD (`docs/PRD-SDD.md` §8) — nenhum destes foi construído:
substituição do sistema de gestão/prontuário, envio automático de guia ao convênio, decisão
financeira automatizada, ERP ou dashboard analítico amplo, gestão de usuários/OAuth de produção,
treino de modelo com feedback coletado, OCR/assinatura certificada/antivírus próprio, envio
automático do relatório semanal, e reversão de merge.

Gaps conhecidos desta execução, para o próximo a mexer no código:

- `POST /api/merges/commit` (`src/http/handlers/merges.ts`) não tem teste de integração
  dedicado — só há teste de schema/roteamento (`tests/http-contracts.test.ts`). A sequência
  grava a nova versão e revalida fora de uma única transação D1 atômica; falha no meio
  (ex.: revalidação) deixaria o protocolo principal já com versão nova mas sem o registro de
  merge nem o protocolo de origem marcado `MESCLADA`.
- A amostra de agosto não contém nenhuma guia com `data_lancamento` além do prazo do convênio
  (RN-09); `PRAZO_ENVIO_EXCEDIDO` existe, é determinístico e testado, mas só é demonstrável com
  uma guia colada via `verificar_guia` — ver [`docs/DEMO-ROTEIRO.md`](docs/DEMO-ROTEIRO.md).

## Demonstração

Roteiro completo (menos de cinco minutos, todos os casos do PRD §30.4) em
[`docs/DEMO-ROTEIRO.md`](docs/DEMO-ROTEIRO.md): relatório, liberação normal, correção com diff,
revisão humana, guia fora do convênio, duplicidade com merge, as duas tools MCP obrigatórias e a
Skill.

## Evidência da execução faseada

- [Estado](docs/PROGRESS/STATE.md)
- [Fase 0](docs/PROGRESS/phase-0-handoff.md)
- [Fase 1](docs/PROGRESS/phase-1-handoff.md)
- [Fase 2](docs/PROGRESS/phase-2-handoff.md)
- [Fase 3](docs/PROGRESS/phase-3-handoff.md)
- [Fase 4](docs/PROGRESS/phase-4-handoff.md)
- [Fase 5](docs/PROGRESS/phase-5-handoff.md)
