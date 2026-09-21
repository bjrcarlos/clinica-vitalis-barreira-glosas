/**
 * Seed determinístico das 80 guias (Fase 1 — Núcleo determinístico e dados).
 *
 * O QUE FAZ: lê `regras_convenio.json.txt` e `guias.csv` (materiais oficiais, nunca
 * editados por este script), monta o conjunto de regras com hash, normaliza as 80 guias,
 * roda o motor puro de validação (`src/rules/engine.ts`) sobre cada uma via os casos de uso
 * reais de `src/application` (`registrarGuia` + `validarGuia`), e ESCREVE um arquivo `.sql`
 * determinístico com todos os `INSERT` necessários. Este script nunca conversa com D1
 * diretamente — quem aplica o SQL é `wrangler d1 execute` (ver `package.json`, `seed:local`).
 *
 * DETERMINISMO (contrato do orquestrador — rodar duas vezes produz o MESMO arquivo):
 *   - Relógio fixo (`RelogioFixo`), recebido por `--clock` ou `SEED_CLOCK_UTC` (env);
 *     nenhuma leitura de `Date.now()`/`new Date()` implícita entra no SQL gerado.
 *   - Nenhum id aleatório: todo id interno é derivado deterministicamente do `id_guia` de
 *     origem (ver `idsProtocolo` abaixo) em vez de `crypto.randomUUID()`.
 *   - Ordem de processamento = ordem das linhas em `guias.csv` (estável).
 *
 * REEXECUÇÃO SEGURA (decisão registrada, pedida pelo orquestrador): o SQL gerado abre com
 * `DELETE FROM` nas 7 tabelas que este seed popula, dentro de uma única transação, antes de
 * reinserir tudo. Alternativa descartada: `INSERT OR REPLACE`/`ON CONFLICT` por tabela — mas
 * `protocols.protocol_number` é derivado sequencialmente (VT-26-0001..0080) a partir da
 * ordem de inserção, e a chave natural de dedup de fato é "este seed inteiro", não uma
 * linha por vez. Limpar e reinserir é mais simples, óbvio de auditar, e idempotente: aplicar
 * o mesmo `seed.sql` duas vezes termina no mesmo estado. Não toca `evidence_objects`,
 * `evidence_links` nem `protocol_merges` — fora do escopo desta fase.
 *
 * COMO RODAR: `node --experimental-transform-types scripts/seed.ts [--out <path>] [--clock <iso>]`
 * (Node 24; `--experimental-transform-types` é necessário porque as classes de
 * `src/infrastructure` usam "parameter properties" do TypeScript, que o modo padrão de
 * type-stripping do Node não converte.) Via `pnpm run seed:local` o flag já vem embutido.
 *
 * Import extensionless dentro de `src/**` (ex.: `from "./guide"`) só resolve nativamente no
 * Node quando é `import type` (apagado antes de rodar). Onde há import de VALOR sem
 * extensão (ex.: `src/rules/engine.ts` importando `PRECEDENCIA_VALIDACAO_STATUS` de
 * `../domain/statuses`), o hook de resolução registrado logo abaixo completa o `.ts` que
 * falta — sem tocar em nenhum arquivo de `src/`.
 */

import { register } from "node:module";

const HOOK_FONTE = `
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    const semExtensao = !specifier.endsWith(".ts") && !specifier.endsWith(".js") && !specifier.endsWith(".json");
    const relativo = specifier.startsWith("./") || specifier.startsWith("../");
    if (err && err.code === "ERR_MODULE_NOT_FOUND" && relativo && semExtensao) {
      return nextResolve(specifier + ".ts", context);
    }
    throw err;
  }
}
`;
register(`data:text/javascript,${encodeURIComponent(HOOK_FONTE)}`, import.meta.url);

const { mkdirSync, readFileSync, writeFileSync } = await import("node:fs");
const { dirname, join, resolve: resolvePath } = await import("node:path");
const { fileURLToPath } = await import("node:url");

const { parseCsv } = await import("../src/application/import/parse-csv.ts");
const { registrarGuia } = await import("../src/application/register-guide.ts");
const { normalizarGuia } = await import("../src/domain/normalize.ts");
const { montarConjuntoRegras } = await import("../src/rules/rule-set.ts");
const { validarGuia: motorDeValidacao } = await import("../src/rules/engine.ts");
const { RelogioFixo } = await import("../src/infrastructure/clock.ts");
const { anoUtcDoisDigitos, formatarNumeroProtocolo } = await import("../src/infrastructure/id.ts");

import type { GuiaBruta, GuiaNormalizada } from "../src/domain/guide.ts";
import type {
  CandidatoDuplicidade,
  ResultadoValidacao,
  Tarefa as TarefaDominio,
} from "../src/domain/validation.ts";
import type { ValidacaoStatus } from "../src/domain/statuses.ts";
import type {
  Eventos,
  ExecucaoSalva,
  ExecucaoValidacao,
  NovaTarefa,
  NovoProtocolo,
  Protocolos,
  ProtocoloCriado,
  ProtocoloResumo,
  Relogio,
  RegistroEvento,
  Tarefas,
  Validacoes,
  Versoes,
} from "../src/application/ports.ts";

// ---------------------------------------------------------------------------------------
// Caminhos e argumentos de linha de comando.
// ---------------------------------------------------------------------------------------

const RAIZ_PROJETO = fileURLToPath(new URL("..", import.meta.url));
const CAMINHO_REGRAS = join(RAIZ_PROJETO, "regras_convenio.json.txt");
const CAMINHO_GUIAS = join(RAIZ_PROJETO, "guias.csv");
const SAIDA_PADRAO = join(RAIZ_PROJETO, ".wrangler/seed/seed.sql");
/** Instante fixo de importação quando nem `--clock` nem `SEED_CLOCK_UTC` são informados. */
const RELOGIO_PADRAO_UTC = "2026-09-01T00:00:00.000Z";
const PRINCIPAL_SEED = "seed:fase1";

function lerArgumento(nome: string): string | null {
  const argv = process.argv.slice(2);
  const comIgual = argv.find((a) => a.startsWith(`--${nome}=`));
  if (comIgual) return comIgual.slice(nome.length + 3);
  const indice = argv.indexOf(`--${nome}`);
  if (indice !== -1 && argv[indice + 1] !== undefined) return argv[indice + 1];
  return null;
}

const caminhoSaida = resolvePath(lerArgumento("out") ?? SAIDA_PADRAO);
const relogioUtc = lerArgumento("clock") ?? process.env.SEED_CLOCK_UTC ?? RELOGIO_PADRAO_UTC;
const relogio: Relogio = new RelogioFixo(relogioUtc);

// ---------------------------------------------------------------------------------------
// Formas de linha SQL — uma por tabela populada por este seed, mesmas colunas das migrations.
// ---------------------------------------------------------------------------------------

interface LinhaRuleSet {
  readonly id: string;
  readonly version: string;
  readonly source_json: string;
  readonly source_sha256: string;
  readonly imported_at_utc: string;
  readonly activated_at_utc: string;
}

interface LinhaProtocolo {
  readonly id: string;
  protocol_number: string;
  readonly source_guide_id: string;
  readonly current_version_id: string;
  validation_status: ValidacaoStatus;
  workflow_status: "EM_TRATAMENTO";
  assigned_area: string | null;
  current_risk_cents: number;
  initial_risk_cents: number;
  readonly created_at_utc: string;
  updated_at_utc: string;
}

interface LinhaGuideVersion {
  readonly id: string;
  readonly protocol_id: string;
  readonly raw_payload_json: string;
  readonly normalized_payload_json: string;
  readonly diff_json: string;
  readonly created_by_role: string;
  readonly created_by_principal: string;
  readonly occurred_at_utc: string;
  readonly recorded_at_utc: string;
}

interface LinhaValidationRun {
  readonly id: string;
  readonly protocol_id: string;
  readonly guide_version_id: string;
  readonly rule_set_id: string;
  readonly result_status: ValidacaoStatus;
  readonly summary: string;
  readonly started_at_utc: string;
  readonly finished_at_utc: string;
}

interface LinhaValidationIssue {
  readonly id: string;
  readonly validation_run_id: string;
  readonly code: string;
  readonly title: string;
  readonly recommended_action: string;
  readonly owner_area: string;
  readonly subproblems_json: string;
  readonly rule_reference_json: string;
  readonly created_at_utc: string;
}

interface LinhaTask {
  readonly id: string;
  readonly protocol_id: string;
  readonly assigned_area: string;
  readonly task_type: string;
  readonly title: string;
  readonly blocking: 0 | 1;
  readonly created_at_utc: string;
}

interface LinhaWorkflowEvent {
  readonly id: string;
  readonly protocol_id: string;
  readonly guide_version_id: string | null;
  readonly event_type: string;
  readonly actor_role: string;
  readonly actor_principal: string;
  readonly source: string;
  readonly metadata_json: string;
  readonly occurred_at_utc: string;
  readonly recorded_at_utc: string;
}

/** Estado em memória equivalente ao que os repositórios D1 gravariam — populado pelos adapters abaixo. */
interface EstadoSeed {
  readonly ruleSets: LinhaRuleSet[];
  readonly protocolos: Map<string, LinhaProtocolo>;
  readonly protocoloPorIdGuia: Map<string, string>;
  readonly guiaNormalizadaPorProtocolo: Map<string, GuiaNormalizada>;
  readonly guideVersions: LinhaGuideVersion[];
  readonly validationRuns: LinhaValidationRun[];
  readonly validationIssues: LinhaValidationIssue[];
  readonly tasks: LinhaTask[];
  readonly workflowEvents: LinhaWorkflowEvent[];
  readonly sequencialPorAno: Map<string, number>;
}

function criarEstadoSeed(): EstadoSeed {
  return {
    ruleSets: [],
    protocolos: new Map(),
    protocoloPorIdGuia: new Map(),
    guiaNormalizadaPorProtocolo: new Map(),
    guideVersions: [],
    validationRuns: [],
    validationIssues: [],
    tasks: [],
    workflowEvents: [],
    sequencialPorAno: new Map(),
  };
}

// ---------------------------------------------------------------------------------------
// Adapters em memória das portas de `src/application/ports.ts`. Reaproveitam os mesmos
// casos de uso (`registrarGuia`, `validarGuia`) que a Fase 2 vai plugar nos repositórios D1
// reais — só a persistência muda (linha em memória → SQL, em vez de `db.prepare(...)`).
// Todo id é derivado do `id_guia`/protocolo, nunca de um contador ou de `crypto.randomUUID()`.
// ---------------------------------------------------------------------------------------

class ProtocolosMemoria implements Protocolos {
  constructor(
    private readonly estado: EstadoSeed,
    private readonly relogio: Relogio,
  ) {}

  async criarComVersaoInicial(dados: NovoProtocolo): Promise<ProtocoloCriado> {
    if (dados.idGuiaOrigem === null) {
      throw new Error("Seed da Fase 1 espera idGuiaOrigem em toda guia importada do CSV.");
    }
    const protocoloId = `protocol-${dados.idGuiaOrigem}`;
    const versaoId = `${protocoloId}-v1`;
    const registradoEmUtc = this.relogio.agoraUtc();
    const anoDoisDigitos = anoUtcDoisDigitos(dados.ocorridoEmUtc);
    const proximoSequencial = (this.estado.sequencialPorAno.get(anoDoisDigitos) ?? 0) + 1;
    this.estado.sequencialPorAno.set(anoDoisDigitos, proximoSequencial);
    const numeroProtocolo = formatarNumeroProtocolo(anoDoisDigitos, proximoSequencial);

    const linha: LinhaProtocolo = {
      id: protocoloId,
      protocol_number: numeroProtocolo,
      source_guide_id: dados.idGuiaOrigem,
      current_version_id: versaoId,
      validation_status: "REVISAO_HUMANA",
      workflow_status: "EM_TRATAMENTO",
      assigned_area: null,
      current_risk_cents: 0,
      initial_risk_cents: 0,
      created_at_utc: registradoEmUtc,
      updated_at_utc: registradoEmUtc,
    };
    this.estado.protocolos.set(protocoloId, linha);
    this.estado.protocoloPorIdGuia.set(dados.idGuiaOrigem, protocoloId);
    this.estado.guiaNormalizadaPorProtocolo.set(protocoloId, dados.guiaNormalizada);

    this.estado.guideVersions.push({
      id: versaoId,
      protocol_id: protocoloId,
      raw_payload_json: JSON.stringify(dados.guiaBruta),
      normalized_payload_json: JSON.stringify(dados.guiaNormalizada),
      diff_json: JSON.stringify(dados.avisosNormalizacao),
      created_by_role: dados.criadoPorPapel,
      created_by_principal: dados.criadoPorPrincipal,
      occurred_at_utc: dados.ocorridoEmUtc,
      recorded_at_utc: registradoEmUtc,
    });

    return { protocoloId, numeroProtocolo, versaoId };
  }

  async buscarPorNumero(numeroProtocolo: string): Promise<ProtocoloResumo | null> {
    for (const linha of this.estado.protocolos.values()) {
      if (linha.protocol_number === numeroProtocolo) return paraResumo(linha);
    }
    return null;
  }

  async buscarPorIdGuiaOrigem(idGuiaOrigem: string): Promise<ProtocoloResumo | null> {
    const protocoloId = this.estado.protocoloPorIdGuia.get(idGuiaOrigem);
    if (protocoloId === undefined) return null;
    const linha = this.estado.protocolos.get(protocoloId);
    return linha === undefined ? null : paraResumo(linha);
  }
}

function paraResumo(linha: LinhaProtocolo): ProtocoloResumo {
  return {
    protocoloId: linha.id,
    numeroProtocolo: linha.protocol_number,
    idGuiaOrigem: linha.source_guide_id,
    versaoAtualId: linha.current_version_id,
    statusValidacao: linha.validation_status,
    statusFluxo: linha.workflow_status,
    riscoAtualCents: linha.current_risk_cents,
    riscoInicialCents: linha.initial_risk_cents,
  };
}

/**
 * Mesma chave composta de `RepositorioVersoesD1` (RF-13): paciente + convênio + procedimento
 * + data do atendimento.
 *
 * ACHADO fora do escopo desta tarefa, registrado aqui em vez de corrigido: `registrarGuia`
 * (`src/application/register-guide.ts`) chama `protocolos.criarComVersaoInicial` — que já
 * grava o protocolo novo — ANTES de chamar `versoes.listarCandidatosDuplicidade`. Isso
 * significa que, quando esta função rodar contra D1 de verdade (`RepositorioVersoesD1`, cuja
 * consulta SQL não filtra `p.id != ?`), o protocolo recém-criado sempre vai bater sua própria
 * chave composta contra si mesmo e toda guia nova viraria `POSSIVEL_DUPLICIDADE` da guia
 * anterior — não é bug deste seed, é ordem de chamada + assinatura de `Versoes` (nenhuma das
 * duas tem como saber "qual protocolo é o próprio"). Aqui, como tenho o objeto em memória,
 * excluo por identidade de referência (`!==`): é o mesmo objeto `GuiaNormalizada` que
 * `registrarGuia` acabou de passar para `criarComVersaoInicial` alguns microssegundos antes,
 * nunca clonado no caminho. Não dá para replicar essa exclusão num `Versoes` real sobre D1
 * (não existe "mesma referência" depois de um round-trip em banco) — quem herdar esta base na
 * Fase 2/3 precisa reordenar a chamada (consultar duplicidade antes de criar o protocolo) ou
 * acrescentar exclusão por id ao contrato de `Versoes`.
 */
class VersoesMemoria implements Versoes {
  constructor(private readonly estado: EstadoSeed) {}

  async listarCandidatosDuplicidade(guia: GuiaNormalizada): Promise<readonly CandidatoDuplicidade[]> {
    const candidatos: CandidatoDuplicidade[] = [];
    for (const [protocoloId, linha] of this.estado.protocolos) {
      if (linha.workflow_status === "MESCLADA") continue;
      const guiaExistente = this.estado.guiaNormalizadaPorProtocolo.get(protocoloId);
      if (guiaExistente === undefined || guiaExistente === guia) continue;
      const bateChaveComposta =
        guiaExistente.convenio === guia.convenio &&
        guiaExistente.paciente === guia.paciente &&
        guiaExistente.procedimento_codigo === guia.procedimento_codigo &&
        guiaExistente.data_atendimento === guia.data_atendimento;
      if (bateChaveComposta) {
        candidatos.push({ protocoloId, numeroProtocolo: linha.protocol_number, guia: guiaExistente });
      }
    }
    return candidatos;
  }
}

/** Mesma semântica de `RepositorioValidacoesD1`: sincroniza os campos denormalizados de `protocols` na mesma "transação". */
class ValidacoesMemoria implements Validacoes {
  private readonly execucoesPorProtocolo = new Map<string, number>();

  constructor(private readonly estado: EstadoSeed) {}

  async salvarExecucao(execucao: ExecucaoValidacao): Promise<ExecucaoSalva> {
    const { resultado } = execucao;
    const runId = `${execucao.protocoloId}-run-1`;
    const issueIds = resultado.problemas.map((_problema, indice) => `${runId}-issue-${indice + 1}`);

    const execucoesAnteriores = this.execucoesPorProtocolo.get(execucao.protocoloId) ?? 0;
    this.execucoesPorProtocolo.set(execucao.protocoloId, execucoesAnteriores + 1);

    const protocolo = this.estado.protocolos.get(execucao.protocoloId);
    if (protocolo === undefined) {
      throw new Error(`Validação referencia protocolo inexistente: ${execucao.protocoloId}`);
    }
    protocolo.validation_status = resultado.status;
    protocolo.assigned_area = derivarAreaResponsavel(resultado.tarefas);
    protocolo.current_risk_cents = resultado.risco_cents;
    if (execucoesAnteriores === 0) {
      protocolo.initial_risk_cents = resultado.risco_cents;
    }
    protocolo.updated_at_utc = execucao.concluidoEmUtc;

    const ruleSet = this.estado.ruleSets[this.estado.ruleSets.length - 1];
    this.estado.validationRuns.push({
      id: runId,
      protocol_id: execucao.protocoloId,
      guide_version_id: execucao.guiaVersaoId,
      rule_set_id: ruleSet.id,
      result_status: resultado.status,
      summary: resultado.resumo,
      started_at_utc: execucao.iniciadoEmUtc,
      finished_at_utc: execucao.concluidoEmUtc,
    });

    resultado.problemas.forEach((problema, indice) => {
      this.estado.validationIssues.push({
        id: issueIds[indice],
        validation_run_id: runId,
        code: problema.codigo,
        title: problema.titulo,
        recommended_action: problema.acao_recomendada,
        owner_area: problema.area_responsavel,
        subproblems_json: JSON.stringify(problema.subproblemas),
        rule_reference_json: JSON.stringify({
          referencia_regra: problema.referencia_regra,
          regras_versao: resultado.regras_aplicadas.versao,
          regras_sha256: resultado.regras_aplicadas.sha256,
        }),
        created_at_utc: execucao.concluidoEmUtc,
      });
    });

    return { validationRunId: runId, issueIds };
  }
}

function derivarAreaResponsavel(tarefas: readonly TarefaDominio[]): string | null {
  const bloqueante = tarefas.find((tarefa) => tarefa.bloqueante);
  return (bloqueante ?? tarefas[0])?.area ?? null;
}

class TarefasMemoria implements Tarefas {
  constructor(private readonly estado: EstadoSeed) {}

  async criarEmLote(tarefas: readonly NovaTarefa[]): Promise<readonly string[]> {
    const criadoEmUtc = relogio.agoraUtc();
    const ids: string[] = [];
    tarefas.forEach((nova, indice) => {
      const id = `${nova.protocoloId}-task-${indice + 1}`;
      ids.push(id);
      this.estado.tasks.push({
        id,
        protocol_id: nova.protocoloId,
        assigned_area: nova.tarefa.area,
        task_type: nova.tarefa.tipo,
        title: nova.tarefa.titulo,
        blocking: nova.tarefa.bloqueante ? 1 : 0,
        created_at_utc: criadoEmUtc,
      });
    });
    return ids;
  }
}

/** Cada protocolo do seed recebe no máximo um evento de cada tipo (CADASTRO, VALIDACAO) — id derivado do tipo é seguro. */
class EventosMemoria implements Eventos {
  constructor(private readonly estado: EstadoSeed) {}

  async registrar(registro: RegistroEvento): Promise<string> {
    const id = `${registro.protocoloId}-evt-${registro.evento.tipo.toLowerCase()}`;
    this.estado.workflowEvents.push({
      id,
      protocol_id: registro.protocoloId,
      guide_version_id: registro.guiaVersaoId,
      event_type: registro.evento.tipo,
      actor_role: registro.evento.papel,
      actor_principal: registro.evento.ator,
      source: registro.evento.origem,
      metadata_json: JSON.stringify(registro.evento.metadata),
      occurred_at_utc: registro.evento.ocorrido_em_utc,
      recorded_at_utc: registro.evento.registrado_em_utc,
    });
    return id;
  }
}

// ---------------------------------------------------------------------------------------
// SHA-256 hex via WebCrypto (disponível global no Node 24, mesma técnica de
// `src/infrastructure/rules/load-rule-set.ts` — não reimporta aquele arquivo porque ele
// exige um `D1Database` vivo, incompatível com este script que só gera texto SQL).
// ---------------------------------------------------------------------------------------
async function sha256Hex(texto: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

// ---------------------------------------------------------------------------------------
// Serialização SQL — literais, sem parâmetros (o arquivo gerado é estático e revisável).
// ---------------------------------------------------------------------------------------
function sqlTexto(valor: string | null): string {
  if (valor === null) return "NULL";
  return `'${valor.replace(/'/g, "''")}'`;
}

function sqlNumero(valor: number): string {
  if (!Number.isFinite(valor)) {
    throw new Error(`Valor numérico não finito não pode virar literal SQL: ${valor}`);
  }
  return String(valor);
}

/**
 * D1 recusa uma única instrução SQL grande demais (`SQLITE_TOOBIG`, medido nesta sessão em
 * ~100 KB — `guide_versions`, com os três JSONs por guia, passava disso num só `INSERT`
 * multi-linha para as 80 guias). Por isso cada `INSERT` é fatiado por orçamento de bytes, não
 * por contagem fixa de linhas (linhas de tamanho muito desigual, ex.: `rule_sets` tem 1 linha
 * gigante, `tasks` tem várias pequenas). A ordem das linhas nunca muda entre execuções.
 */
const ORCAMENTO_BYTES_POR_INSERT = 60_000;

function gerarInsert<T extends Record<string, unknown>>(
  tabela: string,
  colunas: readonly (keyof T & string)[],
  linhas: readonly T[],
): string {
  if (linhas.length === 0) return `-- ${tabela}: nenhuma linha nesta carga.\n`;

  const cabecalho = `INSERT INTO ${tabela} (${colunas.join(", ")}) VALUES\n`;
  const tuplas = linhas.map((linha) => {
    const campos = colunas.map((coluna) => {
      const valor = linha[coluna];
      if (valor === null) return "NULL";
      if (typeof valor === "number") return sqlNumero(valor);
      return sqlTexto(String(valor));
    });
    return `  (${campos.join(", ")})`;
  });

  const statements: string[] = [];
  let loteAtual: string[] = [];
  let bytesLoteAtual = cabecalho.length;

  function fecharLote(): void {
    if (loteAtual.length === 0) return;
    statements.push(`${cabecalho}${loteAtual.join(",\n")};\n`);
    loteAtual = [];
    bytesLoteAtual = cabecalho.length;
  }

  for (const tupla of tuplas) {
    const bytesTupla = Buffer.byteLength(tupla, "utf8") + 2; // + ",\n"
    if (loteAtual.length > 0 && bytesLoteAtual + bytesTupla > ORCAMENTO_BYTES_POR_INSERT) {
      fecharLote();
    }
    loteAtual.push(tupla);
    bytesLoteAtual += bytesTupla;
  }
  fecharLote();

  return statements.join("\n");
}

// ---------------------------------------------------------------------------------------
// Execução: carrega regras + guias, roda o caso de uso real sobre cada uma, monta o SQL.
// ---------------------------------------------------------------------------------------

async function main(): Promise<void> {
  const textoRegras = readFileSync(CAMINHO_REGRAS, "utf8");
  const textoGuias = readFileSync(CAMINHO_GUIAS, "utf8");

  const shaRegras = await sha256Hex(textoRegras);
  const conjuntoRegras = montarConjuntoRegras(textoRegras, shaRegras);

  const { linhas: guiasBrutas, rejeitadas } = parseCsv(textoGuias) as {
    linhas: readonly GuiaBruta[];
    rejeitadas: readonly { numero_linha: number; motivo: string }[];
  };
  if (rejeitadas.length > 0) {
    const detalhe = rejeitadas.map((r) => `linha ${r.numero_linha}: ${r.motivo}`).join("; ");
    throw new Error(`guias.csv tem linha(s) rejeitada(s) pelo parser — seed espera as 80 guias íntegras. ${detalhe}`);
  }
  if (guiasBrutas.length !== 80) {
    throw new Error(`Esperava exatamente 80 guias em guias.csv, encontrei ${guiasBrutas.length}.`);
  }

  const estado = criarEstadoSeed();
  const agoraUtc = relogio.agoraUtc();
  const ruleSetId = `rule-set-${conjuntoRegras.versao.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;
  estado.ruleSets.push({
    id: ruleSetId,
    version: conjuntoRegras.versao,
    source_json: textoRegras,
    source_sha256: shaRegras,
    imported_at_utc: agoraUtc,
    activated_at_utc: agoraUtc,
  });

  const protocolos = new ProtocolosMemoria(estado, relogio);
  const versoes = new VersoesMemoria(estado);
  const validacoes = new ValidacoesMemoria(estado);
  const tarefas = new TarefasMemoria(estado);
  const eventos = new EventosMemoria(estado);

  const contagemPorStatus = new Map<ValidacaoStatus, number>();
  let riscoTotalCents = 0;

  for (const guiaBruta of guiasBrutas) {
    const { guia, avisos } = normalizarGuia(guiaBruta);

    const saida = await registrarGuia(
      {
        idGuiaOrigem: guia.id_guia,
        guiaBruta,
        guiaNormalizada: guia,
        avisosNormalizacao: avisos,
        criadoPorPapel: "SISTEMA",
        criadoPorPrincipal: PRINCIPAL_SEED,
        origem: "IMPORTACAO",
        regras: conjuntoRegras,
      },
      {
        protocolos,
        versoes,
        eventos,
        relogio,
        validarGuiaDependencias: {
          motor: (g, r, c) => motorDeValidacao(g, r, c) as ResultadoValidacao,
          validacoes,
          tarefas,
          eventos,
          relogio,
        },
      },
    );

    if (saida.jaExistia) {
      throw new Error(`id_guia duplicado em guias.csv: ${guia.id_guia} já tinha protocolo aberto.`);
    }

    const status = saida.validacao.resultado.status;
    contagemPorStatus.set(status, (contagemPorStatus.get(status) ?? 0) + 1);
    riscoTotalCents += saida.validacao.resultado.risco_cents;
  }

  const sql = montarSql(estado);
  mkdirSync(dirname(caminhoSaida), { recursive: true });
  writeFileSync(caminhoSaida, sql, "utf8");

  imprimirResumo({
    caminhoSaida,
    tamanhoBytes: Buffer.byteLength(sql, "utf8"),
    totalGuias: guiasBrutas.length,
    contagemPorStatus,
    riscoTotalCents,
    versaoRegras: conjuntoRegras.versao,
    shaRegras,
    relogioUtc,
  });
}

function montarSql(estado: EstadoSeed): string {
  const partes: string[] = [];
  partes.push(
    "-- Seed determinístico da Fase 1 — gerado por scripts/seed.ts.",
    "-- NÃO EDITAR À MÃO: rode `pnpm run seed:local` para regenerar.",
    "-- Reexecução segura: limpa as 7 tabelas desta carga e reinsere tudo (ver comentário",
    "-- de topo de scripts/seed.ts para o porquê). evidence_objects, evidence_links e",
    "-- protocol_merges não são tocados (fora do escopo da Fase 1).",
    "BEGIN TRANSACTION;",
    "",
    "DELETE FROM tasks;",
    "DELETE FROM workflow_events;",
    "DELETE FROM validation_issues;",
    "DELETE FROM validation_runs;",
    "DELETE FROM guide_versions;",
    "DELETE FROM protocols;",
    "DELETE FROM rule_sets;",
    "",
  );

  partes.push(
    gerarInsert(
      "rule_sets",
      ["id", "version", "source_json", "source_sha256", "imported_at_utc", "activated_at_utc", "is_active"],
      estado.ruleSets.map((r) => ({ ...r, is_active: 1 })),
    ),
  );

  const colunasProtocols = [
    "id", "protocol_number", "source_guide_id", "current_version_id", "validation_status",
    "workflow_status", "assigned_area", "current_risk_cents", "initial_risk_cents",
    "merged_into_protocol_id", "created_at_utc", "updated_at_utc",
  ] as const;
  partes.push(
    gerarInsert(
      "protocols",
      colunasProtocols,
      Array.from(estado.protocolos.values()).map((p) => ({ ...p, merged_into_protocol_id: null })),
    ),
  );

  const colunasGuideVersions = [
    "id", "protocol_id", "version_number", "raw_payload_json", "normalized_payload_json",
    "diff_json", "change_reason", "created_by_role", "created_by_principal",
    "occurred_at_utc", "recorded_at_utc",
  ] as const;
  partes.push(
    gerarInsert(
      "guide_versions",
      colunasGuideVersions,
      estado.guideVersions.map((v) => ({ ...v, version_number: 1, change_reason: null })),
    ),
  );

  const colunasValidationRuns = [
    "id", "protocol_id", "guide_version_id", "rule_set_id", "result_status", "summary",
    "ai_status", "ai_model", "ai_prompt_version", "ai_input_json", "ai_output_json",
    "started_at_utc", "finished_at_utc",
  ] as const;
  partes.push(
    gerarInsert(
      "validation_runs",
      colunasValidationRuns,
      estado.validationRuns.map((r) => ({
        ...r,
        ai_status: "NAO_EXECUTADA",
        ai_model: null,
        ai_prompt_version: null,
        ai_input_json: null,
        ai_output_json: null,
      })),
    ),
  );

  const colunasValidationIssues = [
    "id", "validation_run_id", "code", "title", "recommended_action", "owner_area",
    "status", "subproblems_json", "rule_reference_json", "created_at_utc", "resolved_at_utc",
  ] as const;
  partes.push(
    gerarInsert(
      "validation_issues",
      colunasValidationIssues,
      estado.validationIssues.map((i) => ({ ...i, status: "ABERTO", resolved_at_utc: null })),
    ),
  );

  const colunasTasks = [
    "id", "protocol_id", "issue_id", "assigned_area", "task_type", "title", "status",
    "blocking", "created_at_utc", "resolved_at_utc",
  ] as const;
  partes.push(
    gerarInsert(
      "tasks",
      colunasTasks,
      estado.tasks.map((t) => ({ ...t, issue_id: null, status: "ABERTA", resolved_at_utc: null })),
    ),
  );

  const colunasWorkflowEvents = [
    "id", "protocol_id", "guide_version_id", "event_type", "actor_role", "actor_principal",
    "source", "reason", "metadata_json", "occurred_at_utc", "recorded_at_utc",
  ] as const;
  partes.push(
    gerarInsert("workflow_events", colunasWorkflowEvents, estado.workflowEvents.map((e) => ({ ...e, reason: null }))),
  );

  partes.push("COMMIT;", "");
  return partes.join("\n");
}

function imprimirResumo(dados: {
  caminhoSaida: string;
  tamanhoBytes: number;
  totalGuias: number;
  contagemPorStatus: Map<ValidacaoStatus, number>;
  riscoTotalCents: number;
  versaoRegras: string;
  shaRegras: string;
  relogioUtc: string;
}): void {
  const ORDEM: readonly ValidacaoStatus[] = ["OK", "CORRIGIR", "REVISAO_HUMANA", "NAO_FATURAR_CONVENIO"];
  console.log(`Regras aplicadas: ${dados.versaoRegras} (sha256 ${dados.shaRegras.slice(0, 12)}…)`);
  console.log(`Relógio fixo do seed: ${dados.relogioUtc}`);
  console.log(`Guias processadas: ${dados.totalGuias} (protocolos criados: ${dados.totalGuias})`);
  console.log("Por status de validação:");
  for (const status of ORDEM) {
    const quantidade = dados.contagemPorStatus.get(status) ?? 0;
    console.log(`  ${status.padEnd(22)}: ${quantidade}`);
  }
  console.log(`Risco total (current_risk_cents somado): ${dados.riscoTotalCents} centavos`);
  console.log(`SQL gerado em: ${dados.caminhoSaida} (${dados.tamanhoBytes} bytes)`);
}

await main();
