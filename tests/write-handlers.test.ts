import { DatabaseSync, type StatementSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { ZodError } from "zod";

import { ErroDominio, respostaDeErro } from "../src/http/routes";
import { cadastrarProtocolo } from "../src/http/handlers/create-protocol";
import { criarVersaoProtocolo } from "../src/http/handlers/create-version";
import { liberarProtocolo } from "../src/http/handlers/release";
import { importarGuias } from "../src/http/handlers/imports";

/**
 * Cobertura pedida pelo orquestrador da Fase 2 para os handlers de escrita: papel errado
 * recebe 403; correção sem justificativa é rejeitada; correção cria v2 e mantém v1 intacta;
 * liberação bloqueada devolve motivo; reimportação do mesmo CSV não duplica.
 *
 * Mesmo adaptador D1-sobre-`node:sqlite` de `tests/repositories.test.ts` (não reexportado de
 * lá — é infraestrutura de teste local, duplicá-la aqui evita acoplar este arquivo ao de outro
 * agente): carrega a migração real, sem depender de wrangler nem do pool de Workers.
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

function contar(db: DatabaseSync, tabela: string, whereSql = "", ...parametros: unknown[]): number {
  const linha = db.prepare(`SELECT COUNT(*) AS total FROM ${tabela} ${whereSql}`).get(...(parametros as never[])) as {
    total: number;
  };
  return linha.total;
}

/** Regras oficiais mínimas (formato bruto de `regras_convenio.json`) — um convênio, um procedimento, ambos exigidos por `montarConjuntoRegras`/`esquemaRegrasOficial` (arrays não podem ser vazios). */
const REGRAS_JSON_TEXTO = JSON.stringify({
  versao: "teste/1",
  definicoes: {
    autorizacao_valida: "x",
    sessao_numero_na_autorizacao: "x",
    prazo_envio_dias: "x",
    valor: "x",
  },
  procedimentos: [{ codigo: "P001", descricao: "Consulta Teste", valor_referencia: 100.0 }],
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

describe("handlers de escrita — papel incorreto", () => {
  let db: DatabaseSync;
  let d1: unknown;

  beforeEach(() => {
    db = criarBancoDeTeste();
    inserirRuleSetAtivo(db);
    d1 = new SqliteD1Database(db);
  });

  it("cadastro de protocolo por papel diferente de SECRETARIA recebe ROLE_NOT_ALLOWED / 403", async () => {
    await expect(
      cadastrarProtocolo(d1 as never, "FINANCEIRO", { guia: guiaBrutaFixture() }),
    ).rejects.toMatchObject({ codigo: "ROLE_NOT_ALLOWED" });

    try {
      await cadastrarProtocolo(d1 as never, "DIRECAO", { guia: guiaBrutaFixture() });
      throw new Error("deveria ter lançado ErroDominio");
    } catch (erro) {
      expect(erro).toBeInstanceOf(ErroDominio);
      expect(respostaDeErro(erro).status).toBe(403);
    }
  });

  it("liberação por papel diferente de FINANCEIRO recebe ROLE_NOT_ALLOWED / 403", async () => {
    await expect(liberarProtocolo(d1 as never, "SECRETARIA", "VT-26-0001", "")).rejects.toMatchObject({
      codigo: "ROLE_NOT_ALLOWED",
    });
  });
});

describe("correção de guia (RF-10)", () => {
  let db: DatabaseSync;
  let d1: unknown;
  let numeroProtocolo: string;

  beforeEach(async () => {
    db = criarBancoDeTeste();
    inserirRuleSetAtivo(db);
    d1 = new SqliteD1Database(db);

    const cadastro = await cadastrarProtocolo(d1 as never, "SECRETARIA", { guia: guiaBrutaFixture() });
    numeroProtocolo = cadastro.protocolo.numero_protocolo;
  });

  it("correção sem justificativa é rejeitada", async () => {
    await expect(
      criarVersaoProtocolo(d1 as never, "SECRETARIA", numeroProtocolo, {
        guia: guiaBrutaFixture({ profissional: "Dra. Nova" }),
        motivo: "",
      }),
    ).rejects.toBeInstanceOf(ZodError);
  });

  it("correção que não altera nenhum campo é rejeitada", async () => {
    await expect(
      criarVersaoProtocolo(d1 as never, "SECRETARIA", numeroProtocolo, {
        guia: guiaBrutaFixture(),
        motivo: "tentativa sem mudança nenhuma",
      }),
    ).rejects.toMatchObject({ codigo: "NENHUMA_ALTERACAO" });
  });

  it("correção cria v2 e mantém v1 intacta", async () => {
    const protocoloLinhaAntes = db
      .prepare(`SELECT id FROM protocols WHERE protocol_number = ?`)
      .get(numeroProtocolo) as { id: string };

    const resposta = await criarVersaoProtocolo(d1 as never, "SECRETARIA", numeroProtocolo, {
      guia: guiaBrutaFixture({ profissional: "Dra. Nova" }),
      motivo: "correção de teste: profissional estava errado",
    });

    expect(resposta.versao.numero_versao).toBe(2);
    expect(resposta.versao.guia.profissional).toBe("Dra. Nova");
    expect(resposta.protocolo.numero_versao_atual).toBe(2);

    // v1 continua intacta: nunca é editada, só uma linha nova é acrescentada.
    expect(contar(db, "guide_versions", "WHERE protocol_id = ?", protocoloLinhaAntes.id)).toBe(2);

    const v1 = db
      .prepare(`SELECT raw_payload_json, version_number FROM guide_versions WHERE protocol_id = ? AND version_number = 1`)
      .get(protocoloLinhaAntes.id) as { raw_payload_json: string; version_number: number };
    expect(JSON.parse(v1.raw_payload_json).profissional).toBe("Dr. Teste");

    const protocoloDepois = db
      .prepare(`SELECT current_version_id FROM protocols WHERE id = ?`)
      .get(protocoloLinhaAntes.id) as { current_version_id: string };
    const v2 = db
      .prepare(`SELECT version_number FROM guide_versions WHERE id = ?`)
      .get(protocoloDepois.current_version_id) as { version_number: number };
    expect(v2.version_number).toBe(2);
  });
});

describe("liberação de protocolo (RF-09)", () => {
  let db: DatabaseSync;
  let d1: unknown;

  beforeEach(() => {
    db = criarBancoDeTeste();
    inserirRuleSetAtivo(db);
    d1 = new SqliteD1Database(db);
  });

  it("liberação bloqueada devolve motivo (409, OPEN_BLOCKING_TASKS ou GUIDE_NOT_READY)", async () => {
    // Convênio desconhecido nunca é REVISAO_HUMANA sozinho ficar "OK" — trava a liberação.
    const cadastro = await cadastrarProtocolo(d1 as never, "SECRETARIA", {
      guia: guiaBrutaFixture({ convenio: "ConvenioDesconhecido" }),
    });
    expect(cadastro.resultado_validacao?.status).not.toBe("OK");

    try {
      await liberarProtocolo(d1 as never, "FINANCEIRO", cadastro.protocolo.numero_protocolo, "");
      throw new Error("liberação deveria ter sido bloqueada");
    } catch (erro) {
      expect(erro).toBeInstanceOf(ErroDominio);
      const dominio = erro as ErroDominio;
      expect(["OPEN_BLOCKING_TASKS", "GUIDE_NOT_READY"]).toContain(dominio.codigo);
      expect(dominio.message).toMatch(/Não é possível liberar/);
      expect(respostaDeErro(erro).status).toBe(409);
    }

    const protocoloLinha = db
      .prepare(`SELECT workflow_status FROM protocols WHERE protocol_number = ?`)
      .get(cadastro.protocolo.numero_protocolo) as { workflow_status: string };
    expect(protocoloLinha.workflow_status).toBe("EM_TRATAMENTO"); // não avançou.
  });
});

describe("importação de guias (RF-01)", () => {
  let db: DatabaseSync;
  let d1: unknown;

  const CSV = [
    "id_guia,unidade,data_atendimento,paciente,convenio,carteirinha,cid,procedimento_codigo,procedimento_descricao,numero_autorizacao,autorizacao_validade,autorizacao_sessoes_limite,sessao_numero_na_autorizacao,profissional,profissional_registro,valor,observacao_recepcao,data_lancamento",
    "G-TESTE-0001,Matriz,2026-08-10,Fulano de Tal,ConvenioTeste,123456,M25.5,P001,Consulta Teste,AUT-1,2026-12-31,10,1,Dr. Teste,CRM-1,100.00,,2026-08-10",
  ].join("\n");

  beforeEach(() => {
    db = criarBancoDeTeste();
    inserirRuleSetAtivo(db);
    d1 = new SqliteD1Database(db);
  });

  it("reimportação do mesmo CSV não duplica protocolo", async () => {
    const primeira = await importarGuias(d1 as never, "SECRETARIA", {
      formato: "csv",
      nome_arquivo: "guias-teste.csv",
      conteudo_csv: CSV,
    });
    expect(primeira.linhas_aceitas).toBe(1);
    expect(primeira.protocolos_criados).toHaveLength(1);
    expect(primeira.protocolos_ja_existentes).toHaveLength(0);
    expect(contar(db, "protocols")).toBe(1);

    const segunda = await importarGuias(d1 as never, "SECRETARIA", {
      formato: "csv",
      nome_arquivo: "guias-teste.csv",
      conteudo_csv: CSV,
    });
    expect(segunda.linhas_aceitas).toBe(1);
    expect(segunda.protocolos_criados).toHaveLength(0);
    expect(segunda.protocolos_ja_existentes).toHaveLength(1);
    expect(segunda.protocolos_ja_existentes[0].numero_protocolo).toBe(primeira.protocolos_criados[0].numero_protocolo);

    // Nenhum protocolo novo, mesmo reimportando o arquivo inteiro de novo.
    expect(contar(db, "protocols")).toBe(1);
    expect(contar(db, "guide_versions")).toBe(1);
  });

  it("id_guia duplicado dentro do mesmo arquivo rejeita a segunda ocorrência", async () => {
    const csvComDuplicata = [
      "id_guia,unidade,data_atendimento,paciente,convenio,carteirinha,cid,procedimento_codigo,procedimento_descricao,numero_autorizacao,autorizacao_validade,autorizacao_sessoes_limite,sessao_numero_na_autorizacao,profissional,profissional_registro,valor,observacao_recepcao,data_lancamento",
      "G-DUP-0001,Matriz,2026-08-10,Fulano,ConvenioTeste,123456,M25.5,P001,Consulta Teste,AUT-1,2026-12-31,10,1,Dr. Teste,CRM-1,100.00,,2026-08-10",
      "G-DUP-0001,Matriz,2026-08-11,Ciclano,ConvenioTeste,654321,M25.5,P001,Consulta Teste,AUT-2,2026-12-31,10,1,Dr. Teste,CRM-1,100.00,,2026-08-11",
    ].join("\n");

    const resultado = await importarGuias(d1 as never, "SECRETARIA", {
      formato: "csv",
      nome_arquivo: "duplicata.csv",
      conteudo_csv: csvComDuplicata,
    });

    expect(resultado.linhas_aceitas).toBe(1);
    expect(resultado.linhas_rejeitadas).toHaveLength(1);
    expect(resultado.linhas_rejeitadas[0].motivo).toMatch(/duplicado dentro do arquivo/);
    expect(contar(db, "protocols")).toBe(1);
  });
});
