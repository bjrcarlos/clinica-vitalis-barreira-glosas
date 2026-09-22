import { DatabaseSync, type StatementSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { ZodError } from "zod";

import { ErroDominio, respostaDeErro } from "../src/http/routes";
import { cadastrarProtocolo } from "../src/http/handlers/create-protocol";
import { liberarProtocolo } from "../src/http/handlers/release";
import { registrarEnvioProtocolo } from "../src/http/handlers/send";
import { encerrarProtocoloParticular } from "../src/http/handlers/close";
import { montarRelatorio } from "../src/http/handlers/report";

/**
 * Cobertura pedida pelo orquestrador da Fase 3 para envio e encerramento: envio sem evidência
 * recusado; envio com evidência invalidada recusado; envio aceito grava `ocorrido_em_utc`
 * diferente de `registrado_em_utc`; encerramento sem motivo recusado; encerramento move risco de
 * pendente para tratado; dupla transição recusada.
 *
 * Mesmo adaptador D1-sobre-`node:sqlite` de `tests/repositories.test.ts`/`tests/write-handlers.test.ts`
 * (duplicado aqui de propósito, não reexportado — infraestrutura de teste local, evita acoplar
 * este arquivo a outro agente, mesma justificativa já registrada em `write-handlers.test.ts`).
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

function criarBancoDeTeste(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  const migracao = readFileSync(resolve(__dirname, "../migrations/0001_init.sql"), "utf-8");
  db.exec(migracao);
  return db;
}

/** Regras oficiais com dois procedimentos: P001 coberto (guia OK, usada no fluxo de envio), P002 não coberto (guia NAO_FATURAR_CONVENIO, usada no fluxo de encerramento). */
const REGRAS_JSON_TEXTO = JSON.stringify({
  versao: "teste/1",
  definicoes: {
    autorizacao_valida: "x",
    sessao_numero_na_autorizacao: "x",
    prazo_envio_dias: "x",
    valor: "x",
  },
  procedimentos: [
    { codigo: "P001", descricao: "Consulta Teste", valor_referencia: 100.0 },
    { codigo: "P002", descricao: "Procedimento Não Coberto", valor_referencia: 200.0 },
  ],
  convenios: [
    {
      nome: "ConvenioTeste",
      campos_obrigatorios: [],
      validade_maxima_autorizacao_dias: 9999,
      limite_sessoes_por_autorizacao: 999,
      procedimentos_cobertos: ["P001"],
      prazo_envio_dias: 30,
      observacao: "",
    },
  ],
});

function inserirRuleSetAtivo(db: DatabaseSync): void {
  db.prepare(
    `INSERT INTO rule_sets (id, version, source_json, source_sha256, imported_at_utc, activated_at_utc, is_active)
     VALUES ('rs-1', 'teste/1', ?, 'sha-teste', '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z', 1)`,
  ).run(REGRAS_JSON_TEXTO);
}

function guiaBrutaFixture(overrides: Partial<Record<string, string>> = {}): Record<string, string> {
  return {
    id_guia: "G-TESTE-0001",
    unidade: "Matriz",
    data_atendimento: "2026-08-10",
    paciente: "Fulano de Tal",
    convenio: "ConvenioTeste",
    carteirinha: "123456",
    cid: "M25.5",
    procedimento_codigo: "P001",
    procedimento_descricao: "Consulta Teste",
    numero_autorizacao: "AUT-1",
    autorizacao_validade: "2026-12-31",
    autorizacao_sessoes_limite: "10",
    sessao_numero_na_autorizacao: "1",
    profissional: "Dr. Teste",
    profissional_registro: "CRM-1",
    valor: "100.00",
    observacao_recepcao: "",
    data_lancamento: "2026-08-10",
    ...overrides,
  };
}

/** Insere um objeto de evidência já vinculado ao protocolo, direto via SQL — `POST .../evidence` é handler de outro agente desta mesma fase, ainda não escrito; os testes de `send`/`review-decision` só precisam da LINHA gravada, não da rota de upload. */
function inserirEvidenciaVinculada(
  db: DatabaseSync,
  opcoes: { readonly id: string; readonly protocoloId: string; readonly invalidada?: boolean },
): void {
  db.prepare(
    `INSERT INTO evidence_objects (
       id, r2_key, original_filename, content_type, size_bytes, sha256,
       uploaded_by_role, uploaded_by_principal, uploaded_at_utc, invalidated_at_utc, invalidation_reason
     ) VALUES (?, ?, ?, 'application/pdf', 1024, 'sha-fake', 'FINANCEIRO', 'financeiro@vitalis', '2026-09-01T00:00:00.000Z', ?, ?)`,
  ).run(
    opcoes.id,
    `evidence/${opcoes.protocoloId}/ev-teste/${opcoes.id}-comprovante.pdf`,
    "comprovante.pdf",
    opcoes.invalidada ? "2026-09-02T00:00:00.000Z" : null,
    opcoes.invalidada ? "evidência errada, substituída" : null,
  );
  db.prepare(
    `INSERT INTO evidence_links (evidence_id, protocol_id, event_id, guide_version_id, relation_type, origin_protocol_id)
     VALUES (?, ?, NULL, NULL, 'evidencia', ?)`,
  ).run(opcoes.id, opcoes.protocoloId, opcoes.protocoloId);
}

function buscarIdProtocolo(db: DatabaseSync, numeroProtocolo: string): string {
  const linha = db.prepare(`SELECT id FROM protocols WHERE protocol_number = ?`).get(numeroProtocolo) as { id: string };
  return linha.id;
}

describe("registro de envio (RF-09/RN-04)", () => {
  let db: DatabaseSync;
  let d1: unknown;
  let numeroProtocolo: string;

  beforeEach(async () => {
    db = criarBancoDeTeste();
    inserirRuleSetAtivo(db);
    d1 = new SqliteD1Database(db);

    const cadastro = await cadastrarProtocolo(d1 as never, "SECRETARIA", { guia: guiaBrutaFixture() });
    numeroProtocolo = cadastro.protocolo.numero_protocolo;
    expect(cadastro.resultado_validacao?.status).toBe("OK");
    await liberarProtocolo(d1 as never, "FINANCEIRO", numeroProtocolo, "");
  });

  it("envio sem evidência é recusado com EVIDENCE_REQUIRED", async () => {
    await expect(
      registrarEnvioProtocolo(d1 as never, "FINANCEIRO", numeroProtocolo, {
        ocorrido_em_utc: "2026-09-10T12:00:00.000Z",
        evidence_id: "evidencia-inexistente",
      }),
    ).rejects.toMatchObject({ codigo: "EVIDENCE_REQUIRED" });

    const protocoloLinha = db
      .prepare(`SELECT workflow_status FROM protocols WHERE protocol_number = ?`)
      .get(numeroProtocolo) as { workflow_status: string };
    expect(protocoloLinha.workflow_status).toBe("LIBERADA_PARA_ENVIO"); // não avançou.
  });

  it("envio com evidência invalidada é recusado com EVIDENCE_REQUIRED", async () => {
    const protocoloId = buscarIdProtocolo(db, numeroProtocolo);
    inserirEvidenciaVinculada(db, { id: "ev-invalida", protocoloId, invalidada: true });

    try {
      await registrarEnvioProtocolo(d1 as never, "FINANCEIRO", numeroProtocolo, {
        ocorrido_em_utc: "2026-09-10T12:00:00.000Z",
        evidence_id: "ev-invalida",
      });
      throw new Error("deveria ter recusado por evidência invalidada");
    } catch (erro) {
      expect(erro).toBeInstanceOf(ErroDominio);
      expect((erro as ErroDominio).codigo).toBe("EVIDENCE_REQUIRED");
      expect(respostaDeErro(erro).status).toBe(409);
    }
  });

  it("envio aceito grava ocorrido_em_utc retroativo diferente de registrado_em_utc e muda para ENVIADA", async () => {
    const protocoloId = buscarIdProtocolo(db, numeroProtocolo);
    inserirEvidenciaVinculada(db, { id: "ev-valida", protocoloId });

    const ocorridoEmUtc = "2026-09-05T09:00:00.000Z"; // retroativo em relação a "agora" (relógio real do teste).
    const resposta = await registrarEnvioProtocolo(d1 as never, "FINANCEIRO", numeroProtocolo, {
      ocorrido_em_utc: ocorridoEmUtc,
      evidence_id: "ev-valida",
    });

    expect(resposta.protocolo.status_fluxo).toBe("ENVIADA");
    expect(resposta.envio.evidence_id).toBe("ev-valida");
    expect(resposta.envio.ocorrido_em_utc).toBe(ocorridoEmUtc);
    expect(resposta.envio.registrado_em_utc).not.toBe(resposta.envio.ocorrido_em_utc);
    expect(Date.parse(resposta.envio.registrado_em_utc)).toBeGreaterThan(Date.parse(resposta.envio.ocorrido_em_utc));

    const eventoLinha = db
      .prepare(`SELECT event_type, occurred_at_utc, recorded_at_utc FROM workflow_events WHERE protocol_id = ? AND event_type = 'ENVIO'`)
      .get(protocoloId) as { event_type: string; occurred_at_utc: string; recorded_at_utc: string };
    expect(eventoLinha.occurred_at_utc).toBe(ocorridoEmUtc);
    expect(eventoLinha.recorded_at_utc).not.toBe(ocorridoEmUtc);
  });

  it("enviar duas vezes o mesmo protocolo é recusado com INVALID_STATE_TRANSITION", async () => {
    const protocoloId = buscarIdProtocolo(db, numeroProtocolo);
    inserirEvidenciaVinculada(db, { id: "ev-valida", protocoloId });

    await registrarEnvioProtocolo(d1 as never, "FINANCEIRO", numeroProtocolo, {
      ocorrido_em_utc: "2026-09-05T09:00:00.000Z",
      evidence_id: "ev-valida",
    });

    await expect(
      registrarEnvioProtocolo(d1 as never, "FINANCEIRO", numeroProtocolo, {
        ocorrido_em_utc: "2026-09-06T09:00:00.000Z",
        evidence_id: "ev-valida",
      }),
    ).rejects.toMatchObject({ codigo: "INVALID_STATE_TRANSITION" });
  });

  it("papel diferente de FINANCEIRO recebe ROLE_NOT_ALLOWED / 403", async () => {
    await expect(
      registrarEnvioProtocolo(d1 as never, "SECRETARIA", numeroProtocolo, {
        ocorrido_em_utc: "2026-09-05T09:00:00.000Z",
        evidence_id: "qualquer",
      }),
    ).rejects.toBeInstanceOf(ErroDominio);
  });

  it("ocorrido_em_utc no futuro é recusado", async () => {
    const futuro = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    await expect(
      registrarEnvioProtocolo(d1 as never, "FINANCEIRO", numeroProtocolo, {
        ocorrido_em_utc: futuro,
        evidence_id: "qualquer",
      }),
    ).rejects.toMatchObject({ codigo: "VALIDATION_ERROR" });
  });

  it("corpo malformado (schema) é rejeitado por Zod", async () => {
    await expect(
      registrarEnvioProtocolo(d1 as never, "FINANCEIRO", numeroProtocolo, { evidence_id: "x" }),
    ).rejects.toBeInstanceOf(ZodError);
  });
});

describe("encerramento de protocolo (RN-07)", () => {
  let db: DatabaseSync;
  let d1: unknown;
  let numeroProtocolo: string;

  beforeEach(async () => {
    db = criarBancoDeTeste();
    inserirRuleSetAtivo(db);
    d1 = new SqliteD1Database(db);

    // P002 não é coberto por ConvenioTeste → NAO_FATURAR_CONVENIO, risco = valor_cents (20000).
    const cadastro = await cadastrarProtocolo(d1 as never, "SECRETARIA", {
      guia: guiaBrutaFixture({
        procedimento_codigo: "P002",
        procedimento_descricao: "Procedimento Não Coberto",
        valor: "200.00",
      }),
    });
    numeroProtocolo = cadastro.protocolo.numero_protocolo;
    expect(cadastro.resultado_validacao?.status).toBe("NAO_FATURAR_CONVENIO");
    expect(cadastro.protocolo.risco_atual_cents).toBe(20000);
  });

  it("encerramento sem motivo é rejeitado por Zod", async () => {
    await expect(
      encerrarProtocoloParticular(d1 as never, "FINANCEIRO", numeroProtocolo, { motivo: "" }),
    ).rejects.toBeInstanceOf(ZodError);

    await expect(
      encerrarProtocoloParticular(d1 as never, "FINANCEIRO", numeroProtocolo, { motivo: "   " }),
    ).rejects.toBeInstanceOf(ZodError);
  });

  it("papel diferente de FINANCEIRO recebe ROLE_NOT_ALLOWED / 403", async () => {
    try {
      await encerrarProtocoloParticular(d1 as never, "SECRETARIA", numeroProtocolo, {
        motivo: "Paciente decidiu pagar particular.",
      });
      throw new Error("deveria ter lançado ErroDominio");
    } catch (erro) {
      expect(erro).toBeInstanceOf(ErroDominio);
      expect(respostaDeErro(erro).status).toBe(403);
    }
  });

  it("encerramento move risco de pendente para tratado no relatório e fecha problema/tarefa", async () => {
    const relatorioAntes = await montarRelatorio(d1 as never);
    expect(relatorioAntes.risco_pendente_cents.protocol_numbers).toContain(numeroProtocolo);
    expect(relatorioAntes.risco_pendente_cents.valor).toBe(20000);
    expect(relatorioAntes.risco_tratado_cents.valor).toBe(0);

    const resposta = await encerrarProtocoloParticular(d1 as never, "FINANCEIRO", numeroProtocolo, {
      motivo: "Convênio não cobre o procedimento; paciente optou por pagar particular.",
    });
    expect(resposta.protocolo.status_fluxo).toBe("ENCERRADA_PARTICULAR");
    expect(resposta.protocolo.area_responsavel).toBeNull();

    const relatorioDepois = await montarRelatorio(d1 as never);
    expect(relatorioDepois.risco_pendente_cents.protocol_numbers).not.toContain(numeroProtocolo);
    expect(relatorioDepois.risco_pendente_cents.valor).toBe(0);
    expect(relatorioDepois.risco_tratado_cents.protocol_numbers).toContain(numeroProtocolo);
    expect(relatorioDepois.risco_tratado_cents.valor).toBe(20000);
    // Risco inicial nunca muda (RN-05: preservado mesmo após tratamento).
    expect(relatorioDepois.risco_inicial_cents.valor).toBe(relatorioAntes.risco_inicial_cents.valor);

    const protocoloId = buscarIdProtocolo(db, numeroProtocolo);
    const problemasAbertos = db
      .prepare(
        `SELECT COUNT(*) AS n FROM validation_issues vi
         JOIN validation_runs vr ON vr.id = vi.validation_run_id
         WHERE vr.protocol_id = ? AND vi.status = 'ABERTO'`,
      )
      .get(protocoloId) as { n: number };
    expect(problemasAbertos.n).toBe(0);

    const tarefasAbertas = db
      .prepare(`SELECT COUNT(*) AS n FROM tasks WHERE protocol_id = ? AND status = 'ABERTA'`)
      .get(protocoloId) as { n: number };
    expect(tarefasAbertas.n).toBe(0);
  });

  it("dupla transição: protocolo já encerrado não pode ser encerrado de novo", async () => {
    await encerrarProtocoloParticular(d1 as never, "FINANCEIRO", numeroProtocolo, {
      motivo: "Convênio não cobre o procedimento; paciente optou por pagar particular.",
    });

    await expect(
      encerrarProtocoloParticular(d1 as never, "FINANCEIRO", numeroProtocolo, {
        motivo: "Tentativa de encerrar de novo.",
      }),
    ).rejects.toMatchObject({ codigo: "INVALID_STATE_TRANSITION" });
  });
});
