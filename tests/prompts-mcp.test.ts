import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import { aplicarMigracoes } from "./apoio/migracoes";
import { D1SobreSqlite } from "./apoio/d1-sqlite";
import { manipularMcp } from "../src/mcp/server";
import { nomesDePromptsPara } from "../src/mcp/prompts/index";
import type { Env } from "../src/worker/index";

/**
 * Skills embutidas no servidor, servidas como prompts MCP.
 *
 * O ponto destes testes não é "o prompt existe", e sim: a instrução que evita o erro de número
 * chega junto com a credencial, e cada papel só enxerga o que faz sentido para ele. Um arquivo de
 * Skill na máquina de alguém não garante nenhuma das duas coisas.
 */

const TOKEN_SECRETARIA = "token-secretaria-prompts";
const TOKEN_FINANCEIRO = "token-financeiro-prompts";

let db: DatabaseSync;
let env: Env;

async function rpc(token: string | null, metodo: string, params: Record<string, unknown> = {}): Promise<Record<string, never>> {
  const resposta = await manipularMcp(
    new Request("https://vitalis.example/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: metodo, params }),
    }),
    env,
  );
  const bruto = await resposta.text();
  const linha = bruto.split(/\r?\n/).find((l) => l.startsWith("data: "));
  const corpo = JSON.parse(linha ? linha.slice(6) : bruto) as { result?: Record<string, never> };
  return corpo.result ?? ({} as Record<string, never>);
}

beforeEach(() => {
  db = new DatabaseSync(":memory:");
  aplicarMigracoes(db);
  const regras = readFileSync(resolve(import.meta.dirname, "../regras_convenio.json.txt"), "utf-8");
  db.prepare(
    "INSERT INTO rule_sets (id, version, source_json, source_sha256, imported_at_utc, activated_at_utc, is_active) VALUES ('rs-teste', 'agosto/2026', ?, ?, '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z', 1)",
  ).run(regras, "0".repeat(64));

  env = {
    DB: new D1SobreSqlite(db) as unknown as D1Database,
    EVIDENCE: {} as R2Bucket,
    AI: {} as Ai,
    ASSETS: {} as Fetcher,
    MCP_SECRETARIA_TOKEN: TOKEN_SECRETARIA,
    MCP_FINANCEIRO_TOKEN: TOKEN_FINANCEIRO,
    LINK_SIGNING_KEY: "chave-prompts-1234567890",
  } as Env;
});

describe("prompts/list respeita o papel da credencial", () => {
  it("Secretaria e Financeiro recebem a fila; nenhum recebe o relatório da Direção", async () => {
    const lista = await rpc(TOKEN_SECRETARIA, "prompts/list");
    const nomes = (lista.prompts as unknown as Array<{ name: string }>).map((p) => p.name);

    expect(nomes).toContain("minha-fila");
    expect(nomes).toContain("conferir-guia");
    expect(nomes).not.toContain("relatorio-da-terca");
  });

  it("a Direção recebe o relatório e não recebe a fila, que ela não tem", () => {
    // A lista por papel é pura, e a Direção não tem Bearer fixo para exercitar via HTTP.
    expect(nomesDePromptsPara("DIRECAO")).toContain("relatorio-da-terca");
    expect(nomesDePromptsPara("DIRECAO")).not.toContain("minha-fila");
    expect(nomesDePromptsPara("FINANCEIRO")).toContain("minha-fila");
    expect(nomesDePromptsPara("FINANCEIRO")).not.toContain("relatorio-da-terca");
  });

  it("sem credencial não há prompt nenhum", async () => {
    const resposta = await manipularMcp(
      new Request("https://vitalis.example/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "prompts/list", params: {} }),
      }),
      env,
    );
    expect(resposta.status).toBe(401);
  });
});

describe("o texto do prompt carrega as regras que evitam o erro de número", () => {
  it("proíbe somar estado por evento e manda usar consultar_relatorio", async () => {
    const resultado = await rpc(TOKEN_SECRETARIA, "prompts/get", { name: "minha-fila" });
    const texto = (resultado.messages as unknown as Array<{ content: { text: string } }>)[0].content.text;

    expect(texto).toContain("consultar_relatorio");
    expect(texto).toContain("status_validacao_atual_do_protocolo");
    expect(texto).toContain("truncado");
  });

  it("lembra que o MCP não decide nada", async () => {
    const resultado = await rpc(TOKEN_FINANCEIRO, "prompts/get", { name: "conferir-guia", arguments: {} });
    const texto = (resultado.messages as unknown as Array<{ content: { text: string } }>)[0].content.text;

    expect(texto).toContain("não corrige");
    expect(texto).toContain("nada foi gravado");
  });

  it("o prompt da fila cita o papel de quem chamou, não pede área por parâmetro", async () => {
    const daSecretaria = await rpc(TOKEN_SECRETARIA, "prompts/get", { name: "minha-fila" });
    const doFinanceiro = await rpc(TOKEN_FINANCEIRO, "prompts/get", { name: "minha-fila" });
    const textoSecretaria = (daSecretaria.messages as unknown as Array<{ content: { text: string } }>)[0].content.text;
    const textoFinanceiro = (doFinanceiro.messages as unknown as Array<{ content: { text: string } }>)[0].content.text;

    expect(textoSecretaria).toContain("perfil SECRETARIA");
    expect(textoFinanceiro).toContain("perfil FINANCEIRO");
    expect(textoSecretaria).toContain("sem nenhum argumento de área");
  });

  it("o prompt de lote manda destacar prazo de envio como decisão, não erro de digitação", async () => {
    const resultado = await rpc(TOKEN_SECRETARIA, "prompts/get", { name: "conferir-lote", arguments: {} });
    const texto = (resultado.messages as unknown as Array<{ content: { text: string } }>)[0].content.text;

    expect(texto).toContain("prazo de envio");
    expect(texto).toContain("decisão é do Financeiro");
  });
});
