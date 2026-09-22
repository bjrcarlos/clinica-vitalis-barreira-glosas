import { DatabaseSync, type StatementSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import { montarRelatorio } from "../src/http/handlers/report";
import { montarListaProtocolos } from "../src/http/handlers/protocols-list";
import { montarDetalheProtocolo } from "../src/http/handlers/protocol-detail";
import { montarRegrasAtivas } from "../src/http/handlers/rules";
import { aplicarMigracoes } from "./apoio/migracoes";

/**
 * Adaptador mínimo "D1Database" sobre `node:sqlite`, igual em espírito ao de
 * `tests/repositories.test.ts` — só o que os handlers de leitura usam (`prepare/bind/first/all`).
 * Duplicado aqui (não extraído para um helper compartilhado) porque esta tarefa só autoriza
 * escrever `tests/report.test.ts`.
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
}

function criarBancoDeTeste(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  aplicarMigracoes(db);
  return db;
}

interface IssueSintetico {
  readonly id: string;
  readonly code: string;
  readonly title: string;
  readonly recommended_action: "CORRIGIR" | "REVISAR" | "NAO_FATURAR";
  readonly owner_area: "SECRETARIA" | "FINANCEIRO";
  readonly status: "ABERTO" | "RESOLVIDO";
}

interface TarefaSintetica {
  readonly id: string;
  readonly issue_id: string | null;
  readonly assigned_area: "SECRETARIA" | "FINANCEIRO";
  readonly task_type: string;
  readonly title: string;
  readonly status: "ABERTA" | "RESOLVIDA";
  readonly blocking: 0 | 1;
  readonly created_at_utc: string;
}

interface ProtocoloSintetico {
  readonly numero: string;
  readonly validationStatus: "OK" | "CORRIGIR" | "REVISAO_HUMANA" | "NAO_FATURAR_CONVENIO";
  readonly workflowStatus:
    | "EM_TRATAMENTO"
    | "LIBERADA_PARA_ENVIO"
    | "ENVIADA"
    | "ENCERRADA_PARTICULAR"
    | "ENCERRADA_CANCELADA"
    | "MESCLADA";
  readonly assignedArea: "SECRETARIA" | "FINANCEIRO" | null;
  readonly currentRiskCents: number;
  readonly initialRiskCents: number;
  readonly issues: readonly IssueSintetico[];
  readonly tasks: readonly TarefaSintetica[];
}

/** Semeia um protocolo completo (protocolo + v1 + 1 execução de validação + problemas + tarefas). */
function semearProtocolo(db: DatabaseSync, p: ProtocoloSintetico): void {
  const protocoloId = `pid-${p.numero}`;
  const versaoId = `vid-${p.numero}`;
  const runId = `run-${p.numero}`;
  const agora = "2026-09-01T00:00:00.000Z";

  const guiaNormalizada = {
    id_guia: `G-${p.numero}`,
    unidade: "Centro",
    data_atendimento: "2026-08-10",
    paciente: `Paciente ${p.numero}`,
    convenio: "ConvenioX",
    carteirinha: "123456",
    cid: null,
    procedimento_codigo: "P001",
    procedimento_descricao: "Consulta",
    numero_autorizacao: "AUT-1",
    autorizacao_validade: "2026-12-31",
    autorizacao_sessoes_limite: 10,
    sessao_numero_na_autorizacao: 1,
    profissional: "Dr. Renato",
    profissional_registro: "CRM-1",
    valor_cents: p.currentRiskCents || p.initialRiskCents || 1,
    observacao_recepcao: "",
    data_lancamento: "2026-08-10",
  };
  const guiaBruta: Record<string, string> = {
    id_guia: `G-${p.numero}`,
    unidade: "Centro",
    data_atendimento: "2026-08-10",
    paciente: `Paciente ${p.numero}`,
    convenio: "ConvenioX",
    carteirinha: "123456",
    cid: "",
    procedimento_codigo: "P001",
    procedimento_descricao: "Consulta",
    numero_autorizacao: "AUT-1",
    autorizacao_validade: "2026-12-31",
    autorizacao_sessoes_limite: "10",
    sessao_numero_na_autorizacao: "1",
    profissional: "Dr. Renato",
    profissional_registro: "CRM-1",
    valor: String(guiaNormalizada.valor_cents / 100),
    observacao_recepcao: "",
    data_lancamento: "2026-08-10",
  };

  // `protocols.current_version_id -> guide_versions.id` é DEFERRABLE INITIALLY DEFERRED
  // (migrations/0001_init.sql): sem uma transação explícita, cada INSERT confirma sozinho e a
  // checagem adiada dispara na hora — precisa envolver os dois no mesmo BEGIN/COMMIT.
  db.exec("BEGIN");
  db.prepare(
    `INSERT INTO protocols (
       id, protocol_number, source_guide_id, current_version_id, validation_status,
       workflow_status, assigned_area, current_risk_cents, initial_risk_cents,
       merged_into_protocol_id, created_at_utc, updated_at_utc
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
  ).run(
    protocoloId,
    p.numero,
    `G-${p.numero}`,
    versaoId,
    p.validationStatus,
    p.workflowStatus,
    p.assignedArea,
    p.currentRiskCents,
    p.initialRiskCents,
    agora,
    agora,
  );

  db.prepare(
    `INSERT INTO guide_versions (
       id, protocol_id, version_number, raw_payload_json, normalized_payload_json, diff_json,
       change_reason, created_by_role, created_by_principal, occurred_at_utc, recorded_at_utc
     ) VALUES (?, ?, 1, ?, ?, '[]', NULL, 'SECRETARIA', 'teste@vitalis', ?, ?)`,
  ).run(versaoId, protocoloId, JSON.stringify(guiaBruta), JSON.stringify(guiaNormalizada), agora, agora);
  db.exec("COMMIT");

  db.prepare(
    `INSERT INTO validation_runs (
       id, protocol_id, guide_version_id, rule_set_id, result_status, summary, ai_status,
       ai_model, ai_prompt_version, ai_input_json, ai_output_json, started_at_utc, finished_at_utc
     ) VALUES (?, ?, ?, 'rs1', ?, ?, 'NAO_EXECUTADA', NULL, NULL, NULL, NULL, ?, ?)`,
  ).run(runId, protocoloId, versaoId, p.validationStatus, `resumo de ${p.numero}`, agora, agora);

  for (const issue of p.issues) {
    db.prepare(
      `INSERT INTO validation_issues (
         id, validation_run_id, code, title, recommended_action, owner_area, status,
         subproblems_json, rule_reference_json, created_at_utc, resolved_at_utc
       ) VALUES (?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?)`,
    ).run(
      issue.id,
      runId,
      issue.code,
      issue.title,
      issue.recommended_action,
      issue.owner_area,
      issue.status,
      JSON.stringify({ referencia_regra: `regra.${issue.code}` }),
      agora,
      issue.status === "RESOLVIDO" ? agora : null,
    );
  }

  for (const tarefa of p.tasks) {
    db.prepare(
      `INSERT INTO tasks (
         id, protocol_id, issue_id, assigned_area, task_type, title, status, blocking,
         created_at_utc, resolved_at_utc
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      tarefa.id,
      protocoloId,
      tarefa.issue_id,
      tarefa.assigned_area,
      tarefa.task_type,
      tarefa.title,
      tarefa.status,
      tarefa.blocking,
      tarefa.created_at_utc,
      tarefa.status === "RESOLVIDA" ? tarefa.created_at_utc : null,
    );
  }
}

/** Texto mínimo válido de `regras_convenio.json` (formato oficial, `esquemaRegrasOficial`) — só para `rule_sets.source_json` neste arquivo de teste; não é a regra real de produção. */
const REGRAS_OFICIAIS_TESTE = {
  versao: "agosto/2026",
  definicoes: {
    autorizacao_valida: "válida no próprio dia do vencimento (inclusiva)",
    sessao_numero_na_autorizacao: "posição da sessão dentro do limite autorizado",
    prazo_envio_dias: "dias corridos após o atendimento",
    valor: "valor de referência oficial do procedimento",
  },
  procedimentos: [{ codigo: "P-TESTE", descricao: "Procedimento de teste", valor_referencia: 100 }],
  convenios: [
    {
      nome: "Convênio Teste",
      campos_obrigatorios: ["paciente"],
      validade_maxima_autorizacao_dias: 30,
      limite_sessoes_por_autorizacao: 10,
      procedimentos_cobertos: ["P-TESTE"],
      prazo_envio_dias: 5,
      observacao: "regra de teste",
    },
  ],
};

describe("GET /api/report — reconciliação com as listas filtradas (PRD §27, §13.1)", () => {
  let db: DatabaseSync;
  let d1: SqliteD1Database;

  beforeEach(() => {
    db = criarBancoDeTeste();
    // `source_json` precisa validar contra o formato oficial (`esquemaRegrasOficial`,
    // `src/rules/rule-set.ts`) — desde a auditoria da Fase 2, `montarRegrasAtivas` também lê e
    // valida este texto para expor `convenios`/`procedimentos`/`definicoes` em `GET /api/rules`
    // (achado de dependência: a UI lia o catálogo direto do bundle em vez da API).
    db.prepare(
      `INSERT INTO rule_sets (id, version, source_json, source_sha256, imported_at_utc, activated_at_utc, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "rs1",
      "agosto/2026",
      JSON.stringify(REGRAS_OFICIAIS_TESTE),
      "sha-teste",
      "2026-08-31T00:00:00.000Z",
      "2026-09-01T00:00:00.000Z",
      1,
    );

    // P1 — OK, sem problema, sem risco: entra em "verificadas", não entra em "exigem atenção"
    // nem em nenhuma soma de risco (RN-05: guia OK nunca conta risco).
    semearProtocolo(db, {
      numero: "VT-26-0001",
      validationStatus: "OK",
      workflowStatus: "EM_TRATAMENTO",
      assignedArea: null,
      currentRiskCents: 0,
      initialRiskCents: 0,
      issues: [],
      tasks: [],
    });

    // P2 — CORRIGIR, tarefa bloqueante aberta para a Secretaria.
    semearProtocolo(db, {
      numero: "VT-26-0002",
      validationStatus: "CORRIGIR",
      workflowStatus: "EM_TRATAMENTO",
      assignedArea: "SECRETARIA",
      currentRiskCents: 5000,
      initialRiskCents: 5000,
      issues: [
        {
          id: "iss-2",
          code: "CAMPO_OBRIGATORIO_AUSENTE",
          title: "Faltam campos obrigatórios",
          recommended_action: "CORRIGIR",
          owner_area: "SECRETARIA",
          status: "ABERTO",
        },
      ],
      tasks: [
        {
          id: "task-2",
          issue_id: "iss-2",
          assigned_area: "SECRETARIA",
          task_type: "CAMPO_OBRIGATORIO_AUSENTE",
          title: "Faltam campos obrigatórios",
          status: "ABERTA",
          blocking: 1,
          created_at_utc: "2026-08-10T00:00:00.000Z",
        },
      ],
    });

    // P3 — REVISAO_HUMANA, tarefa bloqueante aberta para o Financeiro.
    semearProtocolo(db, {
      numero: "VT-26-0003",
      validationStatus: "REVISAO_HUMANA",
      workflowStatus: "EM_TRATAMENTO",
      assignedArea: "FINANCEIRO",
      currentRiskCents: 3000,
      initialRiskCents: 3000,
      issues: [
        {
          id: "iss-3",
          code: "POSSIVEL_DUPLICIDADE",
          title: "Possível duplicidade",
          recommended_action: "REVISAR",
          owner_area: "FINANCEIRO",
          status: "ABERTO",
        },
      ],
      tasks: [
        {
          id: "task-3",
          issue_id: "iss-3",
          assigned_area: "FINANCEIRO",
          task_type: "POSSIVEL_DUPLICIDADE",
          title: "Possível duplicidade",
          status: "ABERTA",
          blocking: 1,
          created_at_utc: "2026-08-12T00:00:00.000Z",
        },
      ],
    });

    // P4 — corrigido e liberado: OK agora, sem problema/tarefa aberta, mas com risco INICIAL
    // detectado (§27.4: "tratado" conta o risco inicial de quem chegou a destino válido/liberado).
    semearProtocolo(db, {
      numero: "VT-26-0004",
      validationStatus: "OK",
      workflowStatus: "LIBERADA_PARA_ENVIO",
      assignedArea: null,
      currentRiskCents: 0,
      initialRiskCents: 4000,
      issues: [
        {
          id: "iss-4",
          code: "AUTORIZACAO_VENCIDA",
          title: "Autorização vencida",
          recommended_action: "CORRIGIR",
          owner_area: "SECRETARIA",
          status: "RESOLVIDO",
        },
      ],
      tasks: [
        {
          id: "task-4",
          issue_id: "iss-4",
          assigned_area: "SECRETARIA",
          task_type: "AUTORIZACAO_VENCIDA",
          title: "Autorização vencida",
          status: "RESOLVIDA",
          blocking: 1,
          created_at_utc: "2026-08-05T00:00:00.000Z",
        },
      ],
    });

    // P5 — MESCLADA: precisa desaparecer de TODO bloco do relatório (RF-13/§27.4), mesmo tendo
    // status ruim, risco alto e tarefa aberta — exatamente o caso que provaria vazamento.
    semearProtocolo(db, {
      numero: "VT-26-0005",
      validationStatus: "REVISAO_HUMANA",
      workflowStatus: "MESCLADA",
      assignedArea: "FINANCEIRO",
      currentRiskCents: 9999,
      initialRiskCents: 9999,
      issues: [
        {
          id: "iss-5",
          code: "POSSIVEL_DUPLICIDADE",
          title: "Possível duplicidade",
          recommended_action: "REVISAR",
          owner_area: "FINANCEIRO",
          status: "ABERTO",
        },
      ],
      tasks: [
        {
          id: "task-5",
          issue_id: "iss-5",
          assigned_area: "FINANCEIRO",
          task_type: "POSSIVEL_DUPLICIDADE",
          title: "Possível duplicidade",
          status: "ABERTA",
          blocking: 1,
          created_at_utc: "2026-08-01T00:00:00.000Z",
        },
      ],
    });

    // P6 — CORRIGIR, mesmo código de P2 (para testar agregação de "principais motivos" e a
    // soma por área sem duplicar entre Secretaria/Financeiro).
    semearProtocolo(db, {
      numero: "VT-26-0006",
      validationStatus: "CORRIGIR",
      workflowStatus: "EM_TRATAMENTO",
      assignedArea: "SECRETARIA",
      currentRiskCents: 6000,
      initialRiskCents: 6000,
      issues: [
        {
          id: "iss-6",
          code: "CAMPO_OBRIGATORIO_AUSENTE",
          title: "Faltam campos obrigatórios",
          recommended_action: "CORRIGIR",
          owner_area: "SECRETARIA",
          status: "ABERTO",
        },
      ],
      tasks: [
        {
          id: "task-6",
          issue_id: "iss-6",
          assigned_area: "SECRETARIA",
          task_type: "CAMPO_OBRIGATORIO_AUSENTE",
          title: "Faltam campos obrigatórios",
          status: "ABERTA",
          blocking: 1,
          created_at_utc: "2026-08-15T00:00:00.000Z",
        },
      ],
    });

    d1 = new SqliteD1Database(db);
  });

  it("guias verificadas exclui mesclada e conta só quem tem validação concluída", async () => {
    const relatorio = await montarRelatorio(d1 as never);
    expect(relatorio.guias_verificadas.valor).toBe(5);
    expect(relatorio.guias_verificadas.protocol_numbers.sort()).toEqual(
      ["VT-26-0001", "VT-26-0002", "VT-26-0003", "VT-26-0004", "VT-26-0006"].sort(),
    );
  });

  it("exigem atenção bate exatamente com a lista filtrada por status != OK (excluindo mesclada)", async () => {
    const relatorio = await montarRelatorio(d1 as never);
    expect(relatorio.exigem_atencao.valor).toBe(3);
    expect(relatorio.exigem_atencao.protocol_numbers.sort()).toEqual(
      ["VT-26-0002", "VT-26-0003", "VT-26-0006"].sort(),
    );

    // "Exigem atenção" exclui MESCLADA (RF-13/§27.4: risco/estado mesclado não conta de novo);
    // a listagem genérica por `status_validacao` não teria como saber disso sozinha, então a
    // reconciliação passa também os status de fluxo não mesclados — o mesmo filtro que o clique
    // no bloco do relatório aplicaria.
    const lista = await montarListaProtocolos(d1 as never, {
      status_validacao: "CORRIGIR,REVISAO_HUMANA,NAO_FATURAR_CONVENIO",
      status_fluxo: "EM_TRATAMENTO,LIBERADA_PARA_ENVIO,ENVIADA,ENCERRADA_PARTICULAR,ENCERRADA_CANCELADA",
      tamanho: "50",
    });
    expect(lista.paginacao.total).toBe(relatorio.exigem_atencao.valor);
    expect(lista.protocolos.map((p) => p.numero_protocolo).sort()).toEqual(
      relatorio.exigem_atencao.protocol_numbers.sort(),
    );
  });

  it("risco inicial soma initial_risk_cents uma vez por protocolo, ignorando OK e mesclada", async () => {
    const relatorio = await montarRelatorio(d1 as never);
    // P2 (5000) + P3 (3000) + P4 (4000) + P6 (6000) — P1 (OK, 0) fora da lista, P5 (mesclada) fora.
    expect(relatorio.risco_inicial_cents.valor).toBe(18000);
    expect(relatorio.risco_inicial_cents.protocol_numbers.sort()).toEqual(
      ["VT-26-0002", "VT-26-0003", "VT-26-0004", "VT-26-0006"].sort(),
    );
  });

  it("tratado x pendente não se sobrepõem e não vazam a mesclada", async () => {
    const relatorio = await montarRelatorio(d1 as never);
    expect(relatorio.risco_tratado_cents.valor).toBe(4000);
    expect(relatorio.risco_tratado_cents.protocol_numbers).toEqual(["VT-26-0004"]);

    expect(relatorio.risco_pendente_cents.valor).toBe(14000); // P2 + P3 + P6
    expect(relatorio.risco_pendente_cents.protocol_numbers.sort()).toEqual(
      ["VT-26-0002", "VT-26-0003", "VT-26-0006"].sort(),
    );
  });

  it("principais motivos agrega por código, sem contar a mesclada nem o problema já resolvido", async () => {
    const relatorio = await montarRelatorio(d1 as never);
    const porCodigo = new Map(relatorio.principais_motivos.map((m) => [m.codigo, m]));

    const campoObrigatorio = porCodigo.get("CAMPO_OBRIGATORIO_AUSENTE");
    expect(campoObrigatorio?.ocorrencias).toBe(2);
    expect(campoObrigatorio?.protocol_numbers.sort()).toEqual(["VT-26-0002", "VT-26-0006"]);

    // POSSIVEL_DUPLICIDADE só deveria contar VT-26-0003 (aberto) — VT-26-0005 está mesclada.
    const duplicidade = porCodigo.get("POSSIVEL_DUPLICIDADE");
    expect(duplicidade?.ocorrencias).toBe(1);
    expect(duplicidade?.protocol_numbers).toEqual(["VT-26-0003"]);

    // AUTORIZACAO_VENCIDA de P4 está RESOLVIDO — não deve aparecer.
    expect(porCodigo.has("AUTORIZACAO_VENCIDA")).toBe(false);
  });

  it("distribuição por área nunca soma o mesmo protocolo duas vezes e reconcilia com o pendente", async () => {
    const relatorio = await montarRelatorio(d1 as never);
    const porArea = new Map(relatorio.distribuicao_por_area.map((a) => [a.area, a]));

    const secretaria = porArea.get("SECRETARIA");
    expect(secretaria?.risco_cents).toBe(11000); // P2 (5000) + P6 (6000)
    expect(secretaria?.quantidade_tarefas_abertas).toBe(2);
    expect(secretaria?.protocol_numbers.sort()).toEqual(["VT-26-0002", "VT-26-0006"]);
    expect(secretaria?.pendencia_mais_antiga_utc).toBe("2026-08-10T00:00:00.000Z");

    const financeiro = porArea.get("FINANCEIRO");
    expect(financeiro?.risco_cents).toBe(3000);
    expect(financeiro?.quantidade_tarefas_abertas).toBe(1);
    expect(financeiro?.protocol_numbers).toEqual(["VT-26-0003"]);

    // Soma das áreas reconcilia com o risco pendente total — nenhum protocolo em duas áreas.
    const somaAreas = (secretaria?.risco_cents ?? 0) + (financeiro?.risco_cents ?? 0);
    expect(somaAreas).toBe(relatorio.risco_pendente_cents.valor);
  });

  it("distribuição por estado de validação soma o total de guias verificadas e nunca inclui a mesclada", async () => {
    const relatorio = await montarRelatorio(d1 as never);
    const porStatus = new Map(relatorio.distribuicao_por_estado_validacao.map((d) => [d.status_validacao, d]));

    // Universo idêntico a "guias verificadas" (5): P1 OK, P2 CORRIGIR, P3 REVISAO_HUMANA,
    // P4 OK (corrigido e liberado), P6 CORRIGIR. P5 está MESCLADA e não pode entrar em nenhuma
    // fatia, mesmo tendo status REVISAO_HUMANA e risco alto — é o mesmo caso de vazamento que os
    // outros blocos do relatório já testam.
    expect(porStatus.get("OK")?.quantidade).toBe(2);
    expect(porStatus.get("CORRIGIR")?.quantidade).toBe(2);
    expect(porStatus.get("REVISAO_HUMANA")?.quantidade).toBe(1);
    expect(porStatus.get("NAO_FATURAR_CONVENIO")?.quantidade).toBe(0);

    const somaDistribuicao = relatorio.distribuicao_por_estado_validacao.reduce((soma, d) => soma + d.quantidade, 0);
    expect(somaDistribuicao).toBe(relatorio.guias_verificadas.valor);

    // Risco em centavos por estado (SUM(current_risk_cents) do mesmo universo): P1 e P4 (OK)
    // estão sem risco atual (0 e 0 — P4 foi corrigido e liberado, current_risk_cents zerado);
    // P2 (5000) + P6 (6000) = 11000 em CORRIGIR; P3 (3000) em REVISAO_HUMANA.
    expect(porStatus.get("OK")?.risco_cents).toBe(0);
    expect(porStatus.get("CORRIGIR")?.risco_cents).toBe(11000);
    expect(porStatus.get("REVISAO_HUMANA")?.risco_cents).toBe(3000);
    expect(porStatus.get("NAO_FATURAR_CONVENIO")?.risco_cents).toBe(0);
  });

  it("pendências mais antigas ordena por tempo de espera e nunca inclui a mesclada", async () => {
    const relatorio = await montarRelatorio(d1 as never);
    expect(relatorio.pendencias_mais_antigas.map((p) => p.numero_protocolo)).toEqual([
      "VT-26-0002",
      "VT-26-0003",
      "VT-26-0006",
    ]);
    expect(relatorio.pendencias_mais_antigas.every((p) => p.numero_protocolo !== "VT-26-0005")).toBe(true);
  });

  it("a lista sem nenhum filtro devolve todos os protocolos, inclusive a mesclada (RF-14)", async () => {
    const lista = await montarListaProtocolos(d1 as never, {});
    expect(lista.paginacao.total).toBe(6);
  });

  it("GET /api/rules devolve exatamente a regra marcada como ativa", async () => {
    const regras = await montarRegrasAtivas(d1 as never);
    expect(regras).toEqual({
      versao: "agosto/2026",
      sha256: "sha-teste",
      origem: "regras_convenio.json",
      importada_em_utc: "2026-08-31T00:00:00.000Z",
      ativada_em_utc: "2026-09-01T00:00:00.000Z",
      convenios: [
        {
          nome: "Convênio Teste",
          campos_obrigatorios: ["paciente"],
          validade_maxima_autorizacao_dias: 30,
          limite_sessoes_por_autorizacao: 10,
          procedimentos_cobertos: ["P-TESTE"],
          prazo_envio_dias: 5,
          observacao: "regra de teste",
        },
      ],
      procedimentos: [{ codigo: "P-TESTE", descricao: "Procedimento de teste", valor_referencia_cents: 10000 }],
      definicoes: REGRAS_OFICIAIS_TESTE.definicoes,
    });
  });

  it("trava de liberação: bloqueada por tarefa/problema aberto (P2), liberável depois de corrigir e não ter pendência (P4)", async () => {
    const detalheP2 = await montarDetalheProtocolo(d1 as never, "VT-26-0002");
    expect(detalheP2.trava_liberacao.pode_liberar).toBe(false);
    expect(detalheP2.trava_liberacao.motivo).not.toBeNull();
    const requisitosP2 = new Map(detalheP2.trava_liberacao.requisitos.map((r) => [r.codigo, r.atendido]));
    expect(requisitosP2.get("VALIDACAO_ATUAL_OK")).toBe(false);
    expect(requisitosP2.get("SEM_PROBLEMA_ABERTO")).toBe(false);
    expect(requisitosP2.get("SEM_TAREFA_BLOQUEANTE_ABERTA")).toBe(false);

    const detalheP4 = await montarDetalheProtocolo(d1 as never, "VT-26-0004");
    expect(detalheP4.trava_liberacao.pode_liberar).toBe(true);
    expect(detalheP4.trava_liberacao.motivo).toBeNull();
    expect(detalheP4.trava_liberacao.requisitos.every((r) => r.atendido)).toBe(true);
  });
});
