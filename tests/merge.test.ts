import { DatabaseSync, type StatementSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";

import type { GuiaBruta, GuiaNormalizada } from "../src/domain/guide";
import { GeradorIdCrypto } from "../src/infrastructure/id";
import { RelogioFixo } from "../src/infrastructure/clock";
import { RepositorioEventosD1 } from "../src/infrastructure/d1/events";
import { RepositorioProtocolosD1 } from "../src/infrastructure/d1/protocols";
import { RepositorioTarefasD1 } from "../src/infrastructure/d1/tasks";
import { RepositorioValidacoesD1 } from "../src/infrastructure/d1/validations";
import { RepositorioVersoesD1 } from "../src/infrastructure/d1/versions";
import { registrarGuia, type RegistrarGuiaDependencias } from "../src/application/register-guide";
import { carregarESalvarConjuntoRegras } from "../src/infrastructure/rules/load-rule-set";
import { validarGuia as motorValidacaoReal } from "../src/rules/engine";
import { compararMerge, executarMerge } from "../src/http/handlers/merges";
import { buscarResumoWire } from "../src/http/handlers/create-protocol";
import { montarRelatorio } from "../src/http/handlers/report";

/**
 * Cobertura de integração do merge (RF-13, PRD-SDD §26) que faltava: até aqui só existia
 * cobertura de schema/roteamento em `tests/http-contracts.test.ts`. Mesmo adaptador D1-sobre-
 * `node:sqlite` de `tests/repositories.test.ts` (não reexportado de lá — infraestrutura de
 * teste local, como os outros arquivos desta suíte já fazem, para não acoplar a outro agente).
 */
class SqliteD1Statement {
  constructor(
    private readonly db: DatabaseSync,
    private readonly sql: string,
    private readonly valores: unknown[] = [],
  ) {}

  bind(...valores: unknown[]): SqliteD1Statement {
    return new SqliteD1Statement(this.db, this.sql, valores);
  }

  private preparar(): StatementSync {
    return this.db.prepare(this.sql);
  }

  async first<T>(): Promise<T | null> {
    const linha = this.preparar().get(...(this.valores as never[]));
    return (linha ?? null) as T | null;
  }

  async run<T>(): Promise<{ success: true; meta: Record<string, unknown>; results: T[] }> {
    return this.all<T>();
  }

  async all<T>(): Promise<{ success: true; meta: Record<string, unknown>; results: T[] }> {
    const linhas = this.preparar().all(...(this.valores as never[]));
    return { success: true, meta: {}, results: linhas as T[] };
  }
}

class SqliteD1Database {
  constructor(private readonly db: DatabaseSync) {}

  prepare(sql: string): SqliteD1Statement {
    return new SqliteD1Statement(this.db, sql);
  }

  async batch<T>(
    statements: SqliteD1Statement[],
  ): Promise<Array<{ success: true; meta: Record<string, unknown>; results: T[] }>> {
    this.db.exec("BEGIN");
    try {
      const resultados = [];
      for (const statement of statements) {
        resultados.push(await statement.all<T>());
      }
      this.db.exec("COMMIT");
      return resultados;
    } catch (erro) {
      this.db.exec("ROLLBACK");
      throw erro;
    }
  }
}

/**
 * Mesmo adaptador acima, mas capaz de lançar NO MEIO de um `db.batch()` — usado só pelo teste
 * de atomicidade. `totalEscritas` conta toda escrita que passa por QUALQUER `batch()` desta
 * instância, do início ao fim do teste (não é resetado entre chamadas): se o merge alguma hora
 * voltar a fazer vários `db.batch()` separados, uma falha na Nª escrita GLOBAL só reverte o
 * `batch()` em que ela caiu — os `batch()` anteriores já teriam commitado sozinhos, e é
 * exatamente essa diferença que o teste "atomicidade" abaixo detecta.
 */
class SqliteD1DatabaseComSabotagem {
  totalEscritas = 0;

  constructor(
    private readonly db: DatabaseSync,
    private readonly falharNaEscritaNumero: number,
  ) {}

  prepare(sql: string): SqliteD1Statement {
    return new SqliteD1Statement(this.db, sql);
  }

  async batch<T>(
    statements: SqliteD1Statement[],
  ): Promise<Array<{ success: true; meta: Record<string, unknown>; results: T[] }>> {
    this.db.exec("BEGIN");
    try {
      const resultados: Array<{ success: true; meta: Record<string, unknown>; results: T[] }> = [];
      for (const statement of statements) {
        this.totalEscritas += 1;
        if (this.totalEscritas === this.falharNaEscritaNumero) {
          throw new Error(`Sabotagem de teste: falha injetada na escrita global #${this.falharNaEscritaNumero}.`);
        }
        resultados.push(await statement.all<T>());
      }
      this.db.exec("COMMIT");
      return resultados;
    } catch (erro) {
      this.db.exec("ROLLBACK");
      throw erro;
    }
  }
}

function criarBancoDeTeste(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const migracao = readFileSync(resolve(__dirname, "../migrations/0001_init.sql"), "utf-8");
  db.exec(migracao);
  return db;
}

function contar(db: DatabaseSync, tabela: string): number {
  const linha = db.prepare(`SELECT COUNT(*) AS total FROM ${tabela}`).get() as { total: number };
  return linha.total;
}

/** Todas as tabelas que o merge toca ou poderia tocar — usada para provar "nada foi apagado". */
const TABELAS_HISTORICAS = [
  "protocols",
  "guide_versions",
  "validation_runs",
  "validation_issues",
  "tasks",
  "workflow_events",
  "evidence_objects",
  "evidence_links",
  "protocol_merges",
  "rule_sets",
] as const;

function fotografarContagens(db: DatabaseSync): Record<string, number> {
  return Object.fromEntries(TABELAS_HISTORICAS.map((tabela) => [tabela, contar(db, tabela)]));
}

// --- Regras e guia REAIS (mesma fonte de tests/engine.test.ts): nunca fixture inventada para o
// motor determinístico, só para não herdar acidentalmente um desvio do gerador de fixtures. ---

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEXTO_REGRAS_OFICIAIS = readFileSync(resolve(__dirname, "../regras_convenio.json.txt"), "utf-8");
const AGORA_UTC = "2026-09-20T12:00:00.000Z";

const GUIA_BASE: GuiaNormalizada = {
  id_guia: "G-TESTE-0001",
  unidade: "Unidade Centro",
  data_atendimento: "2026-08-10",
  paciente: "Paciente Teste Merge",
  convenio: "Vitalcard",
  carteirinha: "1234567890",
  cid: "M54.5",
  procedimento_codigo: "50000470",
  procedimento_descricao: "Sessão de fisioterapia musculoesquelética",
  numero_autorizacao: "AUT-0001",
  autorizacao_validade: "2026-08-20",
  autorizacao_sessoes_limite: 10,
  sessao_numero_na_autorizacao: 3,
  profissional: "Dra. Ana Souza",
  profissional_registro: "CREFITO-12345",
  valor_cents: 6200,
  observacao_recepcao: "",
  data_lancamento: "2026-08-10",
};

function guiaFixture(overrides: Partial<GuiaNormalizada> = {}): GuiaNormalizada {
  return { ...GUIA_BASE, ...overrides };
}

function guiaBrutaFixture(overrides: Partial<Record<string, string>> = {}): GuiaBruta {
  return {
    id_guia: GUIA_BASE.id_guia,
    unidade: GUIA_BASE.unidade,
    data_atendimento: GUIA_BASE.data_atendimento,
    paciente: GUIA_BASE.paciente,
    convenio: GUIA_BASE.convenio,
    carteirinha: GUIA_BASE.carteirinha,
    cid: GUIA_BASE.cid ?? "",
    procedimento_codigo: GUIA_BASE.procedimento_codigo,
    procedimento_descricao: GUIA_BASE.procedimento_descricao,
    numero_autorizacao: GUIA_BASE.numero_autorizacao ?? "",
    autorizacao_validade: GUIA_BASE.autorizacao_validade,
    autorizacao_sessoes_limite: String(GUIA_BASE.autorizacao_sessoes_limite),
    sessao_numero_na_autorizacao: String(GUIA_BASE.sessao_numero_na_autorizacao),
    profissional: GUIA_BASE.profissional,
    profissional_registro: GUIA_BASE.profissional_registro ?? "",
    valor: "62.00",
    observacao_recepcao: GUIA_BASE.observacao_recepcao,
    data_lancamento: GUIA_BASE.data_lancamento,
    ...overrides,
  };
}

function construirDependenciasRegistro(
  d1: D1Database,
  ids: GeradorIdCrypto,
  relogio: RelogioFixo,
): RegistrarGuiaDependencias {
  return {
    protocolos: new RepositorioProtocolosD1(d1, ids, relogio),
    versoes: new RepositorioVersoesD1(d1),
    eventos: new RepositorioEventosD1(d1, ids),
    relogio,
    validarGuiaDependencias: {
      motor: motorValidacaoReal,
      validacoes: new RepositorioValidacoesD1(d1, ids),
      tarefas: new RepositorioTarefasD1(d1, ids, relogio),
      eventos: new RepositorioEventosD1(d1, ids),
      relogio,
    },
  };
}

/**
 * Cenário-base de todos os testes: duas guias com o mesmo núcleo de duplicidade (paciente +
 * convênio + procedimento + data de atendimento + carteirinha) e `valor_cents` divergente — a
 * SEGUNDA (`origem`) nasce com `POSSIVEL_DUPLICIDADE` aberta contra a primeira (`principal`),
 * a própria pré-condição de merge do PRD §26.1. Chamável contra qualquer adaptador D1-like
 * sobre um banco recém-criado (usado tanto no cenário normal quanto no de sabotagem).
 */
async function montarCenarioBase(d1: D1Database) {
  const ids = new GeradorIdCrypto();
  const relogio = new RelogioFixo(AGORA_UTC);
  const { conjunto: regras } = await carregarESalvarConjuntoRegras(TEXTO_REGRAS_OFICIAIS, d1, relogio, ids);
  const deps = construirDependenciasRegistro(d1, ids, relogio);

  const principalCriado = await registrarGuia(
    {
      idGuiaOrigem: "G-TESTE-PRINCIPAL",
      guiaBruta: guiaBrutaFixture({ id_guia: "G-TESTE-PRINCIPAL" }),
      guiaNormalizada: guiaFixture({ id_guia: "G-TESTE-PRINCIPAL" }),
      avisosNormalizacao: [],
      criadoPorPapel: "SECRETARIA",
      criadoPorPrincipal: "recepcao@vitalis",
      origem: "IMPORTACAO",
      regras,
    },
    deps,
  );
  if (principalCriado.jaExistia) throw new Error("setup do teste: principal não deveria já existir");

  const origemCriado = await registrarGuia(
    {
      idGuiaOrigem: "G-TESTE-ORIGEM",
      guiaBruta: guiaBrutaFixture({ id_guia: "G-TESTE-ORIGEM", valor: "68.00" }),
      guiaNormalizada: guiaFixture({ id_guia: "G-TESTE-ORIGEM", valor_cents: 6800 }),
      avisosNormalizacao: [],
      criadoPorPapel: "SECRETARIA",
      criadoPorPrincipal: "recepcao@vitalis",
      origem: "IMPORTACAO",
      regras,
    },
    deps,
  );
  if (origemCriado.jaExistia) throw new Error("setup do teste: origem não deveria já existir");

  return {
    regras,
    principalNumero: principalCriado.protocolo.numeroProtocolo,
    principalId: principalCriado.protocolo.protocoloId,
    principalVersaoId: principalCriado.protocolo.versaoId,
    origemNumero: origemCriado.protocolo.numeroProtocolo,
    origemId: origemCriado.protocolo.protocoloId,
    origemVersaoId: origemCriado.protocolo.versaoId,
    origemValidacao: origemCriado.validacao,
  };
}

const CORPO_MERGE_PADRAO = (principalNumero: string, origemNumero: string) => ({
  numero_protocolo_principal: principalNumero,
  numero_protocolo_origem: origemNumero,
  resolucao_campos: [{ campo: "valor_cents", valor_escolhido: "6800" }],
  motivo: "Mesma sessão de fisioterapia lançada duas vezes por engano da recepção.",
});

describe("executarMerge — merge feliz (RF-13, PRD §26.2)", () => {
  let dbBruto: DatabaseSync;
  let db: D1Database;
  let cenario: Awaited<ReturnType<typeof montarCenarioBase>>;

  beforeEach(async () => {
    dbBruto = criarBancoDeTeste();
    db = new SqliteD1Database(dbBruto) as never;
    cenario = await montarCenarioBase(db);
  });

  it("cria versão nova no principal, mescla a origem, preserva histórico e evidências das duas origens", async () => {
    // Sanity do próprio fixture: a suspeita de duplicidade que o PRD §26.1 exige já existe.
    expect(cenario.origemValidacao.resultado.problemas.some((p) => p.codigo === "POSSIVEL_DUPLICIDADE")).toBe(true);

    // Evidência preexistente nos dois lados, para provar o vínculo sem duplicar objeto (passo 5).
    const evidenciaPrincipalId = "ev-principal-1";
    const evidenciaOrigemId = "ev-origem-1";
    dbBruto
      .prepare(
        `INSERT INTO evidence_objects (id, r2_key, original_filename, content_type, size_bytes, sha256, uploaded_by_role, uploaded_by_principal, uploaded_at_utc, invalidated_at_utc, invalidation_reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)`,
      )
      .run(evidenciaPrincipalId, "r2/principal.pdf", "principal.pdf", "application/pdf", 100, "sha-principal", "SECRETARIA", "recepcao@vitalis", AGORA_UTC);
    dbBruto
      .prepare(
        `INSERT INTO evidence_links (evidence_id, protocol_id, event_id, guide_version_id, relation_type, origin_protocol_id)
         VALUES (?, ?, NULL, ?, 'importacao', ?)`,
      )
      .run(evidenciaPrincipalId, cenario.principalId, cenario.principalVersaoId, cenario.principalId);
    dbBruto
      .prepare(
        `INSERT INTO evidence_objects (id, r2_key, original_filename, content_type, size_bytes, sha256, uploaded_by_role, uploaded_by_principal, uploaded_at_utc, invalidated_at_utc, invalidation_reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)`,
      )
      .run(evidenciaOrigemId, "r2/origem.pdf", "origem.pdf", "application/pdf", 200, "sha-origem", "SECRETARIA", "recepcao@vitalis", AGORA_UTC);
    dbBruto
      .prepare(
        `INSERT INTO evidence_links (evidence_id, protocol_id, event_id, guide_version_id, relation_type, origin_protocol_id)
         VALUES (?, ?, NULL, ?, 'importacao', ?)`,
      )
      .run(evidenciaOrigemId, cenario.origemId, cenario.origemVersaoId, cenario.origemId);

    const antes = fotografarContagens(dbBruto);

    const resposta = await executarMerge(db, "FINANCEIRO", CORPO_MERGE_PADRAO(cenario.principalNumero, cenario.origemNumero));

    // 1) versão nova no principal.
    expect(resposta.protocolo_principal.numero_versao_atual).toBe(2);
    expect(resposta.protocolo_principal.status_fluxo).toBe("EM_TRATAMENTO");
    expect(resposta.merge.numero_versao_resultante).toBe(2);

    // 2) origem MESCLADA, apontando para o principal certo, sem contar risco de novo.
    const origemLinha = dbBruto
      .prepare("SELECT workflow_status, merged_into_protocol_id, current_risk_cents FROM protocols WHERE id = ?")
      .get(cenario.origemId) as { workflow_status: string; merged_into_protocol_id: string; current_risk_cents: number };
    expect(origemLinha.workflow_status).toBe("MESCLADA");
    expect(origemLinha.merged_into_protocol_id).toBe(cenario.principalId);
    expect(origemLinha.current_risk_cents).toBe(0);

    // 3) protocol_merges com a resolução campo a campo e o motivo.
    const mergeLinha = dbBruto
      .prepare("SELECT target_protocol_id, target_version_id, field_resolution_json, reason FROM protocol_merges WHERE source_protocol_id = ?")
      .get(cenario.origemId) as { target_protocol_id: string; target_version_id: string; field_resolution_json: string; reason: string };
    expect(mergeLinha.target_protocol_id).toBe(cenario.principalId);
    expect(JSON.parse(mergeLinha.field_resolution_json)).toEqual([{ campo: "valor_cents", valor_escolhido: "6800" }]);
    expect(mergeLinha.reason).toContain("engano da recepção");

    // 4) evento MERGE nos DOIS protocolos.
    const eventosMerge = dbBruto.prepare("SELECT protocol_id FROM workflow_events WHERE event_type = 'MERGE'").all() as {
      protocol_id: string;
    }[];
    expect(eventosMerge.map((e) => e.protocol_id).sort()).toEqual([cenario.origemId, cenario.principalId].sort());

    // 5) evidências das duas origens vinculadas ao principal, preservando origin_protocol_id — sem duplicar objeto.
    const linksPrincipal = dbBruto
      .prepare("SELECT evidence_id, origin_protocol_id FROM evidence_links WHERE protocol_id = ?")
      .all(cenario.principalId) as { evidence_id: string; origin_protocol_id: string }[];
    expect(linksPrincipal).toHaveLength(2);
    expect(linksPrincipal).toEqual(
      expect.arrayContaining([
        { evidence_id: evidenciaPrincipalId, origin_protocol_id: cenario.principalId },
        { evidence_id: evidenciaOrigemId, origin_protocol_id: cenario.origemId },
      ]),
    );
    expect(contar(dbBruto, "evidence_objects")).toBe(2);

    // 6) nada foi apagado em nenhuma tabela — só cresceu ou ficou igual.
    const depois = fotografarContagens(dbBruto);
    for (const tabela of TABELAS_HISTORICAS) {
      expect(depois[tabela]).toBeGreaterThanOrEqual(antes[tabela]);
    }
    expect(depois.protocols).toBe(antes.protocols);
    expect(depois.guide_versions).toBe(antes.guide_versions + 1);
    expect(depois.protocol_merges).toBe(antes.protocol_merges + 1);
    expect(depois.workflow_events).toBe(antes.workflow_events + 3); // VALIDACAO + MERGE(principal) + MERGE(origem)
  });
});

describe("executarMerge — atomicidade (defeito confirmado por auditoria, PRD §26.2)", () => {
  it("uma falha no meio da transação não deixa NADA gravado pela metade", async () => {
    // Passo 1: mede quantas escritas o merge faz no total, sem sabotagem nenhuma.
    const dbContagem = criarBancoDeTeste();
    const cenarioContagem = await montarCenarioBase(new SqliteD1Database(dbContagem) as never);
    const contador = new SqliteD1DatabaseComSabotagem(dbContagem, Number.MAX_SAFE_INTEGER);
    await executarMerge(
      contador as never,
      "FINANCEIRO",
      CORPO_MERGE_PADRAO(cenarioContagem.principalNumero, cenarioContagem.origemNumero),
    );
    const totalDeEscritas = contador.totalEscritas;
    expect(totalDeEscritas).toBeGreaterThan(5); // sanity: o merge realmente grava várias linhas.

    // Passo 2: banco NOVO e idêntico. O setup roda sem sabotagem; só a chamada de
    // `executarMerge` usa o duplo sabotado, com o contador ZERADO nesse ponto — a escrita que
    // falha é a ÚLTIMA do próprio merge (a #totalDeEscritas, medida acima).
    const dbSabotado = criarBancoDeTeste();
    const cenario = await montarCenarioBase(new SqliteD1Database(dbSabotado) as never);
    const antes = fotografarContagens(dbSabotado);
    const antesPrincipal = dbSabotado
      .prepare("SELECT current_version_id, workflow_status FROM protocols WHERE id = ?")
      .get(cenario.principalId);
    const antesOrigem = dbSabotado
      .prepare("SELECT workflow_status, merged_into_protocol_id, current_risk_cents FROM protocols WHERE id = ?")
      .get(cenario.origemId);

    const adaptadorSabotado = new SqliteD1DatabaseComSabotagem(dbSabotado, totalDeEscritas);

    await expect(
      executarMerge(adaptadorSabotado as never, "FINANCEIRO", CORPO_MERGE_PADRAO(cenario.principalNumero, cenario.origemNumero)),
    ).rejects.toThrow(/Sabotagem de teste/);

    // Nenhuma tabela mudou de contagem — nem para mais (linha nova) nem para menos.
    const depois = fotografarContagens(dbSabotado);
    expect(depois).toEqual(antes);

    // O principal continua exatamente como estava: sem versão nova, sem novo workflow_status.
    const depoisPrincipal = dbSabotado
      .prepare("SELECT current_version_id, workflow_status FROM protocols WHERE id = ?")
      .get(cenario.principalId);
    expect(depoisPrincipal).toEqual(antesPrincipal);

    // A origem continua exatamente como estava: sem marca de MESCLADA.
    const depoisOrigem = dbSabotado
      .prepare("SELECT workflow_status, merged_into_protocol_id, current_risk_cents FROM protocols WHERE id = ?")
      .get(cenario.origemId);
    expect(depoisOrigem).toEqual(antesOrigem);

    expect(contar(dbSabotado, "protocol_merges")).toBe(0);
    expect(
      (dbSabotado.prepare("SELECT COUNT(*) AS total FROM workflow_events WHERE event_type = 'MERGE'").get() as { total: number })
        .total,
    ).toBe(0);
  });
});

describe("executarMerge — recusas (PRD §26.1)", () => {
  let dbBruto: DatabaseSync;
  let db: D1Database;
  let cenario: Awaited<ReturnType<typeof montarCenarioBase>>;

  beforeEach(async () => {
    dbBruto = criarBancoDeTeste();
    db = new SqliteD1Database(dbBruto) as never;
    cenario = await montarCenarioBase(db);
  });

  it("recusa papel diferente de FINANCEIRO", async () => {
    await expect(
      executarMerge(db, "SECRETARIA", CORPO_MERGE_PADRAO(cenario.principalNumero, cenario.origemNumero)),
    ).rejects.toMatchObject({ codigo: "ROLE_NOT_ALLOWED" });
  });

  it("recusa mesclar um protocolo consigo mesmo", async () => {
    await expect(
      executarMerge(db, "FINANCEIRO", CORPO_MERGE_PADRAO(cenario.principalNumero, cenario.principalNumero)),
    ).rejects.toMatchObject({ codigo: "DUPLICATE_MERGE_CONFLICT" });
  });

  it("recusa mesclar um protocolo já mesclado", async () => {
    dbBruto.prepare("UPDATE protocols SET workflow_status = 'MESCLADA' WHERE id = ?").run(cenario.origemId);
    await expect(
      executarMerge(db, "FINANCEIRO", CORPO_MERGE_PADRAO(cenario.principalNumero, cenario.origemNumero)),
    ).rejects.toMatchObject({ codigo: "DUPLICATE_MERGE_CONFLICT" });
  });

  it("recusa resolução citando campo que não diverge entre os protocolos (inclui campo inexistente)", async () => {
    await expect(
      executarMerge(db, "FINANCEIRO", {
        numero_protocolo_principal: cenario.principalNumero,
        numero_protocolo_origem: cenario.origemNumero,
        resolucao_campos: [{ campo: "campo_fantasma", valor_escolhido: "qualquer" }],
        motivo: "Campo que não existe na comparação entre os dois protocolos.",
      }),
    ).rejects.toMatchObject({ codigo: "DUPLICATE_MERGE_CONFLICT" });
  });

  it("compararMerge concorda com executarMerge sobre quais campos divergem", async () => {
    const comparacao = await compararMerge(db, "FINANCEIRO", {
      numero_protocolo_a: cenario.principalNumero,
      numero_protocolo_b: cenario.origemNumero,
    });
    expect(comparacao.campos_divergentes.map((c) => c.campo)).toEqual(["valor_cents"]);
    expect(comparacao.suspeita_duplicidade_aberta).toBe(true);
  });
});

describe("executarMerge — risco e relatório (PRD §27.3, §27.4)", () => {
  it("depois do merge, o risco do par conta uma vez só; a origem some de 'exige atenção' mas não do histórico", async () => {
    const dbBruto = criarBancoDeTeste();
    const db = new SqliteD1Database(dbBruto) as never as D1Database;
    const cenario = await montarCenarioBase(db);

    const relatorioAntes = await montarRelatorio(db);
    expect(relatorioAntes.exigem_atencao.protocol_numbers).toEqual(expect.arrayContaining([cenario.origemNumero]));
    expect(relatorioAntes.risco_inicial_cents.protocol_numbers).toEqual(expect.arrayContaining([cenario.origemNumero]));

    await executarMerge(db, "FINANCEIRO", CORPO_MERGE_PADRAO(cenario.principalNumero, cenario.origemNumero));

    const relatorioDepois = await montarRelatorio(db);
    expect(relatorioDepois.exigem_atencao.protocol_numbers).not.toContain(cenario.origemNumero);
    expect(relatorioDepois.risco_inicial_cents.protocol_numbers).not.toContain(cenario.origemNumero);

    // O protocolo mesclado não some: continua existindo e localizável pela busca de histórico.
    const resumoOrigem = await buscarResumoWire(db, cenario.origemNumero);
    expect(resumoOrigem.status_fluxo).toBe("MESCLADA");
    expect(resumoOrigem.id_guia_origem).toBe("G-TESTE-ORIGEM");
  });
});
