# Handoff — Fase 2 (Produto utilizável)

Medido em disco, por execução real dos comandos e por chamada HTTP real contra `wrangler dev`
local nesta sessão (21/09/2026). Escrito para quem chega sem nenhum contexto e vai construir a
Fase 3 (evidência em R2, envio, encerramento particular/cancelado, merge de duplicidade). Node
`v24.14.0`, pnpm `9.15.0`, wrangler `4.135.0` — mesmo ambiente da Fase 1.

Esta fase foi implementada por vários agentes em paralelo, cada um dono de um subconjunto de
arquivos (contrato HTTP, handlers, identidade, UI por tela). Este handoff é escrito por um
agente separado, cuja única tarefa foi medir o resultado e documentá-lo — nada aqui foi escrito
por quem implementou.

## 1. O que ficou pronto

**Contrato HTTP** (`src/http/`):

- `contracts.ts` — todo esquema Zod de entrada/saída de `/api/*` (PRD §24), com os tipos
  `z.infer` que a UI importa. Registra os 12 códigos de problema, os 9 tipos de evento e os 4
  códigos de requisito de liberação como unions fechados, sempre espelhando o domínio (Fase 1),
  nunca redeclarando uma lista paralela.
- `routes.ts` — roteador interno (casa método + `:param`), resolve o papel da sessão uma vez por
  requisição a partir do cookie assinado, converte `ZodError`/`ErroDominio` em
  `{ erro: { codigo, mensagem } }` com o status certo, trata 404/405.
- `handlers/report.ts` — `GET /api/report`.
- `handlers/protocols-list.ts` — `GET /api/protocols`.
- `handlers/protocol-detail.ts` — `GET /api/protocols/:numero`.
- `handlers/create-protocol.ts` — `POST /api/protocols`; também exporta `carregarRegrasAtivas`,
  `buscarResumoWire` e `semAutoDuplicidade`, reaproveitados por `create-version.ts`, `imports.ts`
  e `rules.ts`.
- `handlers/create-version.ts` — `POST /api/protocols/:numero/versions`.
- `handlers/release.ts` — `POST /api/protocols/:numero/release`.
- `handlers/imports.ts` — `POST /api/imports`.
- `handlers/rules.ts` — `GET /api/rules`.
- `handlers/session.ts` — `POST /api/session`.

**Identidade da demonstração** (`src/infrastructure/auth/session.ts`): cookie HttpOnly assinado
com HMAC-SHA256 (WebCrypto, `crypto.subtle.sign`/`verify`, tempo constante), payload
`{ p, iat, exp }` em base64url. Sem cookie válido, papel resolve para `DIRECAO` (leitura). Ver §3.

**Worker** (`src/worker/index.ts`): registra as 9 rotas reais no roteador (o comentário
"handler não implementado" logo acima do bloco é resíduo do andaime da Fase 0/1 e está
desatualizado — nenhuma rota cai mais nele; ver §5).

**UI** (`src/ui/`, 3721 linhas somadas): 8 páginas + ~35 componentes/arquivos de suporte. Mapa
completo em §3.4. Nenhuma decide regra de negócio — todas leem `/api/*` e exibem; `TravaLiberacao`,
`AcoesProtocolo` e `ProblemasProtocolo` documentam explicitamente no próprio arquivo que o servidor
decidiu, elas só exibem.

**Novos testes** (`tests/`, 4 arquivos, ~64 casos novos — ver §2): `format.test.ts` (formatação
de data/moeda/rótulo), `http-contracts.test.ts` (validação dos esquemas Zod), `report.test.ts`
(reconciliação `/api/report` × `/api/protocols` filtrado), `write-handlers.test.ts` (papel
incorreto → 403; correção sem justificativa rejeitada; correção cria v2 sem tocar v1; liberação
bloqueada devolve motivo; reimportação não duplica).

**Dependência nova**: `read-excel-file@9.3.10` (exata, só `dependencies`, nunca importada pelo
Worker — `src/ui/components/entrada/xlsxCliente.ts` carrega via `import()` dinâmico, só quando um
`.xlsx` é de fato selecionado). Justificativa registrada no próprio arquivo: converte a planilha
para texto CSV e reusa `parseCsv` (Fase 1) em vez de reimplementar o parser para um segundo
formato de entrada.

**Reorganização da Fase 1**: `src/application/import/parse-csv.ts` foi movido para
`src/domain/parse-csv.ts` (a UI precisava importar uma função pura do parser sem violar
`ui → application → domain+rules`; `parseCsv` não tem I/O e pertence ao domínio). Contrato de
`parseCsv` não mudou, só o caminho do arquivo.

**Nenhuma migração nova**: schema D1 é o mesmo `migrations/0001_init.sql` das Fases 0/1 (10
tabelas, 11 índices). `evidence_objects`, `evidence_links` e `protocol_merges` continuam vazias —
Fase 3.

## 2. Como verificar

```bash
cd "C:/Users/bjr-c/Downloads/Clinica Vitalis"
pnpm install
pnpm exec tsc --noEmit -p tsconfig.app.json      # separado do worker (RTK corrompe o comando composto)
pnpm exec tsc --noEmit -p tsconfig.worker.json
pnpm run test
pnpm run build
pnpm run db:migrate:local
pnpm run seed:local
CLOUDFLARE_ACCOUNT_ID=<sua conta> pnpm run dev    # pegue o id com `pnpm exec wrangler whoami`
```

**Resultado real medido nesta sessão:**

- `pnpm exec tsc --noEmit -p tsconfig.app.json`: **"TypeScript: No errors found"**.
- `pnpm exec tsc --noEmit -p tsconfig.worker.json`: **"TypeScript: No errors found"**.
  (`pnpm run typecheck`, que roda os dois em sequência com `&&`, dá o mesmo resultado — rodei os
  dois separados só para confirmar o aviso do orquestrador; não houve corrupção desta vez.)
- `pnpm run test`: **9 arquivos, 117 testes, 117 passando** (53 da Fase 1 + ~64 novos desta
  fase), ~925ms.
- `pnpm run build`: `dist/client` gerado sem erro — `index-*.js` 359,72 kB / gzip 108,89 kB,
  `browser-*.js` (chunk separado do `read-excel-file`, só baixado sob demanda) 66,23 kB / gzip
  18,70 kB, CSS 44,83 kB / gzip 8,54 kB.
- `pnpm run dev` (com `CLOUDFLARE_ACCOUNT_ID` exportado): sobe em `http://127.0.0.1:8788`, os 8
  bindings resolvem (`DB`/`EVIDENCE` local, `AI` remoto, `ASSETS`, os 3 secrets de `.dev.vars`).
  `GET /api/health` responde `{"status":"ok", ..., "bindings":{"DB":true,"EVIDENCE":true,"AI":true}}`.

**As 9 rotas foram exercitadas de verdade nesta sessão** (servidor local rodando, chamadas HTTP
reais via `fetch`, não só leitura de código) — sequência completa em §3.1, incluindo o ciclo
relatório → detalhe → correção → nova validação → liberação. Depois de testar, rodei
`pnpm run seed:local` de novo para devolver o D1 local ao estado pristino de 80 protocolos (§6)
— **quem abrir o D1 local agora encontra o baseline original, não os dados de teste desta sessão**
(confirmado: `GET /api/report` depois do reseed voltou a `guias_verificadas: 80`,
`risco_inicial_cents: 372600`, igual à Fase 1).

## 3. Contratos publicados

### 3.1 As 9 rotas — método, papel, entrada, saída, exemplo real

Toda rota mora sob `/api`, valida entrada e saída com Zod (`src/http/contracts.ts`), e devolve
erro no formato `{ erro: { codigo, mensagem } }` (nunca stack trace). Papel vem exclusivamente do
cookie assinado (`ctx.papel`) — nenhum handler de mutação lê papel do corpo, exceto
`POST /api/session`, cujo propósito é justamente esse.

| Rota | Papel exigido | Entrada | Saída |
|---|---|---|---|
| `GET /api/report` | qualquer (leitura) | — | `RelatorioResposta` |
| `GET /api/protocols` | qualquer (leitura) | query: `status_validacao`, `status_fluxo`, `area` (CSV), `unidade`, `convenio`, `data_atendimento_inicio/fim`, `busca`, `pagina`, `tamanho` (todos opcionais) | `ListaProtocolosResposta` (paginado) |
| `GET /api/protocols/:numero` | qualquer (leitura) | `:numero` (`VT-YY-NNNN`) | `ProtocoloDetalheResposta` |
| `POST /api/protocols` | `SECRETARIA` | `{ guia: GuiaBrutaWire }` | `CadastrarProtocoloResposta`, `201` |
| `POST /api/protocols/:numero/versions` | `SECRETARIA` | `{ guia: GuiaBrutaWire, motivo: string }` | `CriarVersaoResposta`, `201` |
| `POST /api/protocols/:numero/release` | `FINANCEIRO` | corpo vazio (`{}`) | `LiberarProtocoloResposta` |
| `POST /api/imports` | `SECRETARIA` | `{ formato: "csv", nome_arquivo, conteudo_csv }` ou `{ formato: "json", nome_arquivo, linhas: GuiaBrutaWire[] }` | `ImportarGuiasResposta`, `201` |
| `GET /api/rules` | qualquer (leitura) | — | `RegrasAtivasResposta` |
| `POST /api/session` | qualquer (é o próprio mecanismo de troca) | `{ papel: "SECRETARIA" \| "FINANCEIRO" \| "DIRECAO" }` | `{ papel, expira_em_utc }` + `Set-Cookie` |

Exemplos abaixo são respostas reais de chamadas feitas nesta sessão contra `wrangler dev` local
com os 80 protocolos semeados (não inventadas, não copiadas de teste).

**`GET /api/report`** (truncado — a resposta completa tem os 80 números em `protocol_numbers` de
cada bloco):

```json
{
  "gerado_em_utc": "2026-09-21T04:16:20.019Z",
  "regras_aplicadas": { "versao": "agosto/2026", "sha256": "8fed8225f516d3ac212e3bb853f028047188f56599f32a4dcdc3773db7cbf68f" },
  "guias_verificadas": { "valor": 80, "protocol_numbers": ["VT-26-0001", "..."] },
  "exigem_atencao": { "valor": 51, "protocol_numbers": ["VT-26-0002", "..."] },
  "risco_inicial_cents": { "valor": 372600, "protocol_numbers": ["VT-26-0002", "..."] },
  "risco_tratado_cents": { "valor": 0, "protocol_numbers": [] },
  "risco_pendente_cents": { "valor": 372600, "protocol_numbers": ["VT-26-0002", "..."] },
  "principais_motivos": [
    { "codigo": "OBSERVACAO_NAO_INTERPRETADA", "titulo": "Observação da recepção ainda não foi interpretada", "ocorrencias": 36, "protocol_numbers": ["..."] },
    { "codigo": "AUTORIZACAO_VENCIDA", "titulo": "Autorização vencida antes do atendimento", "ocorrencias": 13, "protocol_numbers": ["..."] },
    { "codigo": "CAMPO_OBRIGATORIO_AUSENTE", "ocorrencias": 8, "protocol_numbers": ["..."] },
    { "codigo": "LIMITE_SESSOES_EXCEDIDO", "ocorrencias": 6, "protocol_numbers": ["..."] },
    { "codigo": "PROCEDIMENTO_NAO_COBERTO", "ocorrencias": 5, "protocol_numbers": ["..."] },
    { "codigo": "POSSIVEL_DUPLICIDADE", "ocorrencias": 2, "protocol_numbers": ["VT-26-0057", "VT-26-0076"] }
  ],
  "distribuicao_por_area": [
    { "area": "FINANCEIRO", "quantidade_tarefas_abertas": 43, "risco_cents": 205600, "pendencia_mais_antiga_utc": "2026-09-01T00:00:00.000Z", "protocol_numbers": ["..."] },
    { "area": "SECRETARIA", "quantidade_tarefas_abertas": 27, "risco_cents": 167000, "pendencia_mais_antiga_utc": "2026-09-01T00:00:00.000Z", "protocol_numbers": ["..."] }
  ],
  "pendencias_mais_antigas": [
    { "numero_protocolo": "VT-26-0002", "id_guia_origem": "G-2608-0002", "unidade": "Sul", "status_validacao": "NAO_FATURAR_CONVENIO", "resumo": "Encontrado 2 problemas: o procedimento não é coberto por este convênio...", "area_responsavel": "FINANCEIRO", "risco_cents": 9000, "aberta_desde_utc": "2026-09-01T00:00:00.000Z" }
  ]
}
```

**`GET /api/protocols`** sem filtro nenhum → `paginacao: { pagina: 1, tamanho: 20, total: 80,
total_paginas: 4 }` — confirma "a lista sem filtro mostra tudo" (as 80 existem, a página só
limita quantas vêm de uma vez; `?tamanho=100` traria as 80 numa chamada). Primeiro item:

```json
{
  "numero_protocolo": "VT-26-0001", "id_guia_origem": "G-2608-0001", "unidade": "Sul",
  "data_atendimento": "2026-08-28", "paciente": "P-1036", "convenio": "Vitalcard",
  "carteirinha": "884410270", "procedimento_codigo": "50000470",
  "procedimento_descricao": "Sessão de fisioterapia musculoesquelética",
  "status_validacao": "OK",
  "resumo_validacao": "Guia sem pendências: campos, cobertura, autorização e sessões conferem com a regra vigente. Pronta para liberação.",
  "status_fluxo": "EM_TRATAMENTO", "area_responsavel": null, "risco_cents": 0,
  "numero_versao_atual": 1, "atualizado_em_utc": "2026-09-01T00:00:00.000Z"
}
```

**`GET /api/protocols/:numero`** (`VT-26-0006`, 3 problemas simultâneos — mesmo caso do exemplo
da Fase 1): `trava_liberacao` devolvida:

```json
{
  "pode_liberar": false,
  "motivo": "Travada: faltam 4 requisitos — a versão atual da guia está com status ok.; não há problema aberto nesta guia.; não há revisão humana pendente.; não há tarefa bloqueante aberta..",
  "requisitos": [
    { "codigo": "VALIDACAO_ATUAL_OK", "descricao": "A versão atual da guia está com status OK.", "atendido": false },
    { "codigo": "SEM_PROBLEMA_ABERTO", "descricao": "Não há problema aberto nesta guia.", "atendido": false },
    { "codigo": "SEM_REVISAO_HUMANA_PENDENTE", "descricao": "Não há revisão humana pendente.", "atendido": false },
    { "codigo": "SEM_TAREFA_BLOQUEANTE_ABERTA", "descricao": "Não há tarefa bloqueante aberta.", "atendido": false }
  ]
}
```

**Ciclo completo testado nesta sessão** (`POST /api/session` → `POST /api/protocols/:numero/release`
sem cookie → `POST /api/protocols/:numero/versions` → `POST .../release`):

1. Sem cookie (`DIRECAO` por padrão), `POST /api/protocols/VT-26-0001/release` → **`403`**
   `{"erro":{"codigo":"ROLE_NOT_ALLOWED","mensagem":"Somente o Financeiro pode liberar guias para envio."}}`.
2. `POST /api/session {"papel":"FINANCEIRO"}` → `200` + `Set-Cookie: vitalis_sessao=...; HttpOnly; SameSite=Lax`.
3. Com o cookie de Financeiro, `POST /api/protocols/VT-26-0001/release` (protocolo já `OK`) →
   **`200`**, `status_fluxo` vira `"LIBERADA_PARA_ENVIO"`.
4. Repetir a mesma chamada → **`409`** `{"erro":{"codigo":"INVALID_STATE_TRANSITION","mensagem":"Protocolo não está em tratamento; liberação não se aplica neste estado."}}`.
5. Com o mesmo cookie de Financeiro, `POST /api/protocols` (rota de Secretaria) → **`403`**
   `ROLE_NOT_ALLOWED` — confirma que o papel é por rota, não por sessão inteira.
6. `POST /api/session {"papel":"SECRETARIA"}`, depois `POST /api/protocols/VT-26-0014/versions`
   com `{ guia: {...autorizacao_validade: "2026-08-20" em vez de "2026-07-27"...}, motivo: "Autorização revalidada por telefone com o convênio." }`
   (protocolo estava `CORRIGIR` por `AUTORIZACAO_VENCIDA`) → **`201`**:
   ```json
   {
     "protocolo": { "numero_protocolo": "VT-26-0014", "status_validacao": "OK", "status_fluxo": "EM_TRATAMENTO", "risco_atual_cents": 0, "risco_inicial_cents": 7000, "numero_versao_atual": 2, "...": "..." },
     "versao": { "numero_versao": 2, "diff": [{ "campo": "autorizacao_validade", "valor_anterior": "2026-07-27", "valor_novo": "2026-08-20" }], "...": "..." },
     "resultado_validacao": { "status": "OK", "resumo": "Guia sem pendências...", "problemas": [], "risco_cents": 0, "...": "..." }
   }
   ```
   Confirma: nova versão (v2), diff correto, motor revalidou, `risco_inicial_cents` (7000)
   preservado enquanto `risco_atual_cents` caiu para 0 — a versão 1 nunca foi alterada
   (histórico append-only, RF-10).
7. Com o cookie de Financeiro de volta, `POST /api/protocols/VT-26-0014/release` → **`200`**,
   `status_fluxo` vira `"LIBERADA_PARA_ENVIO"` — a trava reagiu à correção sem intervenção manual.
8. `POST /api/protocols` com corpo `{ guia: { id_guia: "X" } }` (faltando os outros 17 campos) →
   **`422`** `{"erro":{"codigo":"VALIDATION_ERROR","mensagem":"guia.unidade: Invalid input: expected string, received undefined"}}`.
9. `POST /api/imports` com um CSV de 1 linha nova (`G-TEST-0001`) → **`201`**
   `{"linhas_aceitas":1,"linhas_rejeitadas":[],"protocolos_criados":[{"numero_protocolo":"VT-26-0081","id_guia_origem":"G-TEST-0001"}],"protocolos_ja_existentes":[]}`.

Depois deste ciclo, rodei `pnpm run seed:local` de novo — o D1 local voltou ao estado pristino
(§2, §6); os passos 1–9 acima não deixaram rastro para quem abrir o banco agora.

**`GET /api/rules`** (`convenios[0]`, um dos 3):

```json
{
  "nome": "Vitalcard",
  "campos_obrigatorios": ["numero_autorizacao", "autorizacao_validade", "profissional_registro", "carteirinha", "cid"],
  "validade_maxima_autorizacao_dias": 30, "limite_sessoes_por_autorizacao": 10,
  "procedimentos_cobertos": ["50000470", "50000560", "50000012", "20103301"],
  "prazo_envio_dias": 30,
  "observacao": "Reavaliação médica obrigatória a cada 10 sessões; nova autorização a cada reavaliação."
}
```

### 3.2 Trava de liberação (RF-09) — onde é calculada, duas vezes, propositalmente

A trava é recalculada em dois lugares que **precisam ficar em sincronia** (comentário já deixado
em `release.ts` avisando disso):

1. `protocol-detail.ts` (`GET /api/protocols/:numero`) — calcula `trava_liberacao` para exibição.
2. `release.ts` (`POST /api/protocols/:numero/release`) — recalcula os mesmos 4 requisitos antes
   de decidir se libera de fato, e nunca confia no que a interface mandou (a interface nem manda
   nada — corpo é `{}` por contrato).

Os quatro requisitos, sempre contados por protocolo (todas as execuções de validação já
gravadas, não só a da versão atual — depois de uma correção, o handler de correção já marcou
`RESOLVIDO`/`RESOLVIDA` tudo que era da versão anterior):

- `VALIDACAO_ATUAL_OK` — `protocols.validation_status = 'OK'`.
- `SEM_PROBLEMA_ABERTO` — nenhuma `validation_issues.status = 'ABERTO'` para o protocolo.
- `SEM_REVISAO_HUMANA_PENDENTE` — nenhuma issue aberta com `recommended_action = 'REVISAR'`.
- `SEM_TAREFA_BLOQUEANTE_ABERTA` — nenhuma `tasks.status = 'ABERTA' AND blocking = 1`.

`pode_liberar` é `AND` dos quatro; quando falso, `motivo` lista os que faltam em português. Um
protocolo bloqueado por tarefa devolve `OPEN_BLOCKING_TASKS`; os demais motivos (validação não-OK,
problema aberto, revisão pendente) devolvem `GUIDE_NOT_READY` — escolha desta fase, documentada
em `release.ts`, já que o CLAUDE.md fixa os dois códigos sem dizer qual cobre qual caso.

### 3.3 Identidade funcional e cookie assinado

- `src/infrastructure/auth/session.ts` — `assinarSessao`/`verificarSessao` (HMAC-SHA256 via
  WebCrypto), `PayloadSessao = { p, iat, exp }` em base64url, `NOME_COOKIE_SESSAO =
  "vitalis_sessao"`, duração padrão 12h. `lerPapelDaRequisicao` nunca lança — qualquer falha
  (sem cookie, sem `LINK_SIGNING_KEY`, assinatura inválida, expirado) resolve para `DIRECAO`.
- `src/http/routes.ts`, dentro de `Roteador.despachar` — chama `lerPapelDaRequisicao` **uma vez
  por requisição**, antes de despachar para o handler, e injeta o resultado em `ctx.papel`. Nenhum
  handler lê o cookie diretamente.
- `src/http/handlers/session.ts` — única rota que lê `papel` do corpo (é o próprio propósito:
  trocar de identidade). Devolve `Set-Cookie` via `construirCabecalhoSetCookie`.
- Cada handler de mutação faz `if (papel !== "X") throw new ErroDominio("ROLE_NOT_ALLOWED", ...)`
  logo no início, antes de tocar em qualquer dado — ver `create-protocol.ts` linha 120,
  `create-version.ts` linha 107, `release.ts` linha 56, `imports.ts` linha 100.

**Onde a Fase 3 engancha o mesmo padrão para envio e encerramento**: quando existirem
`POST /api/protocols/:numero/send` (ou nome equivalente) e
`POST /api/protocols/:numero/close`, cada handler novo repete exatamente o padrão acima —
`if (ctx.papel !== "FINANCEIRO") throw new ErroDominio("ROLE_NOT_ALLOWED", ...)` (ou o papel que
o PRD definir para essas ações) como primeira linha da função núcleo, e lê `ctx.papel` do
roteador, nunca do corpo. Não é preciso tocar `session.ts` nem `routes.ts` — a mecânica de
identidade já está pronta e é agnóstica ao número de rotas que a consultam.

### 3.4 Mapa das telas — arquivo → rota → referência visual

| Arquivo | Rota da SPA | Tela de referência |
|---|---|---|
| `src/ui/pages/Relatorio.tsx` | `/` | `design-reference/Relatorio.dc.html` |
| `src/ui/pages/Dashboard.tsx` | `/dashboard` | `design-reference/Dashboard.dc.html` |
| `src/ui/pages/Guias.tsx` | `/guias` | `design-reference/Guias.dc.html` |
| `src/ui/pages/Protocolo.tsx` | `/protocolos/:numero` | `design-reference/Protocolo.dc.html` |
| `src/ui/pages/Pendencias.tsx` | `/pendencias` | `design-reference/Pendencias.dc.html` |
| `src/ui/pages/Importar.tsx` | `/importar` | `design-reference/Importar.dc.html` |
| `src/ui/pages/NovaGuia.tsx` | `/nova-guia` | `design-reference/NovaGuia.dc.html` |
| `src/ui/pages/Regras.tsx` | `/regras` | `design-reference/Regras.dc.html` |

`Merge.dc.html` (a nona tela do design-reference) **não tem rota nesta fase** — merge de
duplicidade é RF-13/Fase 3, fora de escopo aqui por contrato do orquestrador; a tela de
referência existe, mas nada em `src/ui/routes.tsx` aponta para ela ainda.

`src/ui/routes.tsx` tem um comentário de cabeçalho dizendo que "cada página é hoje um
placeholder" — **isso está desatualizado** (resíduo do início da fase, quando as páginas de fato
ainda não existiam): as 8 páginas têm conteúdo real, ligado a `/api/*`, com estado de
carregamento/erro e ações (ver §5, dívida de documentação).

Composição da tela de protocolo (`Protocolo.tsx`, a mais rica): busca `GET /api/protocols/:numero`
uma vez, guarda em estado, e renderiza em ordem fixa `CabecalhoProtocolo` → `TravaLiberacao`
(só quando bloqueada) → `ProblemasProtocolo` → `VersaoAtualProtocolo` → `EvidenciasProtocolo`
(placeholder consciente, §4) → `HistoricoProtocolo` → `AcoesProtocolo` (liberar/corrigir).
Corrigir chama `POST .../versions` e recarrega o detalhe inteiro sem reload de página; liberar
chama `POST .../release` e recarrega do mesmo jeito.

## 4. Pontos de extensão já deixados para a Fase 3

- **Evidência na importação**: `imports.ts` já calcula `sha256Hex` do conteúdo (CSV ou JSON) e
  grava esse hash no evento `IMPORTACAO` de cada linha — mas o comentário no próprio arquivo
  (linhas 202–206) marca exatamente onde persistir o arquivo original: `await
  env.EVIDENCE.put(`importacoes/${hash}`, conteudoOriginal)`, vinculando via
  `evidence_objects`/`evidence_links` (tabelas já existem, vazias). `hash` já é a chave certa a
  reusar, não precisa recalcular.
- **Área de evidências no protocolo**: `src/ui/components/protocolo/EvidenciasProtocolo.tsx`
  (19 linhas) é um placeholder deliberado — um `Card` com `EstadoVazio` dizendo "ainda não fazem
  parte desta etapa", já posicionado no lugar certo da tela (`Protocolo.tsx`, entre versão atual e
  histórico). `GET /api/protocols/:numero` desta fase nem carrega esse dado — a Fase 3 precisa
  estender `esquemaProtocoloDetalheResposta` com uma lista de evidências antes de trocar este
  componente por um real.
- **Ações de envio e encerramento**: nenhuma rota, nenhum botão. `AcoesProtocolo.tsx` só tem
  "Liberar para envio" e "Corrigir" — quando a Fase 3 adicionar `POST .../send` e
  `POST .../close`, o padrão de botão-desabilitado-com-motivo-ao-lado de "Liberar" (nunca
  esconder a ação, só desabilitar e explicar) é o mesmo a repetir.
- **Papel MCP**: `Env.MCP_SECRETARIA_TOKEN`/`MCP_FINANCEIRO_TOKEN` já existem em `.dev.vars` e no
  tipo `Env` (`src/http/routes.ts`), mas nada os lê ainda — `src/mcp/tools/` continua com só
  `.gitkeep`. Fora de escopo desta fase (Fase 4).
- **Merge de duplicidade**: `POSSIVEL_DUPLICIDADE` já é emitido pelo motor (2 pares nos 80
  protocolos, §6) e a listagem/relatório já excluem `workflow_status = 'MESCLADA'` de toda soma
  (comentário explícito em `report.ts`) — mas nenhum protocolo pode chegar a esse estado ainda;
  não há rota, tela (`Merge.dc.html` sem rota, §3.4) nem lógica de fusão.

## 5. Decisões tomadas

- **`semAutoDuplicidade`** (`create-protocol.ts`): a Fase 1 deixou documentado (phase-1-handoff
  §8) que `registrarGuia` cria o protocolo antes de checar duplicidade, fazendo um cadastro novo
  bater a própria chave composta contra si mesmo em D1 real (o seed não pegava isso por comparar
  identidade de objeto em memória). Consertar `register-guide.ts`/`ports.ts` estava fora do
  escopo desta fase (arquivo de outro agente/fase). Em vez disso, `POST /api/protocols` e
  `POST /api/imports` envolvem `repos.versoes` num wrapper que filtra o próprio registro por
  igualdade estrutural do payload antes de repassar candidatos ao motor.
  `POST /api/protocols/:numero/versions` (que já conhece o `protocoloId`) filtra por identidade
  direta, sem precisar do wrapper. **A causa raiz em `register-guide.ts` continua sem conserto**
  — ver §7.
- **Correção liberada volta a `EM_TRATAMENTO`** (`create-version.ts`): uma correção sobre um
  protocolo `LIBERADA_PARA_ENVIO` reabre o fluxo para `EM_TRATAMENTO` — decisão desta fase (nenhum
  código anterior definia isso), porque a leitura de "pronta para envio" anterior à correção não
  vale mais para dados que acabaram de mudar.
- **`OPEN_BLOCKING_TASKS` vs `GUIDE_NOT_READY`** (`release.ts`): o CLAUDE.md fixa os dois códigos
  sem dizer qual cobre qual caso de bloqueio de liberação. Escolha desta fase: tarefa bloqueante
  aberta → `OPEN_BLOCKING_TASKS`; qualquer outro motivo (validação não-OK, problema aberto,
  revisão pendente) → `GUIDE_NOT_READY`.
- **Reconciliação do relatório com a lista é por filtro de campo, não por lista literal de IDs**
  (`src/ui/components/relatorio/links.ts`): o contrato fixado de `GET /api/protocols` filtra por
  `status_validacao`/`status_fluxo`/`area` (nunca por uma lista arbitrária de
  `numero_protocolo`), então cada bloco do relatório linka para `/guias` com o filtro que
  reproduz o MESMO conjunto (ex. "exigem atenção" é sempre `status_validacao != OK`). A API já
  devolve `protocol_numbers` explícito em cada métrica (§3.1) — está lá para reconciliação
  programática/depuração e para a Fase 3 decidir se algum dia vale adicionar um filtro por lista
  de IDs ao contrato, mas a UI desta fase não o consome para montar o link. Suposição declarada
  no próprio arquivo.
- **`parseCsv` movido para `src/domain/`**: função pura, sem I/O — pertence à camada isenta da
  regra de dependência do CLAUDE.md, e a UI precisava importá-la sem violar
  `ui → application → domain+rules`.
- **`GET /api/rules` ganhou `convenios`/`procedimentos`/`definicoes`** além de versão/hash: a UI
  precisava desse catálogo para "Nova guia"/"Regras" e a alternativa (ler
  `regras_convenio.json.txt`/`src/rules` direto no bundle do cliente) violaria a mesma regra de
  dependência. Uma única leitura de `rule_sets.source_json`, reaproveitada de
  `carregarRegrasAtivas`, nunca uma segunda fonte da verdade.
- **`read-excel-file@9.3.10`** como única dependência nova — justificativa e forma de carregamento
  em §1.

## 6. Números reais do relatório hoje e como reproduzi-los

Idênticos aos da Fase 1 (nenhuma regra de negócio mudou nesta fase — só interface e HTTP sobre o
motor já existente), reconfirmados nesta sessão contra `GET /api/report` ao vivo:

| Métrica | Valor |
|---|---:|
| Guias verificadas | 80 |
| Exigem atenção | 51 |
| Risco inicial | R$ 3.726,00 (372.600 centavos) |
| Risco tratado | R$ 0,00 |
| Risco pendente | R$ 3.726,00 |
| `OK` | 29 |
| `REVISAO_HUMANA` | 34 |
| `CORRIGIR` | 12 |
| `NAO_FATURAR_CONVENIO` | 5 |
| Tarefas abertas — Financeiro | 43 (risco R$ 2.056,00) |
| Tarefas abertas — Secretaria | 27 (risco R$ 1.670,00) |

Reproduzir do zero:

```bash
cd "C:/Users/bjr-c/Downloads/Clinica Vitalis"
pnpm run db:migrate:local
pnpm run seed:local
CLOUDFLARE_ACCOUNT_ID=<sua conta> pnpm run dev
# em outro terminal:
node -e "fetch('http://127.0.0.1:8788/api/report').then(r=>r.json()).then(j=>console.log(j.guias_verificadas.valor, j.exigem_atencao.valor, j.risco_inicial_cents.valor))"
```

O ciclo de teste desta sessão (§3.1, passos 1–9) alterou temporariamente `VT-26-0001`,
`VT-26-0014` e criou `VT-26-0081`; `pnpm run seed:local` ao final devolveu o banco a este
baseline exato — confirmado por nova chamada a `/api/report` depois do reseed.

## 7. Estado da porta de saída (PRD §33, Fase 2) — resultado real

| Critério | Resultado |
|---|---|
| Relatório → detalhe → correção → nova validação | **Atende, testado ponta a ponta nesta sessão** (§3.1, passos 6–7): `GET /api/report` lista pendências antigas com `numero_protocolo`; `GET /api/protocols/:numero` traz a trava e o motivo; `POST .../versions` cria v2, calcula diff, revalida (`AUTORIZACAO_VENCIDA` → `OK`); a UI (`Protocolo.tsx`) chama exatamente essas rotas e recarrega o detalhe sem reload de página. |
| Botão de liberação explica por que está bloqueado | **Atende.** `AcoesProtocolo.tsx`: o botão "Liberar para envio" existe sempre (nunca escondido), fica `disabled` quando `!trava.pode_liberar`, e `trava.motivo` aparece ao lado (`aria-describedby`). O motivo é 100% do servidor (`protocol-detail.ts`/`release.ts`, §3.2) — testado com `VT-26-0006` (bloqueado, motivo com os 4 requisitos) e `VT-26-0001`/`VT-26-0014` (liberação real, `200`, muda `status_fluxo`). Segunda tentativa de liberar o mesmo protocolo devolve `409 INVALID_STATE_TRANSITION`, não um 200 silencioso. |
| Lista sem filtro mostra tudo | **Atende.** `GET /api/protocols` sem query string devolveu `paginacao.total = 80` nesta sessão (medido, não assumido) — as 80 existem, só a paginação (`tamanho` padrão 20) limita quantas vêm por página; `total_paginas` confirma as 4 páginas de 20. |

## 8. Dívidas e limitações conhecidas

- **Comentários desatualizados em dois arquivos de andaime, deixados por quem escreveu a
  mecânica antes dos handlers/páginas reais existirem**: `src/worker/index.ts` (bloco
  `handlerNaoImplementado`, hoje morto — nenhuma rota cai nele) e `src/ui/routes.tsx`
  ("cada página é hoje um placeholder", hoje falso — 8 páginas com conteúdo real). Não são bugs
  funcionais (o roteador real e as páginas reais são os que de fato executam), mas confundem
  quem ler o arquivo antes do código abaixo dele. Não corrigidos aqui — são arquivos de outros
  agentes desta mesma fase, fora do escopo desta tarefa (só documentação).
- **`registrarGuia` (`src/application/register-guide.ts`) continua checando duplicidade DEPOIS
  de criar o protocolo** (achado da Fase 1, não corrigido na Fase 1 nem nesta). O sintoma está
  contido nesta fase por `semAutoDuplicidade` (wrapper local em `create-protocol.ts`, §5), que
  filtra o falso positivo contra si mesmo antes do motor rodar — mas a causa raiz no caso de uso
  de aplicação não foi tocada (fora do escopo de arquivo desta tarefa). Quem mexer em
  `register-guide.ts`/`ports.ts` numa fase futura deve saber que dois handlers HTTP dependem hoje
  do wrapper de contorno, não da correção de ordem.
- **Reconciliação relatório↔lista é por filtro de campo, não pela lista literal de
  `protocol_numbers`** que a própria API já devolve (§5) — funciona porque os critérios hoje
  coincidem exatamente (ex. nenhum protocolo `OK` carrega risco), mas é uma suposição declarada,
  não uma garantia estrutural; se uma regra de negócio futura desalinhar os dois critérios, o
  clique no bloco do relatório pode não trazer exatamente o mesmo conjunto que compôs o número.
- **`.playwright-mcp/` e `.vitest/`** apareceram como diretórios não rastreados no `git status`
  desta sessão e não estão no `.gitignore` — provavelmente artefato de ferramenta rodada durante
  o desenvolvimento desta fase, não parte do produto. Quem fizer o próximo commit deve decidir
  se ignora ou remove antes de versionar, para não commitar cache de ferramenta por engano.
- **Sem migração nova**: confirmado nesta sessão (`ls migrations/` só lista `0001_init.sql` e o
  `README.md`) — a Fase 2 não precisou de coluna nova. `evidence_objects`/`evidence_links`/
  `protocol_merges` seguem com schema pronto e zero linhas.
- **Todas as dívidas da Fase 1 que não eram bloqueadoras continuam válidas e não foram
  revisitadas** (não fazia parte do escopo desta fase): `DATA_FORA_DO_PADRAO` código morto,
  `src/rules/observation.ts` ramo com IA inalcançável, `@cloudflare/vitest-pool-workers` não
  configurado (testes de handler desta fase usam o mesmo adaptador `node:sqlite` de
  `tests/repositories.test.ts`, não o pool real do Worker), print privado no histórico Git —
  detalhe completo em `phase-1-handoff.md` §8 e `phase-0-handoff.md` §5–6, ainda pendentes de
  decisão do dono.
- **Nenhum commit foi feito desta fase** — `git status` no fim desta sessão mostra toda a Fase 2
  como *working tree* não commitado (modificações + arquivos novos, ver lista completa em
  `git status --short`). Não commitei por instrução explícita do orquestrador ("nada de git
  add/commit/push"); fica para quem o orquestrador designar.
