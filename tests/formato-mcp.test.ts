import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import { aplicarMigracoes } from "./apoio/migracoes";
import { D1SobreSqlite } from "./apoio/d1-sqlite";
import { manipularMcp } from "../src/mcp/server";
import type { Env } from "../src/worker/index";
import type { GuiaBruta } from "../src/domain/guide";

/**
 * Formato das respostas do MCP.
 *
 * Toda tool devolve o mesmo fato duas vezes: texto Markdown pronto para a pessoa (reais, horário
 * de Brasília, tabelas) em `content`, e o objeto validado contra o `outputSchema` anunciado em
 * `tools/list` em `structuredContent`. Estes testes garantem que os dois existem, que batem entre
 * si, que o servidor anuncia o schema e as anotações de leitura/escrita, e que erro vem com código
 * estável. Regra de negócio das tools está em `mcp.test.ts` e `consistencia-numeros.test.ts`.
 */

const TOKEN_SECRETARIA = "token-secretaria-formato";
const TOKEN_FINANCEIRO = "token-financeiro-formato";

let db: DatabaseSync;
let env: Env;

interface Resultado {
  readonly content?: Array<{ type: string; text: string }>;
  readonly structuredContent?: Record<string, unknown>;
  readonly isError?: boolean;
  readonly tools?: Array<{ name: string; title?: string; description?: string; outputSchema?: unknown; annotations?: Record<string, boolean> }>;
}

async function rpc(token: string, metodo: string, params: Record<string, unknown> = {}): Promise<Resultado> {
  const resposta = await manipularMcp(
    new Request("https://vitalis.example/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: metodo, params }),
    }),
    env,
  );
  const bruto = await resposta.text();
  const linha = bruto.split(/\r?\n/).find((l) => l.startsWith("data: "));
  const corpo = JSON.parse(linha ? linha.slice(6) : bruto) as { result?: Resultado; error?: { message: string } };
  if (corpo.error) throw new Error(corpo.error.message);
  return corpo.result ?? {};
}

function chamar(token: string, nome: string, argumentos: Record<string, unknown> = {}): Promise<Resultado> {
  return rpc(token, "tools/call", { name: nome, arguments: argumentos });
}

function texto(resultado: Resultado): string {
  return resultado.content?.map((c) => c.text).join("") ?? "";
}

function guia(overrides: Partial<GuiaBruta> = {}): GuiaBruta {
  return {
    id_guia: "FMT-0001",
    unidade: "Matriz",
    data_atendimento: "2026-09-10",
    paciente: "Paciente Formato",
    convenio: "Vitalcard",
    carteirinha: "999999",
    cid: "M54.5",
    procedimento_codigo: "50000470",
    procedimento_descricao: "Sessão de fisioterapia musculoesquelética",
    numero_autorizacao: "AUT-FMT",
    autorizacao_validade: "2026-12-31",
    autorizacao_sessoes_limite: "10",
    sessao_numero_na_autorizacao: "1",
    profissional: "Dra. Formato",
    profissional_registro: "CREFITO-1",
    valor: "62.00",
    observacao_recepcao: "",
    data_lancamento: "2026-09-10",
    ...overrides,
  };
}

beforeEach(() => {
  db = new DatabaseSync(":memory:");
  aplicarMigracoes(db);
  const regras = readFileSync(resolve(import.meta.dirname, "../regras_convenio.json.txt"), "utf-8");
  db.prepare(
    "INSERT INTO rule_sets (id, version, source_json, source_sha256, imported_at_utc, activated_at_utc, is_active) VALUES ('rs-fmt', 'agosto/2026', ?, ?, '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z', 1)",
  ).run(regras, "0".repeat(64));
  env = {
    DB: new D1SobreSqlite(db) as unknown as D1Database,
    EVIDENCE: {} as R2Bucket,
    AI: {} as Ai,
    ASSETS: {} as Fetcher,
    MCP_SECRETARIA_TOKEN: TOKEN_SECRETARIA,
    MCP_FINANCEIRO_TOKEN: TOKEN_FINANCEIRO,
    LINK_SIGNING_KEY: "chave-formato-1234567890",
  } as Env;
});

describe("tools/list anuncia contrato de saída e natureza de cada tool", () => {
  it("toda tool tem título, outputSchema e anotações; só registrar_guia escreve", async () => {
    const lista = await rpc(TOKEN_SECRETARIA, "tools/list");
    const tools = lista.tools ?? [];
    expect(tools.length).toBe(6);

    for (const tool of tools) {
      expect(tool.title, tool.name).toBeTruthy();
      expect(tool.outputSchema, tool.name).toBeDefined();
      expect(tool.annotations?.destructiveHint, tool.name).toBe(false);
      expect(tool.annotations?.readOnlyHint, tool.name).toBe(tool.name !== "registrar_guia");
    }
  });

  it("as descrições mandam apresentar o texto como veio e apontam a fonte das contagens", async () => {
    const lista = await rpc(TOKEN_SECRETARIA, "tools/list");
    const porNome = Object.fromEntries((lista.tools ?? []).map((t) => [t.name, t.description ?? ""]));

    expect(porNome.consultar_historico).toContain("consultar_relatorio");
    expect(porNome.minhas_pendencias).toContain("consultar_relatorio");
    expect(porNome.verificar_guia).toContain("NÃO grava");
    expect(porNome.registrar_guia).toContain("GRAVA");
  });
});

describe("cada tool devolve texto pronto e o mesmo dado estruturado", () => {
  it("consultar_regra: cobertura em sim/não, valor em reais e erro com código para convênio inexistente", async () => {
    const ok = await chamar(TOKEN_SECRETARIA, "consultar_regra", { convenio: "vitalcard", procedimento_codigo: "50000470" });
    const dado = ok.structuredContent as { convenio: { nome: string }; procedimento_consultado: { coberto_por_este_convenio: boolean; valor_referencia: string } };

    expect(dado.convenio.nome).toBe("Vitalcard");
    expect(dado.procedimento_consultado.coberto_por_este_convenio).toBe(true);
    expect(dado.procedimento_consultado.valor_referencia).toBe("R$ 62,00");
    expect(texto(ok)).toContain("Coberto por Vitalcard: **sim**");
    expect(texto(ok)).toContain("| Campo | Chave |");
    expect(texto(ok)).toContain("nada foi gravado");

    const erro = await chamar(TOKEN_SECRETARIA, "consultar_regra", { convenio: "Plano Inexistente" });
    expect(erro.isError).toBe(true);
    expect(texto(erro)).toMatch(/^\[CONVENIO_DESCONHECIDO\]/);
    expect(texto(erro)).toContain("Vitalcard");
  });

  it("verificar_guia: estado, risco em reais, tabela de problemas, próximo passo e aviso de que nada foi gravado", async () => {
    const resultado = await chamar(TOKEN_FINANCEIRO, "verificar_guia", { guia: guia({ autorizacao_validade: "2026-01-01", carteirinha: "" }) });
    const dado = resultado.structuredContent as { status: string; status_rotulo: string; risco: string; campos_ausentes: string[]; proximo_passo: string; persistiu: boolean };

    expect(dado.status).toBe("CORRIGIR");
    expect(dado.status_rotulo).toBe("Corrigir");
    expect(dado.risco).toBe("R$ 62,00");
    expect(dado.campos_ausentes).toContain("carteirinha");
    expect(dado.persistiu).toBe(false);
    expect(dado.proximo_passo).toContain("Secretaria");

    const t = texto(resultado);
    expect(t).toContain("**Estado: Corrigir**");
    expect(t).toContain("| Problema | Evidência | Quem resolve |");
    expect(t).toContain("01/01/2026");
    expect(t).toContain("Nada foi gravado");
    expect(t).not.toContain("2026-01-01");
  });

  it("registrar_guia: texto diz que criou e, na repetição, que nada novo foi gravado", async () => {
    const primeira = await chamar(TOKEN_SECRETARIA, "registrar_guia", { id_guia_origem: "FMT-0001", guia: guia() });
    expect(texto(primeira)).toMatch(/^## Protocolo VT-\d{2}-\d{4} criado/);
    expect((primeira.structuredContent as { gravado_nesta_chamada: boolean }).gravado_nesta_chamada).toBe(true);

    const segunda = await chamar(TOKEN_SECRETARIA, "registrar_guia", { id_guia_origem: "FMT-0001", guia: guia() });
    expect(texto(segunda)).toContain("Nada novo foi gravado");
    expect((segunda.structuredContent as { gravado_nesta_chamada: boolean }).gravado_nesta_chamada).toBe(false);

    const recusa = await chamar(TOKEN_FINANCEIRO, "registrar_guia", { id_guia_origem: "FMT-0002", guia: guia() });
    expect(recusa.isError).toBe(true);
    expect(texto(recusa)).toMatch(/^\[ROLE_NOT_ALLOWED\]/);
  });

  it("minhas_pendencias: cabeçalho com totais em reais, tabela por motivo e lista de protocolos", async () => {
    await chamar(TOKEN_SECRETARIA, "registrar_guia", { id_guia_origem: "FMT-0001", guia: guia({ autorizacao_validade: "2026-01-01" }) });
    const fila = await chamar(TOKEN_SECRETARIA, "minhas_pendencias");
    const dado = fila.structuredContent as { total_protocolos: number; risco: string; por_motivo: Array<{ motivo: string; protocolos: number; risco: string }>; itens: Array<{ risco: string; aberta_desde: string; url_revisao: string | null }> };

    expect(dado.total_protocolos).toBe(1);
    expect(dado.risco).toBe("R$ 62,00");
    expect(dado.por_motivo.length).toBeGreaterThan(0);
    expect(dado.por_motivo[0].protocolos).toBe(1);
    expect(dado.itens[0].url_revisao).toMatch(/^\/protocolos\/VT-/);
    expect(dado.itens[0].aberta_desde).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);

    const t = texto(fila);
    expect(t).toContain("## Fila da Secretaria");
    expect(t).toContain("| Motivo | Protocolos | Risco | Números |");
    expect(t).toContain("| Protocolo | Estado | Pendências | Risco | Aberta desde | Revisar |");
    expect(t).toContain("R$ 62,00");
  });

  it("minhas_pendencias vazia diz que não há pendência, em vez de tabela sem linhas", async () => {
    const fila = await chamar(TOKEN_FINANCEIRO, "minhas_pendencias");
    expect(texto(fila)).toContain("Nenhuma pendência aberta");
    expect((fila.structuredContent as { total_protocolos: number }).total_protocolos).toBe(0);
  });

  it("consultar_historico: tabela sem coluna de estado por linha, data em Brasília e aviso de que evento não é guia", async () => {
    await chamar(TOKEN_SECRETARIA, "registrar_guia", { id_guia_origem: "FMT-0001", guia: guia() });
    const historico = await chamar(TOKEN_SECRETARIA, "consultar_historico");
    const dado = historico.structuredContent as { eventos: Array<{ evento_rotulo: string; ocorrido_em: string }> };

    expect(dado.eventos[0].ocorrido_em).toContain("horário de Brasília");
    expect(dado.eventos.map((e) => e.evento_rotulo)).toContain("Protocolo cadastrado");

    const t = texto(historico);
    expect(t).toContain("| Quando (Brasília) | Protocolo | Evento | Por | Motivo |");
    expect(t).toContain("Eventos não são guias");
    expect(t).not.toContain("| Estado |");
  });

  it("aviso de lista cortada aparece no texto quando o limite corta a lista", async () => {
    await chamar(TOKEN_SECRETARIA, "registrar_guia", { id_guia_origem: "FMT-0001", guia: guia() });
    await chamar(TOKEN_SECRETARIA, "registrar_guia", { id_guia_origem: "FMT-0002", guia: guia({ id_guia: "FMT-0002", paciente: "Outra Pessoa" }) });
    const historico = await chamar(TOKEN_SECRETARIA, "consultar_historico", { limite: 1 });

    expect((historico.structuredContent as { truncado: boolean }).truncado).toBe(true);
    expect(texto(historico)).toContain("Lista cortada");
  });
});
