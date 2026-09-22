# Baseline da amostra — reconciliação Fase 1

Medido nesta sessão, não copiado de execução anterior. Reconcilia o resultado real do motor
determinístico (`src/rules/engine.ts`) contra o baseline informal do PRD (`docs/PRD-SDD.md`
§14) para as 80 guias de `guias.csv`.

## 1. Como reproduzir

```bash
cd "C:/Users/bjr-c/Downloads/Clinica Vitalis"
pnpm run seed:local   # gera .wrangler/seed/seed.sql e aplica no D1 local (inclui governança dependente)
pnpm exec wrangler d1 execute DB --local --command "SELECT code, COUNT(*) n FROM validation_issues GROUP BY code ORDER BY code;"
pnpm exec wrangler d1 execute DB --local --command "SELECT validation_status, COUNT(*) n, SUM(current_risk_cents) risco FROM protocols GROUP BY validation_status;"
```

- **Data da medição:** 2026-09-20 (sessão que gerou este arquivo).
- **Versão da regra:** `agosto/2026`, `source_sha256 = 8fed8225f516d3ac212e3bb853f028047188f56599f32a4dcdc3773db7cbf68f` (conferido em `rule_sets` no D1 local).
- **Relógio fixo do seed:** `2026-09-01T00:00:00.000Z` (`SEED_CLOCK_UTC`/`--clock`, padrão do script).
- **Determinismo:** `scripts/seed.ts` não usa `Date.now()`, `crypto.randomUUID()` nem ordem
  não determinística — reexecutar o comando acima produz o mesmo `seed.sql` byte a byte e o
  mesmo estado em `protocols`/`validation_issues`.
- **Ambiente:** Node `v24.14.0`, pnpm `9.15.0`, wrangler `4.135.0`.
- 80/80 linhas de `guias.csv` foram aceitas pelo parser (`rejeitadas: 0`) — porta "80 guias carregadas" atendida.

## 2. Tabela: esperado (PRD §14) x obtido (D1 local, código de problema)

| Categoria do PRD §14 | Esperado (bruto) | Código no motor | Obtido (D1) | Bate? |
|---|---:|---|---:|---|
| Autorizações vencidas | 13 | `AUTORIZACAO_VENCIDA` | 13 | Sim |
| Acima do limite de sessões | 6 | `LIMITE_SESSOES_EXCEDIDO` | 6 | Sim |
| Procedimentos não cobertos | 5 | `PROCEDIMENTO_NAO_COBERTO` | 5 | Sim |
| Números de autorização ausentes | 4 | `CAMPO_OBRIGATORIO_AUSENTE` (subproblema "número da autorização") | 4 | Sim |
| Registros profissionais ausentes | 2 | `CAMPO_OBRIGATORIO_AUSENTE` (subproblema "registro profissional") | 2 | Sim |
| CIDs obrigatórios ausentes | 2 | `CAMPO_OBRIGATORIO_AUSENTE` (subproblema "CID") | 2 | Sim |
| Datas fora do padrão | 2 | não é `validation_issues` — vira `AvisoNormalizacao` em `guide_versions.diff_json` | 2 (avisos) / 0 (issues) | Critério diferente (ver §3.1) |
| Pares de possível duplicidade | 2 | `POSSIVEL_DUPLICIDADE` | **2** | Sim |
| Observações com impacto operacional | 5 | `OBSERVACAO_NAO_INTERPRETADA` | 36 | Critério diferente (ver §3.3) |

Códigos estáveis sem ocorrência nesta amostra (não citados pelo PRD §14, contagem zero
confirmada por inspeção direta, não por ausência de teste): `CONVENIO_DESCONHECIDO`,
`PROCEDIMENTO_DESCONHECIDO` (todo `convenio`/`procedimento_codigo` de `guias.csv` existe em
`regras_convenio.json.txt`), `AUTORIZACAO_VALIDADE_ACIMA_DO_MAXIMO`, `DESCRICAO_DIVERGENTE`,
`VALOR_DIVERGENTE` (nenhuma guia diverge de `procedimentos[].descricao`/`valor_referencia` do
conjunto de regras vigente).

`CAMPO_OBRIGATORIO_AUSENTE` soma 8 issues (uma por guia, cada uma com exatamente 1
subproblema — nenhuma guia falha em 2 campos obrigatórios ao mesmo tempo), reconciliando
exatamente com 4+2+2 = 8 do PRD.

Total de `validation_issues`: 70, distribuídas em 51 protocolos distintos (dos 80) — a
diferença (70 > 51) é a sobreposição que o PRD §14 já avisava ("há sobreposição, subproblemas
e casos que dependem de revisão"); por exemplo `G-2608-0056` soma `CAMPO_OBRIGATORIO_AUSENTE`
**e** `LIMITE_SESSOES_EXCEDIDO` ao mesmo tempo.

## 3. Investigação de cada divergência

### 3.1 Datas fora do padrão — critério diferente, não é bug

`guias.csv` tem exatamente 2 linhas com `data_atendimento` em formato `DD/MM/YYYY`:
`G-2608-0016` (`03/08/2026`) e `G-2608-0027` (`26/08/2026`). `src/domain/normalize.ts`
reconhece o formato, converte para `YYYY-MM-DD` e registra um `AvisoNormalizacao` — exatamente
o que RN-08 pede ("a normalização gera aviso, mas não bloqueia sozinha"). O código
`DATA_FORA_DO_PADRAO` existe em `CodigoProblema` (`src/domain/validation.ts`) mas nenhum
módulo de `src/rules` o emite: nenhuma regra de negócio exige que isso vire um problema
bloqueante, e a interpretação mais literal de RN-08 é que o aviso não-bloqueante já é a forma
correta de registrar o caso — ele fica em `guide_versions.diff_json`, não em
`validation_issues`. Não é bug; é observação registrada em §5 para a Fase 2 decidir se exibe
esses avisos na tela do protocolo.

### 3.2 Possível duplicidade — análise histórica superada

> A investigação abaixo foi registrada antes da regra conservadora de carteirinha divergente ser
> aplicada. Ela é mantida como histórico de decisão, não como estado atual.

O motor puro (`src/rules/duplicates.ts`) define o núcleo de duplicidade como
**paciente + convênio + data de atendimento + procedimento** (carteirinha é reforço opcional,
não exigido). Rodando esse núcleo contra as 80 guias sem nenhum pré-filtro, existem **3**
pares, não 2:

| Par | id_guia mais recente | id_guia original | Paciente | Convênio | Data | Procedimento | Carteirinha bate? |
|---|---|---|---|---|---|---|---|
| 1 | `G-2608-0057` | `G-2608-0027` | P-1051 | Vitalcard | 2026-08-26 | 20103301 | Sim |
| 2 | `G-2608-0076` | `G-2608-0059` | P-1052 | Vitalcard | 2026-08-27 | 50000560 | Sim |
| 3 | `G-2608-0060` | `G-2608-0017` | P-1017 | Vitalcard | 2026-08-19 | 50000470 | **Não** (`119580163` x `598125208`) |

O D1 semeado só tem os pares 1 e 2 (2 issues) — o par 3 nunca chega a ser avaliado por
`verificarDuplicidade`. Causa raiz: o pré-filtro que decide **quais candidatos chegam** ao
motor puro (não o motor em si) usa a chave errada.

- `src/infrastructure/d1/versions.ts`, `RepositorioVersoesD1.listarCandidatosDuplicidade` —
  a query SQL filtra por `json_extract(gv.normalized_payload_json, '$.carteirinha') = ?`
  vinculado a `guia.carteirinha`, e nunca filtra por `paciente`.
- `scripts/seed.ts`, `VersoesMemoria.listarCandidatosDuplicidade` — o mesmo engano em memória:
  `guiaExistente.carteirinha === guia.carteirinha` no lugar de comparar `paciente`.

Como `G-2608-0017` e `G-2608-0060` têm o mesmo paciente mas carteirinhas diferentes (erro de
digitação/cadastro plausível — exatamente o tipo de duplicidade que RF-13 quer pegar), o
pré-filtro os exclui um do outro antes mesmo do motor puro rodar. Confirmado isolando
`validarGuia` do motor com a lista completa de candidatos (sem o pré-filtro dos dois
arquivos acima): o terceiro par aparece.

**Conserto exato** (arquivo, não aplicado nesta tarefa — fora do escopo: só toco
`docs/BASELINE.md`):

1. `src/infrastructure/d1/versions.ts`, dentro do SQL de `listarCandidatosDuplicidade`, trocar
   `json_extract(gv.normalized_payload_json, '$.carteirinha') = ?` por
   `json_extract(gv.normalized_payload_json, '$.paciente') = ?`, e no `.bind(...)` trocar o
   argumento `guia.carteirinha` por `guia.paciente` (mesma posição).
2. `scripts/seed.ts`, dentro de `VersoesMemoria.listarCandidatosDuplicidade`, trocar a
   comparação `guiaExistente.carteirinha === guia.carteirinha` por
   `guiaExistente.paciente === guia.paciente`.
3. Rodar `pnpm run seed:local` de novo. Resultado esperado após o conserto:
   `POSSIVEL_DUPLICIDADE` sobe de 2 para 3 issues, `G-2608-0060` sai de `OK` e vai para
   `REVISAO_HUMANA`, `OK` cai de 29 para 28, `REVISAO_HUMANA` sobe de 34 para 35, e o risco
   total sobe de 372600 para 378800 centavos (+6200, o `valor_cents` de `G-2608-0060`).

Isso também explica por que o próprio baseline do PRD (§14, "2 pares") já estava impreciso
antes de qualquer código existir: a checagem manual original provavelmente também comparou
carteirinha em vez de paciente, ou simplesmente não pareou 0017/0060.

**Conclusão vigente:** `src/rules/duplicates.ts` descarta o par `G-2608-0017` /
`G-2608-0060` porque as duas carteirinhas conhecidas divergem. O pré-filtro D1 e o adapter do
seed usam `paciente`, e o baseline atual é de 2 pares, 51 guias com atenção e R$ 3.726,00.

### 3.3 Observações com impacto operacional — critério diferente, não é bug

`guias.csv` tem 36 guias com `observacao_recepcao` não vazia. RF-06/RN-04 e o parâmetro fixado
pelo orquestrador para esta fase dizem que, sem interpretação de IA, **toda** observação não
vazia deve virar `OBSERVACAO_NAO_INTERPRETADA` com ação `REVISAR` — o motor nunca decide sozinho
que uma observação é "irrelevante" (isso seria a heurística de palavra-chave explicitamente
proibida). O "5" do PRD §14 é uma estimativa humana de quantas observações, lidas a olho,
pareciam operacionalmente relevantes (ex.: "nova autorização ainda não lançada"); o motor desta
fase ainda não tem esse filtro — ele chega só na Fase 4, quando `interpretacaoIA` deixa de vir
`null`. **36 é o número correto para a Fase 1** dado o contrato fixado (interpretação ausente);
o comportamento bate exatamente com o que a tarefa descreveu: "quando esse parâmetro vier
ausente/nulo E a observação não estiver vazia, o motor emite o problema
`OBSERVACAO_NAO_INTERPRETADA`".

## 4. Bloqueador — resumo

| # | Arquivo | Problema | Seção do PRD | Conserto |
|---|---|---|---|---|
| 1 | `src/infrastructure/d1/versions.ts` | Pré-filtro de candidatos a duplicidade usa `carteirinha` em vez de `paciente`, incompatível com o núcleo real de `src/rules/duplicates.ts`; perde o par `G-2608-0017`/`G-2608-0060` | RF-13, §21.3 passo 8, §26.1 | Trocar a coluna filtrada e o parâmetro `.bind(...)` de `carteirinha` para `paciente` (ver §3.2) |
| 2 | `scripts/seed.ts` (`VersoesMemoria`) | Mesmo engano, versão em memória usada pelo seed local | RF-13, §21.3 passo 8 | Trocar a comparação de `carteirinha` para `paciente` (ver §3.2) |

Sem esse conserto, "casos conhecidos retornam os motivos esperados" (porta de saída desta
fase) não vale para o par 0017/0060: a guia `G-2608-0060` deveria voltar
`POSSIVEL_DUPLICIDADE` e hoje volta `OK`.

## 5. Totais que a Fase 2 vai exibir (RF-14, §27)

Medidos no D1 local como semeado hoje:

| Métrica | Valor |
|---|---|
| Guias verificadas (§27.1: protocolos não mesclados com validação concluída) | 80 |
| Guias que exigem atenção (§27.2: status ≠ `OK`) | 51 |
| Risco inicial (§27.3: soma de `initial_risk_cents`, uma vez por protocolo) | 372.600 centavos = **R$ 3.726,00** |
| Tratado (RN-05: destino final válido ou corrigido+liberado) | R$ 0,00 — nenhum dos 80 protocolos saiu de `EM_TRATAMENTO` nesta fase (liberação, envio, correção e merge são Fases 2/3) |
| Pendente (risco atual dos protocolos ainda em tratamento) | R$ 3.726,00 (igual ao inicial, já que nada foi tratado ainda) |
| Por status | `OK` 29 · `CORRIGIR` 12 · `REVISAO_HUMANA` 34 · `NAO_FATURAR_CONVENIO` 5 |
| Risco por status | `CORRIGIR` R$ 812,00 · `NAO_FATURAR_CONVENIO` R$ 550,00 · `REVISAO_HUMANA` R$ 2.364,00 · `OK` R$ 0,00 |

**Cada protocolo entra uma vez só**: `current_risk_cents`/`initial_risk_cents` são colunas de
`protocols` (uma linha por protocolo, chave primária `id`), nunca uma soma por
`validation_issue` — uma guia com 3 problemas simultâneos (ex. `G-2608-0056`) soma seu
`valor_cents` uma única vez, nunca três. Confirmado por `SUM(current_risk_cents)` batendo com
o total impresso por `scripts/seed.ts` (372.600) e por não haver protocolo duplicado em
`protocols` (80 linhas, `source_guide_id` único por linha — reforçado por
`protocols(source_guide_id)` UNIQUE em `migrations/0001_init.sql`).

## 6. Observações não bloqueantes (fora do escopo de correção desta fase)

- `CodigoProblema.DATA_FORA_DO_PADRAO` (`src/domain/validation.ts`) é um membro do union type
  que nenhum módulo de `src/rules` produz — código morto hoje. Não é bug funcional (RN-08 é
  atendida via `AvisoNormalizacao`, ver §3.1), mas vale decisão explícita numa fase futura:
  remover o código do union ou passar a emiti-lo como problema não-bloqueante quando a Fase 2
  decidir exibir avisos de normalização na tela do protocolo.
- `src/rules/observation.ts`, segundo ramo de `verificarObservacao` (quando `interpretacaoIA`
  não é nulo e tem sinal operacional): reaproveita o código `OBSERVACAO_NAO_INTERPRETADA`
  mesmo quando a observação **foi** interpretada pela IA — nome do código ficaria enganoso
  nesse caso. Esse ramo é inalcançável na Fase 1 (nenhum lugar do seed passa
  `interpretacaoIA` diferente de `null`, e chamar Workers AI está fora de escopo desta fase);
  registrado aqui para quem implementar a Fase 4 revisar antes de ativar o ramo.

---

## Correção aplicada após a auditoria (20/09/2026, orquestrador)

A auditoria adversarial apontou 3 pares de possível duplicidade contra os 2 previstos no PRD §14. A investigação das guias concretas confirmou falso positivo:

| Par | Veredito | Evidência |
|---|---|---|
| G-2608-0027 / G-2608-0057 | duplicidade real | mesma carteirinha `258573823`, mesma autorização `AUT124496`, mesma data (uma linha escrita `26/08/2026`, a outra `2026-08-26`) |
| G-2608-0059 / G-2608-0076 | duplicidade real | mesma carteirinha `717376382`, mesma autorização `AUT743137` |
| G-2608-0017 / G-2608-0060 | **falso positivo** | unidade (Centro/Norte), carteirinha (`598125208`/`119580163`), CID (`M79.7`/`M54.5`), autorização (`AUT918149`/`AUT885310`) e profissional todos diferentes |

`src/rules/duplicates.ts` passou a descartar a suspeita quando as duas carteirinhas são conhecidas e divergem — carteirinhas diferentes identificam beneficiários diferentes. Carteirinha ausente em um dos lados **não** descarta: dado faltante não é prova de diferença. O número da autorização entrou como campo coincidente exibido, reforçando a explicação do par.

O PRD §36 classifica falso positivo de duplicidade como risco alto justamente porque alimenta um merge indevido; a regra continua apenas sinalizando, nunca mesclando.

### Números do D1 local após a correção

| Medida | Valor |
|---|---|
| Protocolos | 80 |
| OK | 29 |
| Revisão humana | 34 |
| Corrigir | 12 |
| Não faturar ao convênio | 5 |
| Risco inicial = risco atual | 372.600 centavos (R$ 3.726,00) |
| Possível duplicidade | 2 pares |

Ocorrências por código: `OBSERVACAO_NAO_INTERPRETADA` 36, `AUTORIZACAO_VENCIDA` 13, `CAMPO_OBRIGATORIO_AUSENTE` 8, `LIMITE_SESSOES_EXCEDIDO` 6, `PROCEDIMENTO_NAO_COBERTO` 5, `POSSIVEL_DUPLICIDADE` 2.

As 36 observações não interpretadas são o comportamento conservador contratado para a Fase 1: sem Workers AI, toda observação não vazia vira revisão humana. A Fase 4 injeta a interpretação e esse número deve cair para perto das 5 observações com impacto operacional previstas no PRD §14.

---

## Auditoria adversarial da RN-09 (prazo de envio) — 22/09/2026

Escopo: `src/rules/dispatch-deadline.ts` (novo, emite `PRAZO_ENVIO_EXCEDIDO`), a redução de
`src/rules/authorization.ts` (removeu a checagem de validade máxima, sem data de concessão no
CSV) e a RN-09/nota §14 que os documentam. Medição independente, sem reaproveitar nenhum número
das seções anteriores.

**Ambiente:** `pnpm run seed:local` reexecutado nesta sessão. Node `v24.14.0`, wrangler
`4.135.0`. `source_sha256` de `rule_sets` conferido como
`8fed8225f516d3ac212e3bb853f028047188f56599f32a4dcdc3773db7cbf68f` (mesma versão `agosto/2026`).

### 1. Contagem por estado de validação (D1 local, `SELECT validation_status, COUNT(*), SUM(current_risk_cents), SUM(initial_risk_cents) FROM protocols GROUP BY validation_status`)

| Estado | Guias | Risco inicial | Risco atual |
|---|---:|---:|---:|
| `OK` | 29 | R$ 0,00 | R$ 0,00 |
| `CORRIGIR` | 12 | R$ 812,00 | R$ 812,00 |
| `REVISAO_HUMANA` | 34 | R$ 2.364,00 | R$ 2.364,00 |
| `NAO_FATURAR_CONVENIO` | 5 | R$ 550,00 | R$ 550,00 |
| **Total** | **80** | **R$ 3.726,00** | **R$ 3.726,00** |

`SELECT COUNT(*) FROM protocols` = 80 confirmado antes de qualquer outra query. Risco inicial e
atual são idênticos porque nenhum protocolo saiu de `EM_TRATAMENTO` (mesma situação da Fase 1).

### 2. Ocorrências por código (`SELECT code, COUNT(*) FROM validation_issues GROUP BY code`)

| Código | Ocorrências |
|---|---:|
| `OBSERVACAO_NAO_INTERPRETADA` | 36 |
| `AUTORIZACAO_VENCIDA` | 13 |
| `CAMPO_OBRIGATORIO_AUSENTE` | 8 |
| `LIMITE_SESSOES_EXCEDIDO` | 6 |
| `PROCEDIMENTO_NAO_COBERTO` | 5 |
| `POSSIVEL_DUPLICIDADE` | 2 |
| `PRAZO_ENVIO_EXCEDIDO` | **0** |
| `AUTORIZACAO_VALIDADE_ACIMA_DO_MAXIMO` | 0 (legado, nunca emitido — ver §5) |

**Nenhum número mudou em relação ao baseline pós-correção de 20/09/2026** (seção anterior deste
arquivo). A RN-09 e a redução de `authorization.ts` tiveram impacto zero nesta amostra de 80
guias — não é ausência de teste, é o resultado real medido duas vezes (D1 direto e via
`GET /api/report`, §6).

### 3. Tarefas abertas por área (`GET /api/report`, bloco `distribuicao_por_area`)

| Área | Protocolos | Tarefas abertas | Risco |
|---|---:|---:|---:|
| `FINANCEIRO` | 26 | 43 | R$ 2.056,00 |
| `SECRETARIA` | 25 | 27 | R$ 1.670,00 |

26 + 25 = 51 = total de guias que exigem atenção — **nenhum protocolo tem tarefa aberta nas duas
áreas ao mesmo tempo** nesta amostra (não é regra do motor, é característica dos dados: nenhuma
guia combina, por exemplo, `CAMPO_OBRIGATORIO_AUSENTE` de SECRETARIA com algo de FINANCEIRO no
mesmo protocolo).

### 4. Por que `PRAZO_ENVIO_EXCEDIDO` é zero — conferência manual guia a guia

Recontagem das 80 linhas de `guias.csv` à mão (script descartável, não versionado): para cada
guia, `data_lancamento` comparado com `data_atendimento + prazo_envio_dias` do convênio
(Vitalcard e Plano Bem = 30 dias, Saúde Interior = 45 dias, todos de `regras_convenio.json.txt`).

- **Maior intervalo lançamento−atendimento em toda a amostra: 3 dias** (`G-2608-0001`, Vitalcard,
  atendimento `2026-08-28`, lançamento `2026-08-31`). Contra um prazo de 30 dias, sobram 27 dias
  de margem — a mesma guia com a menor margem folgada de toda a base.
- **Nenhuma guia tem `data_lancamento` anterior a `data_atendimento`** (0 casos com gap
  negativo) — o dado "incoerente" citado no pedido de auditoria não ocorre nesta prova (ver §5).
- **Zero guias ultrapassam o prazo.** A conta bate: com prazos de 30–45 dias e lançamentos
  sempre a 0–3 dias do atendimento, a regra RN-09 é estruturalmente inerte neste recorte — ela
  existe para proteger dados futuros com lançamento tardio, não para pegar algo nesta amostra.

Três conferências manuais, uma por convênio (cobrindo os dois valores de `prazo_envio_dias`
existentes):

| `id_guia` | Convênio | `data_atendimento` | `prazo_envio_dias` | Data limite (calculada à mão) | `data_lancamento` | Margem |
|---|---|---|---:|---|---|---:|
| `G-2608-0001` | Vitalcard | 2026-08-28 | 30 | 2026-08-28 + 30 = **2026-09-27** | 2026-08-31 | 27 dias |
| `G-2608-0002` | Plano Bem | 2026-08-06 | 30 | 2026-08-06 + 30 = **2026-09-05** | 2026-08-08 | 28 dias |
| `G-2608-0041` | Saúde Interior | 2026-08-20 | 45 | 2026-08-20 + 45 = **2026-10-04** | 2026-08-21 | 44 dias |

Todas as três: `data_lancamento` bem dentro do prazo, nenhuma gera `PRAZO_ENVIO_EXCEDIDO` — bate
com o motor e com a contagem zero em D1/relatório.

### 5. Ataque à borda e aos casos degenerados

Como a amostra não tem nenhuma guia no limite exato nem no dia seguinte, a prova da borda vem de
teste unitário (não da amostra) — e ela **já existia** antes desta auditoria, em
`tests/engine.test.ts`, describe `"validarGuia — prazo de envio (RN-09)"`:

- `"aceita o próprio dia limite, contado desde o atendimento"` — atendimento `2026-08-10`,
  lançamento `2026-09-09` (exatamente `10/08 + 30`) → **não** gera `PRAZO_ENVIO_EXCEDIDO`.
- `"gera revisão humana bloqueante quando o lançamento passa do prazo"` — mesmo atendimento,
  lançamento `2026-09-10` (um dia depois do limite) → gera o problema, ação `REVISAR`, área
  `FINANCEIRO`, tarefa bloqueante. Reexecutado nesta sessão (`pnpm exec vitest run
  tests/engine.test.ts`): passa, 17/17.

Sem erro de fuso: `src/rules/dispatch-deadline.ts` e `src/rules/authorization.ts` calculam tudo
com `Date.UTC(ano, mes-1, dia)` a partir de strings `YYYY-MM-DD` já normalizadas — nunca leem o
relógio local nem `Date.now()`. Sem off-by-one: a comparação é `lancamento.timestampUtc <=
dataLimiteUtc` (inclusiva), confirmada pelos dois testes acima e pela conta manual do §4.

**Dado incoerente (`data_lancamento` anterior a `data_atendimento`):** não ocorre nas 80 guias
(§4). Caracterizei o comportamento atual com um teste novo em `tests/engine.test.ts`
(`"dado incoerente (lançamento anterior ao atendimento) não gera PRAZO_ENVIO_EXCEDIDO —
comportamento caracterizado, não normativo"`): a regra só testa `lancamento <= atendimento +
prazo`, e lançamento anterior ao atendimento sempre satisfaz essa desigualdade, então passa em
silêncio — sem aviso, sem tarefa, sem sinal de que o dado está errado. **Não corrigi isso**: o
PRD/RN-09 não pede um código para essa inconsistência de cadastro (seria inventar requisito,
proibido por §8), e o caso não ocorre na prova. Fica registrado aqui para o dono do produto
decidir se uma fase futura deve tratar isso como erro de digitação a corrigir.

**`prazo_envio_dias` ausente ou zero:** não é alcançável em produção. `esquemaRegraConvenioWire`
(`src/http/contracts.ts:567`) e o schema espelho em `src/rules/rule-set.ts`
(`esquemaConvenioOficial`) exigem `z.number().int().positive()` — um `regras_convenio.json` sem
esse campo, ou com `0`, falha ao carregar o conjunto de regras antes de qualquer guia ser
validada. Os três convênios do arquivo oficial (`Vitalcard` 30, `Saúde Interior` 45, `Plano Bem`
30) têm o campo presente e positivo.

**Observação de robustez, não corrigida (fora do escopo de bug):** `authorization.ts`
(`paraDiaUtc`, linha 7-9) faz `dataIso.split("-").map(Number)` sem validar o formato, ao
contrário de `dispatch-deadline.ts` (`lerDataCalendario`), que valida com regex e confere se o
calendário é real (rejeita `32/13/2026`, por exemplo). Nos dados desta prova isso nunca importa —
`normalize.ts` sempre entrega `YYYY-MM-DD` válido ou preserva o texto original quando não
consegue interpretar, e nenhuma guia do CSV cai nesse segundo caso para as datas envolvidas — mas
é uma assimetria entre os dois arquivos que valeria unificar numa fase futura. Não é bug hoje
porque não produz resultado errado com nenhum dado real da prova; é dívida técnica registrada,
não corrigida (não altera nenhum resultado atual, e mexer nisso sem necessidade violaria
"mudança cirúrgica").

### 6. Pureza de `src/rules/**` e `src/domain/**`

Grep teimoso por `Date.now()`, `new Date()` sem argumento, `fetch(`, `node:fs`/`from "fs"`,
`D1Database`, `R2Bucket` nos dois diretórios: **zero ocorrências**. Único uso de `Date` nos dois
arquivos novos/alterados é `Date.UTC(ano, mes-1, dia)` (determinístico, argumentos explícitos) e
`new Date(timestampUtc)` em `dispatch-deadline.ts` (também determinístico — o argumento vem do
próprio cálculo, nunca do relógio). `src/rules/rule-set.ts` importa `zod`, que é validação pura,
não I/O. Motor continua puro.

### 7. Código morto / mensagens órfãs após a redução de `authorization.ts`

Busca por `validade.máxima` / `VALIDADE_ACIMA_DO_MAXIMO` / `validade_maxima` em `src/`, `docs/` e
`tests/`: nenhuma referência órfã encontrada.

- `RegraConvenio.validade_maxima_autorizacao_dias` continua no domínio, no schema
  (`src/http/contracts.ts`) e exibido como metadado informativo em `src/ui/pages/Regras.tsx` e
  `src/ui/pages/NovaGuia.tsx` ("Validade máxima da autorização: N dias") — isso é **intencional**,
  não sobra de código: o PRD §14 (nota) e o comentário em `src/domain/rule-set.ts:23` já registram
  que o campo é metadado da fonte oficial, exibido mas não aplicado sem data de concessão. Não é
  um resíduo da mudança, é a decisão documentada.
- `AUTORIZACAO_VALIDADE_ACIMA_DO_MAXIMO` continua no union `CodigoProblema`
  (`src/domain/validation.ts:12`) com comentário explícito ("mantido para ler históricos
  antigos; não é emitido sem data de concessão") e um teste que prova que nunca é emitido
  (`tests/engine.test.ts`, teste "2b"). Não é código morto silencioso — é legado documentado e
  coberto por teste negativo.
- Nenhum teste órfão: não existe teste que chame uma função removida ou que assuma o
  comportamento antigo (verificação de janela máxima). `tests/engine.test.ts` teste "2b" já
  testa exatamente o contrário do comportamento antigo (confirma que a janela NÃO é aplicada).

### 8. Reconciliação `GET /api/report` × `GET /api/protocols`

Servidor local (`pnpm dev`, `CLOUDFLARE_ACCOUNT_ID` da a conta Cloudflare autenticada via
`wrangler whoami`), consultado com `node --eval` + `fetch` (porta 8788) e derrubado ao final desta
verificação sem afetar outro `wrangler dev` já em execução na porta 8787 (sessão de outro agente,
não tocada).

| Bloco do relatório | Valor do bloco | `GET /api/protocols` com o mesmo filtro | Bate? |
|---|---:|---:|---|
| `guias_verificadas` | 80 | `?tamanho=100` → `paginacao.total=80` | Sim |
| `exigem_atencao` | 51 | `?status_validacao=CORRIGIR,REVISAO_HUMANA,NAO_FATURAR_CONVENIO&tamanho=100` → 51, mesmo conjunto de `numero_protocolo` | Sim |
| `risco_inicial_cents` / `risco_pendente_cents` | 372.600 / 372.600 | soma de `risco_cents` dos 51 protocolos acima | Sim |
| `risco_tratado_cents` | 0 | nenhum protocolo fora de `EM_TRATAMENTO` | Sim |
| Por status (`OK`/`CORRIGIR`/`REVISAO_HUMANA`/`NAO_FATURAR_CONVENIO`) | 29/12/34/5 | `?status_validacao=<status>&tamanho=100` → mesmos totais | Sim |
| `distribuicao_por_area` (`FINANCEIRO`/`SECRETARIA`) | 26/25 protocolos | `?area=FINANCEIRO`/`?area=SECRETARIA&tamanho=100` → mesmos totais e mesmo conjunto de `numero_protocolo` | Sim |
| `principais_motivos` (todos os 6 códigos) | 36/13/8/6/5/2 | `protocol_numbers.length` de cada bloco bate com `ocorrencias` | Sim |

Nenhuma divergência entre o relatório e a listagem.

### 9. Portão verde

- `pnpm exec tsc --noEmit -p tsconfig.app.json` → sem erros.
- `pnpm exec tsc --noEmit -p tsconfig.worker.json` → sem erros.
- `pnpm test` → 12 arquivos, **170 testes, 170 passando** (169 + 1 teste de caracterização novo).
- `pnpm build` → build do cliente (Vite) e checagem do worker (`tsc --noEmit`) sem erros.

### 10. O que foi corrigido e o que ficou para outra decisão

**Corrigido nesta sessão:** nada em `src/rules/**` — a implementação de `dispatch-deadline.ts` e
a redução de `authorization.ts` estão corretas, puras e já cobertas por teste de borda. Único
diff: um teste novo de caracterização em `tests/engine.test.ts` (dado incoerente, §5), que fixa
comportamento existente sem mudar nenhuma regra.

**Deixado para o dono do produto decidir**, sem alterar código (fora do escopo desta auditoria ou
exigiria inventar requisito não pedido pelo PRD):

1. Se `data_lancamento` anterior a `data_atendimento` deveria virar um problema novo (§5) — não
   ocorre na prova, não é pedido pelo PRD/RN-09.
2. Se vale unificar a validação de formato de data entre `authorization.ts` e
   `dispatch-deadline.ts` (§5) — não causa erro hoje, é só assimetria de estilo entre os dois
   arquivos.
