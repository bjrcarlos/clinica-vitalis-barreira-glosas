import { DatabaseSync, type StatementSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import { manipularMcp } from "../src/mcp/server";
import type { Env } from "../src/worker/index";
import type { GuiaBruta } from "../src/domain/guide";
import { aplicarMigracoes } from "./apoio/migracoes";

/**
 * Migração para `createMcpHandler` (PRD-SDD §17/§23): estes testes cobrem exatamente os
 * invariantes que a tarefa de migração não podia quebrar — autenticação Bearer, papel nunca
 * vindo de `arguments`, `registrar_guia` exclusivo/idempotente da Secretaria, `verificar_guia`
 * sem persistir e `minhas_pendencias` derivando a área da credencial. Não cobre regra de
 * negócio (motor de validação, normalização) — isso já está coberto em `engine.test.ts` e
 * `normalize.test.ts`.
 *
 * Mesmo adaptador D1-sobre-`node:sqlite` de `tests/repositories.test.ts` (arquivo por arquivo,
 * sem módulo compartilhado — convenção já estabelecida naquele teste).
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

  async batch<T>(statements: SqliteD1Statement[]): Promise<Array<{ success: true; meta: Record<string, unknown>; results: T[] }>> {
    this.db.exec("BEGIN");
    try {
      const resultados = [];
      for (const statement of statements) resultados.push(await statement.all<T>());
      this.db.exec("COMMIT");
      return resultados;
    } catch (erro) {
      this.db.exec("ROLLBACK");
      throw erro;
    }
  }
}

const SECRETARIA_TOKEN = "token-secretaria-teste-mcp";
const FINANCEIRO_TOKEN = "token-financeiro-teste-mcp";

function criarBancoDeTeste(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  aplicarMigracoes(db);
  // Regra ativa a partir do material oficial (nunca copiado para dentro do código de teste).
  const regrasTexto = readFileSync(resolve(__dirname, "../regras_convenio.json.txt"), "utf-8");
  db.prepare(
    `INSERT INTO rule_sets (id, version, source_json, source_sha256, imported_at_utc, activated_at_utc, is_active) VALUES (?, ?, ?, ?, ?, ?, 1)`,
  ).run("rs-teste", "agosto/2026", regrasTexto, "0".repeat(64), "2026-09-01T00:00:00.000Z", "2026-09-01T00:00:00.000Z");
  return db;
}

function contar(db: DatabaseSync, tabela: string): number {
  const linha = db.prepare(`SELECT COUNT(*) AS total FROM ${tabela}`).get() as { total: number };
  return linha.total;
}

function guiaBrutaFixture(overrides: Partial<GuiaBruta> = {}): GuiaBruta {
  return {
    id_guia: "MCP-TESTE-0001",
    unidade: "Matriz",
    data_atendimento: "2026-09-10",
    paciente: "Paciente de Teste",
    convenio: "Vitalcard",
    carteirinha: "999999",
    cid: "M54.5",
    procedimento_codigo: "50000470",
    procedimento_descricao: "Sessão de fisioterapia musculoesquelética",
    numero_autorizacao: "AUT-TESTE",
    autorizacao_validade: "2026-12-31",
    autorizacao_sessoes_limite: "10",
    sessao_numero_na_autorizacao: "1",
    profissional: "Dr. Teste",
    profissional_registro: "CRM-999",
    valor: "62.00",
    observacao_recepcao: "",
    data_lancamento: "2026-09-10",
    ...overrides,
  };
}

/** Extrai o corpo JSON-RPC de uma resposta HTTP, aceitando tanto JSON puro quanto o envelope SSE (`event: message\ndata: {...}`) que o transporte streamable-HTTP pode escolher conforme o `Accept`. */
async function corpoJsonRpc(resposta: Response): Promise<{ result?: { content?: Array<{ type: string; text: string }>; structuredContent?: Record<string, never>; isError?: boolean; tools?: unknown[] }; error?: { code: number; message: string } }> {
  const texto = await resposta.text();
  const linhaDados = texto.split(/\r?\n/).find((linha) => linha.startsWith("data: "));
  return JSON.parse(linhaDados ? linhaDados.slice("data: ".length) : texto);
}

function conteudoTexto(corpo: Awaited<ReturnType<typeof corpoJsonRpc>>): string {
  const texto = corpo.result?.content?.[0]?.text;
  if (typeof texto !== "string") throw new Error("Resposta MCP sem content[0].text.");
  return texto;
}

/** O dado estruturado da resposta (`structuredContent`), validado pelo servidor contra o `outputSchema` da tool. */
function estruturado(corpo: Awaited<ReturnType<typeof corpoJsonRpc>>): Record<string, never> {
  const dado = corpo.result?.structuredContent;
  if (!dado) throw new Error("Resposta MCP sem structuredContent.");
  return dado;
}

describe("manipularMcp — transporte createMcpHandler (PRD-SDD §17/§23)", () => {
  let db: DatabaseSync;
  let env: Env;

  beforeEach(() => {
    db = criarBancoDeTeste();
    env = {
      DB: new SqliteD1Database(db) as unknown as Env["DB"],
      MCP_SECRETARIA_TOKEN: SECRETARIA_TOKEN,
      MCP_FINANCEIRO_TOKEN: FINANCEIRO_TOKEN,
      LINK_SIGNING_KEY: "chave-de-teste-nao-e-segredo-real",
    } as unknown as Env;
  });

  function chamar(token: string | null, method: string, params?: Record<string, unknown>) {
    const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json, text/event-stream" };
    if (token !== null) headers.authorization = `Bearer ${token}`;
    const requisicao = new Request("https://vitalis.test/mcp", {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    return manipularMcp(requisicao, env);
  }

  function chamarTool(token: string | null, nome: string, args: Record<string, unknown> = {}) {
    return chamar(token, "tools/call", { name: nome, arguments: args });
  }

  it("recusa requisição sem Bearer com 401", async () => {
    const resposta = await chamar(null, "tools/list");
    expect(resposta.status).toBe(401);
  });

  it("recusa Bearer que não bate com nenhum dos dois tokens configurados", async () => {
    const resposta = await chamar("token-forjado", "tools/list");
    expect(resposta.status).toBe(401);
  });

  it("tools/list expõe exatamente as tools do contrato, com esses nomes", async () => {
    const resposta = await chamar(SECRETARIA_TOKEN, "tools/list");
    const corpo = await corpoJsonRpc(resposta);
    const nomes = (corpo.result?.tools as Array<{ name: string }> | undefined)?.map((t) => t.name);
    // As cinco do PRD-SDD §23.3 mais `consultar_relatorio`, acrescentada com o papel DIRECAO.
    expect(nomes).toEqual([
      "consultar_regra",
      "verificar_guia",
      "registrar_guia",
      "minhas_pendencias",
      "consultar_historico",
      "consultar_relatorio",
    ]);
  });

  it("consultar_regra devolve a regra ativa para convênio e procedimento conhecidos", async () => {
    const resposta = await chamarTool(SECRETARIA_TOKEN, "consultar_regra", { convenio: "Vitalcard", procedimento_codigo: "50000470" });
    const corpo = await corpoJsonRpc(resposta);
    const saida = estruturado(corpo) as { convenio: { nome: string }; procedimento_consultado: { codigo: string; coberto_por_este_convenio: boolean } };
    expect(saida.convenio.nome).toBe("Vitalcard");
    expect(saida.procedimento_consultado.codigo).toBe("50000470");
    expect(saida.procedimento_consultado.coberto_por_este_convenio).toBe(true);
  });

  it("verificar_guia não persiste nada, mesmo com guia estruturada válida", async () => {
    const antes = contar(db, "protocols");
    const resposta = await chamarTool(SECRETARIA_TOKEN, "verificar_guia", { guia: guiaBrutaFixture() });
    const corpo = await corpoJsonRpc(resposta);
    const saida = estruturado(corpo) as { persistiu: boolean };
    expect(saida.persistiu).toBe(false);
    expect(conteudoTexto(corpo)).toContain("Nada foi gravado");
    expect(contar(db, "protocols")).toBe(antes);
  });

  it("registrar_guia recusa o Financeiro sem criar nada", async () => {
    const antes = contar(db, "protocols");
    const resposta = await chamarTool(FINANCEIRO_TOKEN, "registrar_guia", { id_guia_origem: "MCP-TESTE-0001", guia: guiaBrutaFixture() });
    const corpo = await corpoJsonRpc(resposta);
    expect(corpo.result?.isError).toBe(true);
    expect(conteudoTexto(corpo)).toMatch(/Secretaria/);
    expect(contar(db, "protocols")).toBe(antes);
  });

  it("registrar_guia cria pela Secretaria e é idempotente pela mesma origem", async () => {
    const primeira = await chamarTool(SECRETARIA_TOKEN, "registrar_guia", { id_guia_origem: "MCP-TESTE-0001", guia: guiaBrutaFixture() });
    const saidaPrimeira = estruturado(await corpoJsonRpc(primeira)) as { ja_existia: boolean; protocolo: { numero_protocolo: string } };
    expect(saidaPrimeira.ja_existia).toBe(false);
    expect(contar(db, "protocols")).toBe(1);

    const segunda = await chamarTool(SECRETARIA_TOKEN, "registrar_guia", { id_guia_origem: "MCP-TESTE-0001", guia: guiaBrutaFixture() });
    const saidaSegunda = estruturado(await corpoJsonRpc(segunda)) as { ja_existia: boolean; protocolo: { numero_protocolo: string } };
    expect(saidaSegunda.ja_existia).toBe(true);
    expect(saidaSegunda.protocolo.numero_protocolo).toBe(saidaPrimeira.protocolo.numero_protocolo);
    expect(contar(db, "protocols")).toBe(1);
  });

  it("minhas_pendencias deriva a área da credencial (não aceita área como argumento) e difere entre papéis", async () => {
    await chamarTool(SECRETARIA_TOKEN, "registrar_guia", { id_guia_origem: "MCP-TESTE-0001", guia: guiaBrutaFixture() });

    const comoSecretaria = estruturado(await corpoJsonRpc(await chamarTool(SECRETARIA_TOKEN, "minhas_pendencias", { area: "FINANCEIRO" }))) as { area: string };
    const comoFinanceiro = estruturado(await corpoJsonRpc(await chamarTool(FINANCEIRO_TOKEN, "minhas_pendencias", { area: "FINANCEIRO" }))) as { area: string };

    // Mesmo passando `area: "FINANCEIRO"` em ambas as chamadas, a área respondida segue o Bearer.
    expect(comoSecretaria.area).toBe("SECRETARIA");
    expect(comoFinanceiro.area).toBe("FINANCEIRO");
  });
});
