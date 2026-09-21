import { DatabaseSync, type StatementSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import type { GuiaBruta, GuiaNormalizada } from "../src/domain/guide";
import type { ConjuntoRegras } from "../src/domain/rule-set";
import { GeradorIdCrypto } from "../src/infrastructure/id";
import { RelogioFixo } from "../src/infrastructure/clock";
import { RepositorioEventosD1 } from "../src/infrastructure/d1/events";
import { RepositorioProtocolosD1 } from "../src/infrastructure/d1/protocols";
import { RepositorioConjuntosDeRegrasD1 } from "../src/infrastructure/d1/rule-sets";
import { RepositorioTarefasD1 } from "../src/infrastructure/d1/tasks";
import { RepositorioValidacoesD1 } from "../src/infrastructure/d1/validations";
import { RepositorioVersoesD1 } from "../src/infrastructure/d1/versions";
import { registrarGuia } from "../src/application/register-guide";
import type { MotorValidacao } from "../src/application/validate-guide";

/**
 * Adaptador mínimo "D1Database" sobre node:sqlite (DatabaseSync), só com o que os
 * repositórios desta fase usam (prepare/bind/first/run/all/batch). Não depende de wrangler:
 * carrega a migração real (migrations/0001_init.sql) direto num banco em memória.
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

function contar(db: DatabaseSync, tabela: string): number {
  const linha = db.prepare(`SELECT COUNT(*) AS total FROM ${tabela}`).get() as { total: number };
  return linha.total;
}

const REGRAS_FIXTURE: ConjuntoRegras = {
  versao: "agosto/2026",
  sha256: "sha-teste",
  convenios: [],
  procedimentos: [],
  definicoes: {
    autorizacao_valida: "",
    sessao_numero_na_autorizacao: "",
    prazo_envio_dias: "",
    valor: "",
  },
};

function guiaFixture(overrides: Partial<GuiaNormalizada> = {}): GuiaNormalizada {
  return {
    id_guia: "G-2608-0001",
    unidade: "Matriz",
    data_atendimento: "2026-08-10",
    paciente: "Fulano de Tal",
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
    valor_cents: 6200,
    observacao_recepcao: "",
    data_lancamento: "2026-08-10",
    ...overrides,
  };
}

const GUIA_BRUTA_FIXTURE: GuiaBruta = { id_guia: "G-2608-0001", valor: "62.00" };

describe("RepositorioProtocolosD1 - gerador de numero_protocolo", () => {
  let db: DatabaseSync;
  let repositorio: RepositorioProtocolosD1;

  beforeEach(() => {
    db = criarBancoDeTeste();
    const d1 = new SqliteD1Database(db) as never;
    repositorio = new RepositorioProtocolosD1(d1, new GeradorIdCrypto(), new RelogioFixo("2026-08-10T12:00:00.000Z"));
  });

  it("gera sequencial de 4 digitos, comecando em 0001, dentro do mesmo ano", async () => {
    const primeiro = await repositorio.criarComVersaoInicial({
      idGuiaOrigem: "G-2608-0001",
      guiaBruta: GUIA_BRUTA_FIXTURE,
      guiaNormalizada: guiaFixture(),
      avisosNormalizacao: [],
      criadoPorPapel: "SECRETARIA",
      criadoPorPrincipal: "recepcao@vitalis",
      origem: "IMPORTACAO",
      ocorridoEmUtc: "2026-08-10T12:00:00.000Z",
    });
    expect(primeiro.numeroProtocolo).toBe("VT-26-0001");
  });

  it("deriva o proximo numero do maior ja existente, sem colidir entre chamadas sucessivas", async () => {
    const numeros: string[] = [];
    for (let indice = 0; indice < 3; indice += 1) {
      const criado = await repositorio.criarComVersaoInicial({
        idGuiaOrigem: `G-2608-000${indice + 1}`,
        guiaBruta: GUIA_BRUTA_FIXTURE,
        guiaNormalizada: guiaFixture({ id_guia: `G-2608-000${indice + 1}` }),
        avisosNormalizacao: [],
        criadoPorPapel: "SECRETARIA",
        criadoPorPrincipal: "recepcao@vitalis",
        origem: "IMPORTACAO",
        ocorridoEmUtc: "2026-08-10T12:00:00.000Z",
      });
      numeros.push(criado.numeroProtocolo);
    }
    expect(numeros).toEqual(["VT-26-0001", "VT-26-0002", "VT-26-0003"]);
    expect(new Set(numeros).size).toBe(3); // nenhuma guia soma/colide duas vezes
  });

  it("reinicia a sequencia para um ano diferente, sem herdar o sequencial de outro ano", async () => {
    await repositorio.criarComVersaoInicial({
      idGuiaOrigem: "G-2608-0001",
      guiaBruta: GUIA_BRUTA_FIXTURE,
      guiaNormalizada: guiaFixture(),
      avisosNormalizacao: [],
      criadoPorPapel: "SECRETARIA",
      criadoPorPrincipal: "recepcao@vitalis",
      origem: "IMPORTACAO",
      ocorridoEmUtc: "2026-08-10T12:00:00.000Z",
    });
    const doOutroAno = await repositorio.criarComVersaoInicial({
      idGuiaOrigem: "G-2708-0001",
      guiaBruta: GUIA_BRUTA_FIXTURE,
      guiaNormalizada: guiaFixture({ id_guia: "G-2708-0001" }),
      avisosNormalizacao: [],
      criadoPorPapel: "SECRETARIA",
      criadoPorPrincipal: "recepcao@vitalis",
      origem: "IMPORTACAO",
      ocorridoEmUtc: "2027-01-05T12:00:00.000Z",
    });
    expect(doOutroAno.numeroProtocolo).toBe("VT-27-0001");
  });

  it("grava diff_json da v1 como '[]', nunca os avisos de normalizacao (SS-19.3, RF-10, RN-08)", async () => {
    await repositorio.criarComVersaoInicial({
      idGuiaOrigem: "G-2608-0001",
      guiaBruta: GUIA_BRUTA_FIXTURE,
      guiaNormalizada: guiaFixture(),
      avisosNormalizacao: [
        { campo: "data_atendimento", valor_original: "10/08/2026", valor_normalizado: "2026-08-10", motivo: "Formato de data convertido para o padrão YYYY-MM-DD." },
      ],
      criadoPorPapel: "SECRETARIA",
      criadoPorPrincipal: "recepcao@vitalis",
      origem: "IMPORTACAO",
      ocorridoEmUtc: "2026-08-10T12:00:00.000Z",
    });

    const linha = db.prepare("SELECT diff_json FROM guide_versions WHERE protocol_id = (SELECT id FROM protocols WHERE source_guide_id = ?)").get("G-2608-0001") as { diff_json: string };
    expect(linha.diff_json).toBe("[]");
  });
});

describe("registrarGuia - idempotencia por id_guia de origem", () => {
  let db: DatabaseSync;
  let chamadasDoMotor: number;
  let motor: MotorValidacao;

  function construirDependencias() {
    const d1 = new SqliteD1Database(db) as never;
    const ids = new GeradorIdCrypto();
    const relogio = new RelogioFixo("2026-08-10T12:00:00.000Z");
    return {
      protocolos: new RepositorioProtocolosD1(d1, ids, relogio),
      versoes: new RepositorioVersoesD1(d1),
      eventos: new RepositorioEventosD1(d1, ids),
      relogio,
      validarGuiaDependencias: {
        motor,
        validacoes: new RepositorioValidacoesD1(d1, ids),
        tarefas: new RepositorioTarefasD1(d1, ids, relogio),
        eventos: new RepositorioEventosD1(d1, ids),
        relogio,
      },
    };
  }

  beforeEach(async () => {
    db = criarBancoDeTeste();
    chamadasDoMotor = 0;
    motor = () => {
      chamadasDoMotor += 1;
      return {
        status: "OK",
        resumo: "sem problemas",
        problemas: [],
        tarefas: [],
        risco_cents: 0,
        regras_aplicadas: { versao: REGRAS_FIXTURE.versao, sha256: REGRAS_FIXTURE.sha256, referencias: [] },
      };
    };
    const d1 = new SqliteD1Database(db) as never;
    await new RepositorioConjuntosDeRegrasD1(d1, new GeradorIdCrypto(), new RelogioFixo("2026-08-10T12:00:00.000Z")).ativar(
      REGRAS_FIXTURE,
    );
  });

  it("registrar duas vezes o mesmo id_guia da mesma importacao nao cria dois protocolos", async () => {
    const entrada = {
      idGuiaOrigem: "G-2608-0001",
      guiaBruta: GUIA_BRUTA_FIXTURE,
      guiaNormalizada: guiaFixture(),
      avisosNormalizacao: [],
      criadoPorPapel: "SECRETARIA" as const,
      criadoPorPrincipal: "recepcao@vitalis",
      origem: "IMPORTACAO" as const,
      regras: REGRAS_FIXTURE,
    };

    const primeira = await registrarGuia(entrada, construirDependencias());
    expect(primeira.jaExistia).toBe(false);
    if (primeira.jaExistia) throw new Error("nao deveria existir na primeira chamada");

    const segunda = await registrarGuia(entrada, construirDependencias());
    expect(segunda.jaExistia).toBe(true);
    if (!segunda.jaExistia) throw new Error("deveria ja existir na segunda chamada");

    expect(segunda.protocolo.protocoloId).toBe(primeira.protocolo.protocoloId);
    expect(segunda.protocolo.numeroProtocolo).toBe(primeira.protocolo.numeroProtocolo);
    expect(segunda.validacao).toBeNull();

    expect(contar(db, "protocols")).toBe(1);
    expect(contar(db, "guide_versions")).toBe(1);
    expect(contar(db, "validation_runs")).toBe(1);
    expect(chamadasDoMotor).toBe(1);
  });

  it("cadastro sem id_guia de origem (RF-02) sempre cria um novo protocolo", async () => {
    const entradaBase = {
      idGuiaOrigem: null,
      guiaBruta: GUIA_BRUTA_FIXTURE,
      guiaNormalizada: guiaFixture(),
      avisosNormalizacao: [],
      criadoPorPapel: "SECRETARIA" as const,
      criadoPorPrincipal: "recepcao@vitalis",
      origem: "UI" as const,
      regras: REGRAS_FIXTURE,
    };

    await registrarGuia(entradaBase, construirDependencias());
    await registrarGuia(entradaBase, construirDependencias());

    expect(contar(db, "protocols")).toBe(2);
  });
});
