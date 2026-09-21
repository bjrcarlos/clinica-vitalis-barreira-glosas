# Handoff — Fase 1 (Núcleo determinístico e dados)

Medido em disco, por execução real de comando e por consulta direta ao D1 local nesta sessão
(20/09/2026). Escrito para quem chega sem nenhum contexto e vai construir a Fase 2 (interface,
rotas HTTP, upload). Node `v24.14.0`, pnpm `9.15.0`, wrangler `4.135.0`.

## 1. O que ficou pronto

**Domínio puro** (`src/domain/`, zero I/O):

- `statuses.ts` — os quatro enums ASCII do contrato (`ValidacaoStatus`, `FluxoStatus`, `Area`,
  `Origem`), guardas de tipo `isValidacaoStatus`/`isFluxoStatus`/`isArea`/`isOrigem`, a ordem de
  precedência `PRECEDENCIA_VALIDACAO_STATUS` e funções `apresentar*` (só aqui existe acento).
- `guide.ts` — `GuiaBruta` (texto cru) e `GuiaNormalizada` (18 campos tipados, espelham o
  cabeçalho de `guias.csv`) e `AvisoNormalizacao`.
- `normalize.ts` — `normalizarGuia(bruta): { guia, avisos }`, pura, nunca lança.
- `rule-set.ts` — tipos `ConjuntoRegras`, `RegraConvenio`, `RegraProcedimento`, `DefinicoesRegras`.
- `validation.ts` — `CodigoProblema` (os 12 códigos fixados), `Subproblema`, `Problema`,
  `Tarefa`, `ResultadoValidacao`, `CandidatoDuplicidade`.
- `events.ts` — `EventoFluxo`, `TipoEvento` (auditoria append-only).

**Motor de regras puro** (`src/rules/`, zero I/O, sem D1/fetch/relógio):

- `rule-set.ts` — `montarConjuntoRegras(textoOriginal, sha256)`: valida `regras_convenio.json`
  com Zod e devolve um `ConjuntoRegrasIndexado` (busca por nome de convênio tolerante a
  acento/caixa, por código de procedimento, e `regraAplicavel(convenio, procedimento)`).
- `engine.ts` — `validarGuia(guia, ruleSet, candidatosDuplicidade, interpretacaoIA?)`: motor
  determinístico completo, ordem de avaliação igual ao PRD §21.3.
- `coverage.ts`, `required-fields.ts`, `authorization.ts`, `sessions.ts`, `procedure.ts`,
  `duplicates.ts`, `observation.ts` — uma checagem por arquivo, cada uma chamada pelo `engine.ts`
  na ordem certa; nenhuma duplica lógica de outra.

**Camada de aplicação** (`src/application/`, orquestra, não decide regra):

- `ports.ts` — interfaces que a infraestrutura implementa: `Relogio`, `GeradorId`, `Protocolos`,
  `Versoes`, `Validacoes`, `Tarefas`, `Eventos`, `ConjuntosDeRegras`.
- `register-guide.ts` — caso de uso `registrarGuia`: abre protocolo + versão inicial, idempotente
  por `id_guia` de origem, depois chama `validarGuia` (caso de uso).
- `validate-guide.ts` — caso de uso `validarGuia`: roda o motor injetado, grava execução, tarefas
  e evento `VALIDACAO`.
- `import/parse-csv.ts` — `parseCsv(texto)`: parser CSV próprio (sem dependência externa),
  valida cabeçalho contra `CABECALHO_GUIA_CSV`, rejeita linha por linha quando a contagem de
  campos diverge, nunca a importação inteira por uma linha ruim.

**Infraestrutura D1** (`src/infrastructure/`, implementa as portas acima):

- `clock.ts` — `RelogioReal` (produção) e `RelogioFixo` (testes/seed).
- `id.ts` — `GeradorIdCrypto` (UUID v4), `anoUtcDoisDigitos`, `formatarNumeroProtocolo`,
  `PROXIMO_SEQUENCIAL_PROTOCOLO_SQL` (fragmento SQL que deriva o sequencial dentro do próprio
  `INSERT`, sem corrida entre registros concorrentes).
- `rules/load-rule-set.ts` — `carregarESalvarConjuntoRegras(texto, db, relogio, geradorId)`:
  ativa a versão de regra vigente em `rule_sets`, idempotente por hash.
- `d1/protocols.ts`, `d1/versions.ts`, `d1/validations.ts`, `d1/tasks.ts`, `d1/events.ts`,
  `d1/rule-sets.ts` — uma implementação D1 por porta (`RepositorioProtocolosD1`,
  `RepositorioVersoesD1`, `RepositorioValidacoesD1`, `RepositorioTarefasD1`,
  `RepositorioEventosD1`, `RepositorioConjuntosDeRegrasD1`).
- `d1/repositories.ts` — `criarRepositoriosD1(db, ids, relogio): RepositoriosD1`, monta os seis
  repositórios de uma vez, prontos para injetar num handler HTTP ou tool MCP.

**Dados e testes**:

- `scripts/seed.ts` — gera `.wrangler/seed/seed.sql` determinístico a partir de
  `regras_convenio.json.txt` + `guias.csv`, usando os casos de uso reais (`registrarGuia` +
  `validarGuia`) com adapters em memória; nunca fala com D1 diretamente.
- `tests/rule-set.test.ts`, `tests/normalize.test.ts`, `tests/engine.test.ts`,
  `tests/repositories.test.ts` — 49 testes novos desta fase (mais os 4 de `tests/fundacao.test.ts`
  da Fase 0 = 53 no total), incluindo um controle negativo explícito (`engine.test.ts`, teste 11:
  falha se a inclusividade de RN-03 for sabotada) e um teste de integração real contra D1 via
  `node:sqlite` carregando a migração de verdade (`tests/repositories.test.ts`).
- `docs/BASELINE.md` — reconciliação PRD §14 × D1 semeado, escrito por outro agente em paralelo
  a este handoff. **Está desatualizado no ponto central (§3.2/§4, ver §5 abaixo deste
  documento) — o código já corrige o que o arquivo descreve como bug pendente.** Não editado por
  esta tarefa (fora da lista de arquivos autorizados); os números corretos e atuais estão em §2 e
  §4 deste handoff, medidos direto no D1 nesta sessão.

Achado registrado mas não corrigido nesta tarefa (fora de escopo, comentário already deixado por
quem escreveu `scripts/seed.ts` em `duplicates`/`VersoesMemoria`, linhas 316–334): a ordem de
chamadas em `register-guide.ts` (`criarComVersaoInicial` roda antes de
`listarCandidatosDuplicidade`) faz com que, ao rodar contra `RepositorioVersoesD1` de verdade
(nunca contra o seed, que usa exclusão por identidade de referência em memória), um protocolo
recém-criado sempre bata sua própria chave composta contra si mesmo, gerando
`POSSIVEL_DUPLICIDADE` da guia contra ela mesma. Ver §5 (dívidas) para o detalhe e o conserto
sugerido — relevante para quem em Fase 2/3 ligar `registrarGuia` a `RepositorioVersoesD1`.

## 2. Como verificar

```bash
cd "C:/Users/bjr-c/Downloads/Clinica Vitalis"
pnpm install
pnpm run typecheck          # tsc --noEmit -p tsconfig.app.json && -p tsconfig.worker.json
pnpm run test                # vitest run
pnpm run build                # vite build (dist/client) + tsc --noEmit worker
pnpm run db:migrate:local    # aplica migrations/0001_init.sql (idempotente)
pnpm run seed:local          # gera .wrangler/seed/seed.sql e aplica no D1 local
pnpm exec wrangler d1 execute DB --local --command "SELECT COUNT(*) FROM protocols;"
```

Se `pnpm typecheck`/`pnpm run typecheck` vier reescrito pelo hook RTK e explodir em dezenas de
erros de DOM/JSX fora de contexto, rode o script direto sem `rtk` na frente — risco de
instrumento já registrado em `phase-0-handoff.md` §2/§5, reconfirmado nesta sessão.

**Resultado real medido nesta sessão:**

- `pnpm install`: resolve sem erro, sem alterar versões do lockfile.
- `pnpm run typecheck`: **exit 0**.
- `pnpm run test`: **5 arquivos, 53 testes, 53 passando**, ~450ms.
- `pnpm run build`: `dist/client` gerado sem erro (`index-*.js` 219,84 kB / gzip 68,71 kB — igual
  à Fase 0, nada de UI foi tocado).
- `pnpm run db:migrate:local`: "No migrations to apply!" — schema da Fase 0 já presente e
  íntegro (10 tabelas + 11 índices confirmados por `sqlite_master`).
- `pnpm run seed:local`: aplica sem erro. Saída do gerador (`node scripts/seed.ts`, antes do
  `wrangler d1 execute`):
  ```
  Regras aplicadas: agosto/2026 (sha256 8fed8225f516…)
  Relógio fixo do seed: 2026-09-01T00:00:00.000Z
  Guias processadas: 80 (protocolos criados: 80)
  Por status de validação:
    OK                    : 28
    CORRIGIR              : 12
    REVISAO_HUMANA        : 35
    NAO_FATURAR_CONVENIO  : 5
  Risco total (current_risk_cents somado): 378800 centavos
  SQL gerado em: .../.wrangler/seed/seed.sql (250203 bytes)
  ```
- **Determinismo confirmado nesta sessão**: rodei `scripts/seed.ts` duas vezes (saída padrão e
  `--out C:/tmp/seed_run2.sql`) e comparei com `diff` — **arquivos byte-a-byte idênticos**.
- `SELECT COUNT(*) FROM protocols` → **80**. `guias.csv` tem 80 linhas de dados (81 com
  cabeçalho) e o parser não rejeitou nenhuma (`rejeitadas: []` — confirmado lendo o script; o
  `main()` de `scripts/seed.ts` lança erro se a contagem não for exatamente 80 ou se houver
  rejeitada).

## 3. Contratos publicados

### 3.1 Assinaturas que a Fase 2 vai chamar

| Função | Arquivo | Assinatura |
|---|---|---|
| Motor puro | `src/rules/engine.ts` | `validarGuia(guia: GuiaNormalizada, ruleSet: ConjuntoRegras, candidatosDuplicidade: readonly CandidatoDuplicidade[], interpretacaoIA?: InterpretacaoObservacaoIA \| null): ResultadoValidacao` |
| Conjunto de regras | `src/rules/rule-set.ts` | `montarConjuntoRegras(textoOriginal: string, sha256: string): ConjuntoRegrasIndexado` |
| Normalização | `src/domain/normalize.ts` | `normalizarGuia(bruta: GuiaBruta): { guia: GuiaNormalizada; avisos: AvisoNormalizacao[] }` |
| Parser CSV | `src/domain/parse-csv.ts` (movido de `src/application/import/` na auditoria da Fase 2 — função pura, a UI já precisava reaproveitá-la e `domain` é a camada isenta da regra de dependência do CLAUDE.md) | `parseCsv(texto: string): { linhas: readonly GuiaBruta[]; rejeitadas: readonly { numero_linha: number; motivo: string }[] }` |
| Caso de uso: registrar guia | `src/application/register-guide.ts` | `registrarGuia(entrada: RegistrarGuiaEntrada, deps: RegistrarGuiaDependencias): Promise<RegistrarGuiaSaida>` — `RegistrarGuiaSaida` é discriminado por `jaExistia: boolean` (idempotente por `idGuiaOrigem`) |
| Caso de uso: validar guia | `src/application/validate-guide.ts` | `validarGuia(entrada: ValidarGuiaEntrada, deps: ValidarGuiaDependencias): Promise<ValidarGuiaSaida>` — **atenção**: mesmo nome do motor puro acima, módulo diferente; injeta o motor via `deps.motor: MotorValidacao` |
| Regras + persistência | `src/infrastructure/rules/load-rule-set.ts` | `carregarESalvarConjuntoRegras(textoOriginal: string, db: D1Database, relogio: Relogio, geradorId: GeradorId): Promise<RegraCarregada>` |
| Fábrica de repositórios D1 | `src/infrastructure/d1/repositories.ts` | `criarRepositoriosD1(db: D1Database, ids: GeradorId, relogio: Relogio): RepositoriosD1` (`{ protocolos, versoes, validacoes, tarefas, eventos, conjuntosDeRegras }`) |
| Relógio | `src/infrastructure/clock.ts` | `new RelogioReal()` (produção) / `new RelogioFixo(instanteUtc: string)` (testes) |
| Gerador de id | `src/infrastructure/id.ts` | `new GeradorIdCrypto()` |

Um handler HTTP ou tool MCP da Fase 2/4 típico monta:
`criarRepositoriosD1(env.DB, new GeradorIdCrypto(), new RelogioReal())` e injeta em
`registrarGuia`/`validarGuia` (aplicação) exatamente como `scripts/seed.ts` faz com os adapters
em memória — a diferença é só a implementação da porta, nunca o caso de uso.

### 3.2 Formato de `ResultadoValidacao`, `Problema`, `Subproblema`, `Tarefa`

Definições em `src/domain/validation.ts`:

```ts
interface Subproblema { rotulo: string; valor: string; }

interface Problema {
  codigo: CodigoProblema;               // um dos 12 códigos estáveis, ver §3.3
  titulo: string;                       // texto de tela, pode mudar
  acao_recomendada: "CORRIGIR" | "REVISAR" | "NAO_FATURAR";
  area_responsavel: "SECRETARIA" | "FINANCEIRO";
  subproblemas: readonly Subproblema[];
  referencia_regra: string;             // caminho dentro do conjunto de regras, ex. "convenios.Vitalcard.limite_sessoes_por_autorizacao"
}

interface Tarefa {
  tipo: string;        // == Problema.codigo, quando originada de um problema
  titulo: string;
  area: "SECRETARIA" | "FINANCEIRO" | "SISTEMA";
  bloqueante: boolean; // sempre true nesta fase (RF-09: qualquer problema aberto impede liberação)
}

interface ResultadoValidacao {
  status: "OK" | "CORRIGIR" | "REVISAO_HUMANA" | "NAO_FATURAR_CONVENIO";
  resumo: string;                        // frase pronta para tela, já leva em conta status/áreas
  problemas: readonly Problema[];
  tarefas: readonly Tarefa[];
  risco_cents: number;                   // valor_cents da guia, uma única vez, nunca somado por problema
  regras_aplicadas: { versao: string; sha256: string; referencias: readonly string[] };
}
```

**Exemplo real serializado** — protocolo `VT-26-0006` (`id_guia` de origem `G-2608-0006`),
consultado direto no D1 local semeado nesta sessão. A guia normalizada (`guide_versions.
normalized_payload_json`):

```json
{
  "id_guia": "G-2608-0006", "unidade": "Norte", "data_atendimento": "2026-08-12",
  "paciente": "P-1046", "convenio": "Vitalcard", "carteirinha": "685868185", "cid": "M25.5",
  "procedimento_codigo": "40201015", "procedimento_descricao": "Infiltração articular",
  "numero_autorizacao": "AUT802287", "autorizacao_validade": "2026-08-22",
  "autorizacao_sessoes_limite": 10, "sessao_numero_na_autorizacao": 15,
  "profissional": "Dr. Renato Albuquerque", "profissional_registro": "CRM-SP 84512",
  "valor_cents": 14000, "observacao_recepcao": "Paciente chegou 10 min atrasado.",
  "data_lancamento": "2026-08-15"
}
```

`ResultadoValidacao` correspondente (`validation_runs`/`validation_issues`, reconstruído em
formato de domínio — três problemas, um protocolo, risco contado uma única vez):

```json
{
  "status": "NAO_FATURAR_CONVENIO",
  "resumo": "Encontrado 3 problemas: o procedimento não é coberto por este convênio, então não pode ser faturado a ele. Próximo passo: Financeiro e Secretaria decide entre faturar como particular ou cancelar.",
  "problemas": [
    {
      "codigo": "PROCEDIMENTO_NAO_COBERTO",
      "titulo": "Vitalcard não cobre este procedimento",
      "acao_recomendada": "NAO_FATURAR",
      "area_responsavel": "FINANCEIRO",
      "subproblemas": [
        { "rotulo": "procedimento", "valor": "40201015 — Infiltração articular" },
        { "rotulo": "convênio", "valor": "Vitalcard" }
      ],
      "referencia_regra": "convenios.Vitalcard.procedimentos_cobertos"
    },
    {
      "codigo": "LIMITE_SESSOES_EXCEDIDO",
      "titulo": "Sessão excede o limite de sessões da autorização",
      "acao_recomendada": "CORRIGIR",
      "area_responsavel": "SECRETARIA",
      "subproblemas": [
        { "rotulo": "sessão registrada", "valor": "15" },
        { "rotulo": "limite informado na guia", "valor": "10" },
        { "rotulo": "limite oficial do convênio", "valor": "10" }
      ],
      "referencia_regra": "convenios.Vitalcard.limite_sessoes_por_autorizacao"
    },
    {
      "codigo": "OBSERVACAO_NAO_INTERPRETADA",
      "titulo": "Observação da recepção ainda não foi interpretada",
      "acao_recomendada": "REVISAR",
      "area_responsavel": "FINANCEIRO",
      "subproblemas": [
        { "rotulo": "texto original da observação", "valor": "Paciente chegou 10 min atrasado." }
      ],
      "referencia_regra": "observacao_recepcao (sem interpretacao de IA)"
    }
  ],
  "tarefas": [
    { "tipo": "PROCEDIMENTO_NAO_COBERTO", "titulo": "Vitalcard não cobre este procedimento", "area": "FINANCEIRO", "bloqueante": true },
    { "tipo": "LIMITE_SESSOES_EXCEDIDO", "titulo": "Sessão excede o limite de sessões da autorização", "area": "SECRETARIA", "bloqueante": true },
    { "tipo": "OBSERVACAO_NAO_INTERPRETADA", "titulo": "Observação da recepção ainda não foi interpretada", "area": "FINANCEIRO", "bloqueante": true }
  ],
  "risco_cents": 14000,
  "regras_aplicadas": { "versao": "agosto/2026", "sha256": "8fed8225f516d3ac212e3bb853f028047188f56599f32a4dcdc3773db7cbf68f", "referencias": ["convenios.Vitalcard.procedimentos_cobertos", "convenios.Vitalcard.limite_sessoes_por_autorizacao", "observacao_recepcao (sem interpretacao de IA)"] }
}
```

Note o `status` final: `NAO_FATURAR_CONVENIO` vence sobre `CORRIGIR` e `REVISAO_HUMANA` pela
precedência de `PRECEDENCIA_VALIDACAO_STATUS` (RN-06), mesmo havendo problemas dos três tipos. O
`risco_cents` é **14000** (o `valor_cents` da própria guia) e não 42000 — contado uma vez, nunca
por problema (RN-05).

### 3.3 Os doze códigos de problema — significado em linguagem de tela

| Código | Ação | Área | Quando aparece / o que significa para quem está na tela |
|---|---|---|---|
| `CONVENIO_DESCONHECIDO` | Revisar | Secretaria | O convênio digitado na guia não existe no conjunto de regras vigente — checar grafia ou se é convênio novo ainda não cadastrado. |
| `PROCEDIMENTO_DESCONHECIDO` | Revisar | Secretaria | O código do procedimento não existe no conjunto de regras vigente. |
| `CAMPO_OBRIGATORIO_AUSENTE` | Corrigir | Secretaria | Falta um campo que **este convênio** (não todos) exige — o(s) subproblema(s) listam qual(is). |
| `PROCEDIMENTO_NAO_COBERTO` | Não faturar | Financeiro | O convênio existe e o procedimento existe, mas este convênio não cobre este procedimento — não pode ser faturado a ele; financeiro decide particular ou cancelamento (RN-07). |
| `AUTORIZACAO_VENCIDA` | Corrigir | Secretaria | A autorização já tinha vencido na data do atendimento (comparação inclusiva — vencer no mesmo dia não conta, RN-03). |
| `AUTORIZACAO_VALIDADE_ACIMA_DO_MAXIMO` | Revisar | Secretaria | A janela entre atendimento e validade é maior que o máximo que este convênio permite — pode ser erro de digitação da data. |
| `LIMITE_SESSOES_EXCEDIDO` | Corrigir | Secretaria | O número da sessão registrado passa do limite de sessões que o convênio autoriza. |
| `DESCRICAO_DIVERGENTE` | Revisar | Secretaria | A descrição do procedimento na guia não bate com a descrição oficial do código (tolerante a acento/caixa/espaço, mas não a sentido). |
| `VALOR_DIVERGENTE` | Revisar | Secretaria | O valor cobrado diverge do valor de referência oficial do procedimento. |
| `DATA_FORA_DO_PADRAO` | — | — | **Código estável declarado, mas nenhuma regra desta fase o emite ainda** — ver §5 (dívidas). Data em formato reconhecível (`DD/MM/YYYY`, `YYYY/MM/DD`) é silenciosamente convertida por `normalizarGuia` e vira só um `AvisoNormalizacao` em `guide_versions.diff_json`, nunca um `Problema`/tela. |
| `POSSIVEL_DUPLICIDADE` | Revisar | Financeiro | Outra guia já registrada bate a mesma chave composta (paciente + convênio + procedimento + data do atendimento) — financeiro compara e decide merge (RF-13). |
| `OBSERVACAO_NAO_INTERPRETADA` | Revisar | Financeiro | Há texto em "observação da recepção" e **ainda não existe interpretação de IA** (Fase 4) — nesta fase, **toda** observação não vazia cai aqui, mesmo que pareça trivial: o motor nunca decide sozinho que uma observação "não importa" (proibição explícita de heurística de palavra-chave). |

### 3.4 Schema D1 e valores estáveis (sem mudança nesta fase)

Schema, 10 tabelas e 11 índices são os mesmos publicados em `phase-0-handoff.md` §3 —
**nenhuma migração nova nesta fase**, `migrations/0001_init.sql` continua sendo a única. A Fase 1
só grava dados dentro desse schema já existente (`rule_sets`, `protocols`, `guide_versions`,
`validation_runs`, `validation_issues`, `tasks`, `workflow_events` — as outras três,
`evidence_objects`/`evidence_links`/`protocol_merges`, continuam vazias, fora de escopo).

Números fixados que a Fase 2 pode confiar sem reconferir:

- Formato de protocolo `VT-YY-NNNN`, sequencial reinicia por ano, nunca colide (mecanismo:
  `PROXIMO_SEQUENCIAL_PROTOCOLO_SQL`, testado em `tests/repositories.test.ts`).
- `guide_versions.diff_json` da v1 é sempre `"[]"` (não é onde os avisos de normalização vivem —
  eles ficam recomputáveis a partir de `raw_payload_json` chamando `normalizarGuia` de novo, ou a
  Fase 2 decide persistir separadamente).
- `protocols.validation_status`/`assigned_area`/`current_risk_cents` são denormalizados a partir
  da última `validation_run` — `RepositorioValidacoesD1.salvarExecucao` os sincroniza na mesma
  transação; ninguém mais escreve nessas três colunas.
- `initial_risk_cents` só é gravado na primeira execução de validação do protocolo (`COUNT(*) = 0`
  em `validation_runs` antes do insert) — correções subsequentes nunca o reescrevem.

## 4. Números reais do banco semeado (medidos nesta sessão, D1 local)

Versão de regra ativa: `agosto/2026`, `source_sha256 = 8fed8225f516d3ac212e3bb853f028047188f56599f32a4dcdc3773db7cbf68f`.
Relógio fixo do seed: `2026-09-01T00:00:00.000Z`.

**Protocolos:** 80 (`SELECT COUNT(*) FROM protocols`). Todos `workflow_status = 'EM_TRATAMENTO'`
(nenhuma liberação/envio/encerramento/merge nesta fase — fora de escopo).

| `validation_status` | Quantidade | Risco (soma `current_risk_cents`) | Em reais |
|---|---:|---:|---:|
| `OK` | 28 | 0 | R$ 0,00 |
| `CORRIGIR` | 12 | 81.200 | R$ 812,00 |
| `REVISAO_HUMANA` | 35 | 242.600 | R$ 2.426,00 |
| `NAO_FATURAR_CONVENIO` | 5 | 55.000 | R$ 550,00 |
| **Total** | **80** | **378.800** | **R$ 3.788,00** |

`current_risk_cents` e `initial_risk_cents` somam o mesmo total (378.800 centavos) — nenhum
protocolo foi corrigido/tratado ainda nesta fase, então inicial == atual para todos os 80.

**Problemas por código** (`validation_issues`, 71 linhas no total, distribuídas em 52 dos 80
protocolos — a diferença 71 > 52 é sobreposição esperada, um protocolo pode ter mais de um
problema, ex. `VT-26-0006` acima tem 3):

| Código | Ocorrências |
|---|---:|
| `OBSERVACAO_NAO_INTERPRETADA` | 36 |
| `AUTORIZACAO_VENCIDA` | 13 |
| `CAMPO_OBRIGATORIO_AUSENTE` | 8 |
| `LIMITE_SESSOES_EXCEDIDO` | 6 |
| `PROCEDIMENTO_NAO_COBERTO` | 5 |
| `POSSIVEL_DUPLICIDADE` | 3 |
| `CONVENIO_DESCONHECIDO`, `PROCEDIMENTO_DESCONHECIDO`, `AUTORIZACAO_VALIDADE_ACIMA_DO_MAXIMO`, `DESCRICAO_DIVERGENTE`, `VALOR_DIVERGENTE`, `DATA_FORA_DO_PADRAO` | 0 (nenhuma das 80 guias aciona estes; `DATA_FORA_DO_PADRAO` nunca é emitido por nenhum código desta fase — ver §3.3/§5) |

Reconciliação com o baseline informal do PRD §14 (contagens brutas antes de haver código):
`AUTORIZACAO_VENCIDA` 13/13, `LIMITE_SESSOES_EXCEDIDO` 6/6, `PROCEDIMENTO_NAO_COBERTO` 5/5,
`CAMPO_OBRIGATORIO_AUSENTE` 8/8 (=4 autorização + 2 registro profissional + 2 CID do PRD) batem
exatamente. `POSSIVEL_DUPLICIDADE` é 3 nesta sessão, não os "2 pares" do PRD §14 — ver §5 sobre
`docs/BASELINE.md` estar desatualizado nesse ponto. `OBSERVACAO_NAO_INTERPRETADA` é 36, não "5":
o PRD §14 contou observações que **um humano julgou relevantes**; o contrato desta fase (sem
`interpretacaoIA`) exige emitir o código para **toda** observação não vazia, sem julgar
conteúdo — 36 é o número de guias com `observacao_recepcao` não vazia em `guias.csv`, e é o
número correto para esta fase (a triagem de relevância chega na Fase 4).

**Tarefas por área** (`tasks`, 71 linhas — uma por problema, todas `blocking = 1` nesta fase):

| Área | Quantidade | Tipos |
|---|---:|---|
| `FINANCEIRO` | 44 | `OBSERVACAO_NAO_INTERPRETADA` (36), `PROCEDIMENTO_NAO_COBERTO` (5), `POSSIVEL_DUPLICIDADE` (3) |
| `SECRETARIA` | 27 | `AUTORIZACAO_VENCIDA` (13), `CAMPO_OBRIGATORIO_AUSENTE` (8), `LIMITE_SESSOES_EXCEDIDO` (6) |

**Guias verificadas / precisam de atenção** (RF-14, §27, para quando a Fase 2 montar o relatório):
guias verificadas = 80 (todo protocolo tem ao menos uma `validation_run` concluída); precisam de
atenção = 52 (`validation_status != 'OK'`); risco inicial = R$ 3.788,00; tratado = R$ 0,00
(nenhum protocolo saiu de `EM_TRATAMENTO` nesta fase — liberação/envio/correção são Fase 2/3);
pendente = R$ 3.788,00 (igual ao inicial, nada foi tratado ainda).

## 5. Como rodar tudo do zero

```bash
cd "C:/Users/bjr-c/Downloads/Clinica Vitalis"
pnpm install                       # instala as deps fixadas do lockfile
pnpm run typecheck                 # tsc --noEmit (app + worker), exit 0 esperado
pnpm run test                      # vitest run, 53/53 esperado
pnpm run build                     # dist/client + checagem do worker
pnpm run db:migrate:local          # aplica migrations/0001_init.sql no D1 local (idempotente)
pnpm run seed:local                # gera .wrangler/seed/seed.sql e recarrega as 7 tabelas do seed
pnpm run dev                       # sobe worker + assets (precisa de CLOUDFLARE_ACCOUNT_ID exportado, ver docs/CONFIG.md)
```

`seed:local` é seguro para rodar de novo a qualquer momento: o SQL gerado abre com `DELETE FROM`
nas 7 tabelas que ele popula (dentro de uma única transação) antes de reinserir — nunca duplica
protocolo, nunca acumula lixo de execução anterior. Não toca `evidence_objects`,
`evidence_links` nem `protocol_merges`.

Para regenerar o SQL sem aplicar no D1 (auditoria antes de rodar): `node
--experimental-transform-types scripts/seed.ts --out <caminho>`. Aceita `--clock <ISO>` para
mudar o relógio fixo (padrão `2026-09-01T00:00:00.000Z`).

## 6. O que a Fase 2 pode assumir pronto e o que precisa criar

**Pronto, não recriar:**

- Motor de validação, normalização, parser CSV, regras versionadas — todos testados e estáveis
  (§3.1). Chame-os, não reimplemente.
- Seis repositórios D1 (`criarRepositoriosD1`) e os dois casos de uso de aplicação
  (`registrarGuia`, `validarGuia`) — a Fase 2 injeta essas mesmas peças num handler HTTP em vez
  de reescrever a orquestração.
- Schema D1 completo (10 tabelas, 11 índices) e 80 protocolos reais semeados para desenvolver e
  demonstrar a UI contra dados de verdade.
- Os 12 códigos de problema e seus rótulos de tela (§3.3) — não invente rótulo novo por conta
  própria sem necessidade; o `titulo` de cada `Problema` já vem pronto para tela.

**A Fase 2 precisa criar (nada disto existe ainda):**

- Rotas HTTP (`src/http/handlers/` está vazio, só com `.gitkeep`) — nenhum endpoint de
  relatório/lista/protocolo/correção existe hoje; `src/worker/index.ts` só tem `/api/health`
  (idêntico à Fase 0, não tocado nesta fase).
- Toda a UI de produto (`src/ui/pages/`, `src/ui/components/` vazios) — o `App.tsx`/`main.tsx`
  atuais são o shell mínimo da Fase 0.
- Cálculo agregado do relatório (RF-14/§27: "guias verificadas", "precisam de atenção", "risco
  inicial", "tratado × pendente") — os números brutos estão no banco (§4), mas nenhuma função
  os agrega hoje; é SQL/lógica nova da Fase 2.
- Upload de CSV/XLSX pela interface (RF-01) — `parseCsv` (aplicação) já existe e é reaproveitável,
  mas não há rota nem componente de upload; XLSX é parseado no cliente por decisão já registrada
  (`CLAUDE.md`), ainda não implementado.
- Formulário de cadastro individual (RF-02), tela de protocolo, linha do tempo, nova versão/diff
  (RF-10) — tudo interface, nada existe em `src/ui`.

## 7. Estado da porta de saída (PRD §33, Fase 1) — resultado real

| Critério | Resultado |
|---|---|
| 80 guias carregadas | **Atende.** `SELECT COUNT(*) FROM protocols` = 80, todas com `source_guide_id` preenchido e único (`guias.csv` tem 80 linhas de dados, 0 rejeitadas pelo parser). |
| Casos conhecidos retornam os motivos esperados | **Atende, com uma ressalva já corrigida no código.** `tests/engine.test.ts` cobre 13 cenários nomeados (validade inclusiva, campo obrigatório por convênio, limite de sessões, procedimento não coberto, descrição/valor divergente, duplicidade, observação, composição de status, cálculo de risco) incluindo um controle negativo. Contra os dados reais, 4 das 5 categorias mensuráveis do PRD §14 batem exatamente (§4); a quinta (`POSSIVEL_DUPLICIDADE`) bate 3 pares reais medidos nesta sessão contra a chave composta paciente+convênio+procedimento+data — `docs/BASELINE.md`, escrito por outro agente em paralelo, descreve isso como bug pendente (filtro por carteirinha em vez de paciente) mas **o código em disco (`src/infrastructure/d1/versions.ts`, `scripts/seed.ts`) já filtra por `paciente`, não por carteirinha** — os números medidos aqui (§4) já refletem o comportamento corrigido. `docs/BASELINE.md` precisa ser atualizado ou removido por quem tiver esse arquivo no escopo; não é meu para editar nesta tarefa. |
| Uma guia nunca é somada duas vezes no risco | **Atende.** Por construção: `risco_cents` em `engine.ts` é `guia.valor_cents` (um valor escalar) ou `0`, nunca uma soma sobre `problemas` — mesmo com 3 problemas simultâneos (`VT-26-0006`, §3.2) o risco gravado é 14.000 centavos, não 42.000. Confirmado também por idempotência: `registrarGuia` com o mesmo `id_guia` de origem duas vezes não cria segundo protocolo nem roda o motor de novo (`tests/repositories.test.ts`, "registrar duas vezes o mesmo id_guia... não cria dois protocolos" — motor chamado 1 vez, não 2). Exclusão de protocolo `MESCLADA` do risco agregado do relatório é responsabilidade da Fase 2/3 (merge não existe nesta fase); a coluna por protocolo já garante a contagem única na origem. |

## 8. Dívidas e lacunas

- **`docs/BASELINE.md` está desatualizado no ponto central da sua própria análise.** Ele
  descreve `RepositorioVersoesD1.listarCandidatosDuplicidade` (e o equivalente em memória do
  seed) como filtrando candidatos por `carteirinha` em vez de `paciente`, perdendo o par
  `G-2608-0017`/`G-2608-0060`. Lido nesta sessão, os dois arquivos (`src/infrastructure/d1/
  versions.ts` linha 36, `scripts/seed.ts` linha 345) **já comparam `paciente`**, não
  `carteirinha` — os números que este handoff reporta em §4 (`POSSIVEL_DUPLICIDADE` = 3, 52
  protocolos com pendência, risco R$ 3.788,00) são exatamente os números "pós-conserto" que o
  próprio `BASELINE.md` §3.2/§4 previa. Não editei `BASELINE.md` (fora da lista de arquivos desta
  tarefa) — quem tocar nele a seguir deve reconciliar com o código, não com o texto atual do
  arquivo.
- **Achado de ordenação em `registrarGuia` não corrigido, documentado no código-fonte** (comentário
  em `scripts/seed.ts`, classe `VersoesMemoria`, linhas 316–334): `register-guide.ts` chama
  `protocolos.criarComVersaoInicial` (grava o protocolo) antes de `versoes.
  listarCandidatosDuplicidade`. O seed contorna isso comparando identidade de objeto em memória
  (`guiaExistente === guia`), mas essa exclusão não existe em `RepositorioVersoesD1` sobre D1 real
  — lá a query não filtra o próprio protocolo (`p.id != ?` ausente). **Consequência para a Fase
  2/3**: ao ligar `registrarGuia` a `RepositorioVersoesD1` de verdade (import/cadastro pela UI),
  toda guia nova vai bater a própria chave composta contra si mesma e sempre sair com
  `POSSIVEL_DUPLICIDADE`. Dois consertos possíveis, nenhum aplicado aqui (fora de escopo): (a)
  reordenar `register-guide.ts` para consultar duplicidade antes de criar o protocolo, ou (b)
  acrescentar exclusão por `protocoloId` ao contrato de `Versoes.listarCandidatosDuplicidade` e à
  query SQL. Não afeta os 80 protocolos já semeados (o seed usa o adapter em memória, imune a
  isso) — só afeta cadastro/importação futuros contra D1 de verdade.
- **`DATA_FORA_DO_PADRAO` é código morto.** Está no union `CodigoProblema`
  (`src/domain/validation.ts`) mas nenhum arquivo de `src/rules` o produz — datas fora do padrão
  reconhecível viram só `AvisoNormalizacao` (não bloqueante, RN-08), nunca um `Problema` de tela.
  Não é um bug funcional (RN-08 não exige que isso bloqueie), mas é uma decisão que ninguém tomou
  explicitamente ainda: a Fase 2 precisa decidir se mostra os avisos de normalização em algum
  lugar da tela do protocolo, ou se `DATA_FORA_DO_PADRAO` deveria ser removido do union por não
  ter uso.
- **`src/rules/observation.ts`, ramo com `interpretacaoIA` presente, é inalcançável nesta fase.**
  Nenhum código do seed passa uma interpretação diferente de `null`/ausente (chamar Workers AI é
  Fase 4). O ramo existe e está escrito, mas não foi exercitado por nenhum teste real com dado —
  só por construção de tipo. Revisar antes de ativar na Fase 4: hoje ele reaproveita o código
  `OBSERVACAO_NAO_INTERPRETADA` mesmo quando a observação **foi** interpretada com sucesso, o que
  deixaria o nome do código enganoso nesse caminho.
- **`scripts/__tstest_extless.ts`** é um script de depuração avulso na raiz de `scripts/`
  (verifica resolução de import sem extensão e roda uma validação manual pontual) — não é
  referenciado por nenhum `package.json` script, não faz parte do portão verde, e não é limpo por
  esta tarefa (edição de arquivo fora da lista autorizada). Fica registrado para quem limpar
  `scripts/` depois decidir se remove.
- **`@cloudflare/vitest-pool-workers` continua não configurado** (dívida já registrada na Fase 0,
  ainda válida): `tests/repositories.test.ts` cobre os repositórios D1 contra `node:sqlite`
  carregando a migração real, o que dá cobertura de comportamento SQL sem depender do pool —
  suficiente para esta fase, mas não é o mesmo runtime do Worker.
- **Prazo de envio não é avaliado** (por decisão do contrato desta fase, RN-04): nenhuma guia
  gera problema por prazo estourado; `prazo_envio_dias` está disponível em
  `RegraConvenio`/`regraAplicavel` para a Fase 2 exibir como informação, mas nenhum código deste
  motor o transforma em `Problema`.
