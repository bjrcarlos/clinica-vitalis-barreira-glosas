import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import { aplicarMigracoes } from "./apoio/migracoes";
import { D1SobreSqlite } from "./apoio/d1-sqlite";
import { manipularMcp } from "../src/mcp/server";
import { montarRelatorio } from "../src/http/handlers/report";
import type { Env } from "../src/worker/index";

/**
 * Consistência entre as três bocas do sistema: banco, relatório (o que a interface mostra) e MCP.
 *
 * Nasceu de uma divergência real. Um assistente conectado ao MCP pediu o histórico, somou o
 * campo de estado que vinha repetido em cada evento e anunciou "36 OK, 40 revisão humana, 24
 * corrigir" — números que não existem em lugar nenhum. A verdade eram 29/34/12 em 80 guias, e os
 * "100 eventos" eram só o limite da consulta.
 *
 * Três defeitos estavam por trás, e cada `it` abaixo trava um deles:
 *
 * 1. o histórico devolvia eventos com o estado ATUAL do protocolo repetido, sem dizer isso;
 * 2. a resposta não avisava que a lista tinha sido cortada pelo limite;
 * 3. `minhas_pendencias` chamava de `total` uma contagem de TAREFAS e somava risco por tarefa —
 *    um protocolo com duas tarefas abertas entrava duas vezes, contra "risco conta uma vez por
 *    protocolo" (CLAUDE.md).
 */

const TOKEN_SECRETARIA = "token-secretaria-consistencia";
const TOKEN_FINANCEIRO = "token-financeiro-consistencia";

let db: DatabaseSync;
let env: Env;

/** Insere um protocolo já validado, com as tarefas abertas que a fila de cada área vai ver. */
function inserirProtocolo(entrada: {
  readonly numero: string;
  readonly status: "OK" | "CORRIGIR" | "REVISAO_HUMANA" | "NAO_FATURAR_CONVENIO";
  readonly area: "SECRETARIA" | "FINANCEIRO" | null;
  readonly riscoCents: number;
  readonly tarefas: ReadonlyArray<{ readonly area: "SECRETARIA" | "FINANCEIRO"; readonly titulo: string }>;
  readonly eventos: number;
  /** Códigos de problema abertos, que alimentam o detalhamento por motivo do relatório. */
  readonly motivos?: ReadonlyArray<{ readonly codigo: string; readonly area: "SECRETARIA" | "FINANCEIRO" }>;
}): void {
  const id = `p-${entrada.numero}`;
  const versao = `v-${entrada.numero}`;
  const agora = "2026-09-01T12:00:00.000Z";

  // `protocols.current_version_id` e `guide_versions.protocol_id` se apontam: a inserção só passa
  // dentro de uma transação com as chaves estrangeiras adiadas até o COMMIT.
  db.exec("BEGIN");
  db.exec("PRAGMA defer_foreign_keys = on");
  db.prepare(
    `INSERT INTO protocols (id, protocol_number, source_guide_id, current_version_id, validation_status, workflow_status, assigned_area, current_risk_cents, initial_risk_cents, created_at_utc, updated_at_utc)
     VALUES (?, ?, ?, ?, ?, 'EM_TRATAMENTO', ?, ?, ?, ?, ?)`,
  ).run(id, entrada.numero, `G-${entrada.numero}`, versao, entrada.status, entrada.area, entrada.riscoCents, entrada.riscoCents, agora, agora);

  db.prepare(
    `INSERT INTO guide_versions (id, protocol_id, version_number, raw_payload_json, normalized_payload_json, diff_json, created_by_role, created_by_principal, occurred_at_utc, recorded_at_utc)
     VALUES (?, ?, 1, '{}', '{}', '{}', 'SISTEMA', 'teste', ?, ?)`,
  ).run(versao, id, agora, agora);

  db.prepare(
    `INSERT INTO validation_runs (id, protocol_id, guide_version_id, rule_set_id, result_status, summary, ai_status, started_at_utc, finished_at_utc)
     VALUES (?, ?, ?, 'rs-teste', ?, 'resumo', 'NAO_EXECUTADA', ?, ?)`,
  ).run(`vr-${entrada.numero}`, id, versao, entrada.status, agora, agora);

  (entrada.motivos ?? []).forEach((motivo, indice) => {
    db.prepare(
      `INSERT INTO validation_issues (id, validation_run_id, code, title, recommended_action, owner_area, status, subproblems_json, rule_reference_json, created_at_utc)
       VALUES (?, ?, ?, ?, 'CORRIGIR', ?, 'ABERTO', '[]', '{}', ?)`,
    ).run(`i-${entrada.numero}-${indice}`, `vr-${entrada.numero}`, motivo.codigo, `Problema ${motivo.codigo}`, motivo.area, agora);
  });

  entrada.tarefas.forEach((tarefa, indice) => {
    db.prepare(
      `INSERT INTO tasks (id, protocol_id, assigned_area, task_type, title, status, blocking, created_at_utc)
       VALUES (?, ?, ?, 'CORRIGIR', ?, 'ABERTA', 1, ?)`,
    ).run(`t-${entrada.numero}-${indice}`, id, tarefa.area, tarefa.titulo, agora);
  });

  for (let indice = 0; indice < entrada.eventos; indice += 1) {
    db.prepare(
      `INSERT INTO workflow_events (id, protocol_id, event_type, actor_role, actor_principal, source, metadata_json, occurred_at_utc, recorded_at_utc)
       VALUES (?, ?, 'VALIDACAO_EXECUTADA', 'SISTEMA', 'teste', 'SISTEMA', '{}', ?, ?)`,
    ).run(`e-${entrada.numero}-${indice}`, id, agora, agora);
  }
  db.exec("COMMIT");
}

async function chamarTool(token: string, nome: string, argumentos: Record<string, unknown> = {}): Promise<Record<string, never>> {
  const resposta = await manipularMcp(
    new Request("https://vitalis.example/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: nome, arguments: argumentos } }),
    }),
    env,
  );
  const bruto = await resposta.text();
  const linha = bruto.split(/\r?\n/).find((l) => l.startsWith("data: "));
  const corpo = JSON.parse(linha ? linha.slice(6) : bruto) as { result?: { content?: Array<{ text: string }> } };
  return JSON.parse(corpo.result?.content?.map((c) => c.text).join("") ?? "{}");
}

function contarPorStatus(): Record<string, number> {
  const linhas = db
    .prepare("SELECT validation_status AS status, COUNT(*) AS total FROM protocols WHERE workflow_status != 'MESCLADA' GROUP BY validation_status")
    .all() as Array<{ status: string; total: number }>;
  return Object.fromEntries(linhas.map((l) => [l.status, l.total]));
}

beforeEach(() => {
  db = new DatabaseSync(":memory:");
  aplicarMigracoes(db);
  const regras = readFileSync(resolve(import.meta.dirname, "../regras_convenio.json.txt"), "utf-8");
  db.prepare(
    "INSERT INTO rule_sets (id, version, source_json, source_sha256, imported_at_utc, activated_at_utc, is_active) VALUES ('rs-teste', 'agosto/2026', ?, ?, '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z', 1)",
  ).run(regras, "0".repeat(64));

  // Dois protocolos da Secretaria, sendo UM com duas tarefas abertas na mesma área: é o caso que
  // fazia o risco ser somado duas vezes.
  inserirProtocolo({
    numero: "VT-99-0001",
    status: "CORRIGIR",
    area: "SECRETARIA",
    riscoCents: 10_000,
    tarefas: [
      { area: "SECRETARIA", titulo: "Corrigir carteirinha" },
      { area: "SECRETARIA", titulo: "Corrigir CID" },
    ],
    eventos: 3,
    motivos: [
      { codigo: "CAMPO_OBRIGATORIO_AUSENTE", area: "SECRETARIA" },
      { codigo: "AUTORIZACAO_VENCIDA", area: "SECRETARIA" },
    ],
  });
  inserirProtocolo({
    numero: "VT-99-0002",
    status: "REVISAO_HUMANA",
    area: "SECRETARIA",
    riscoCents: 5_000,
    tarefas: [{ area: "SECRETARIA", titulo: "Revisar observação" }],
    eventos: 2,
  });
  inserirProtocolo({
    numero: "VT-99-0003",
    status: "NAO_FATURAR_CONVENIO",
    area: "FINANCEIRO",
    riscoCents: 9_000,
    tarefas: [{ area: "FINANCEIRO", titulo: "Decidir particular ou cancelar" }],
    eventos: 4,
  });
  inserirProtocolo({ numero: "VT-99-0004", status: "OK", area: null, riscoCents: 0, tarefas: [], eventos: 1 });

  env = {
    DB: new D1SobreSqlite(db) as unknown as D1Database,
    EVIDENCE: {} as R2Bucket,
    AI: {} as Ai,
    ASSETS: {} as Fetcher,
    MCP_SECRETARIA_TOKEN: TOKEN_SECRETARIA,
    MCP_FINANCEIRO_TOKEN: TOKEN_FINANCEIRO,
    LINK_SIGNING_KEY: "chave-consistencia-1234567890",
  } as Env;
});

describe("relatório e banco contam a mesma coisa", () => {
  it("distribuição por estado de validação bate com o SQL direto", async () => {
    const relatorio = await montarRelatorio(env.DB);
    const doBanco = contarPorStatus();
    const doRelatorio = Object.fromEntries(relatorio.distribuicao_por_estado_validacao.map((l) => [l.status_validacao, l.quantidade]));

    for (const [status, total] of Object.entries(doBanco)) {
      expect(doRelatorio[status], `estado ${status}`).toBe(total);
    }
    expect(relatorio.guias_verificadas.valor).toBe(4);
  });

  it("tarefas abertas por área batem entre relatório e MCP", async () => {
    const relatorio = await montarRelatorio(env.DB);
    const doRelatorio = Object.fromEntries(relatorio.distribuicao_por_area.map((l) => [l.area, l.quantidade_tarefas_abertas]));

    const secretaria = await chamarTool(TOKEN_SECRETARIA, "minhas_pendencias");
    const financeiro = await chamarTool(TOKEN_FINANCEIRO, "minhas_pendencias");

    expect(secretaria.total_tarefas_abertas).toBe(doRelatorio.SECRETARIA);
    expect(financeiro.total_tarefas_abertas).toBe(doRelatorio.FINANCEIRO);
  });
});

describe("o relatório já vem detalhado, sem precisar de um segundo pedido", () => {
  it("traz motivo, guias, protocolos e responsável por estado", async () => {
    const relatorio = await montarRelatorio(env.DB);
    const deCorrigir = relatorio.motivos_por_estado.filter((l) => l.status_validacao === "CORRIGIR");

    expect(deCorrigir.length).toBeGreaterThan(0);
    for (const linha of deCorrigir) {
      expect(linha.titulo).not.toBe("");
      expect(linha.area_responsavel).toBe("SECRETARIA");
      expect(linha.protocol_numbers.length).toBe(linha.guias);
    }
  });

  it("conta GUIAS por motivo, e os protocolos citados existem naquele estado", async () => {
    const relatorio = await montarRelatorio(env.DB);
    const doEstado = new Set(
      (db.prepare("SELECT protocol_number FROM protocols WHERE validation_status = 'CORRIGIR'").all() as Array<{ protocol_number: string }>).map(
        (l) => l.protocol_number,
      ),
    );

    for (const linha of relatorio.motivos_por_estado.filter((l) => l.status_validacao === "CORRIGIR")) {
      for (const numero of linha.protocol_numbers) expect(doEstado.has(numero)).toBe(true);
    }

    // A mesma guia tem dois motivos abertos: a soma por motivo passa do total do estado, e é por
    // isso que a contagem oficial continua sendo a distribuição por estado.
    const somaPorMotivo = relatorio.motivos_por_estado
      .filter((l) => l.status_validacao === "CORRIGIR")
      .reduce((total, l) => total + l.guias, 0);
    const totalDoEstado = relatorio.distribuicao_por_estado_validacao.find((l) => l.status_validacao === "CORRIGIR")?.quantidade ?? 0;
    expect(somaPorMotivo).toBeGreaterThan(totalDoEstado);
  });
});

describe("minhas_pendencias não infla o risco", () => {
  it("conta protocolos e tarefas separadamente, e cada número diz o que é", async () => {
    const saida = await chamarTool(TOKEN_SECRETARIA, "minhas_pendencias");
    // Dois protocolos, três tarefas: um deles tem duas tarefas abertas na mesma área.
    expect(saida.total_protocolos).toBe(2);
    expect(saida.total_tarefas_abertas).toBe(3);
    expect(saida.itens).toHaveLength(2);
  });

  it("soma o risco uma vez por protocolo, mesmo com duas tarefas abertas", async () => {
    const saida = await chamarTool(TOKEN_SECRETARIA, "minhas_pendencias");
    // 10.000 + 5.000. A soma por tarefa daria 25.000 — era o defeito.
    expect(saida.risco_cents).toBe(15_000);
  });

  it("avisa quando a lista veio cortada pelo limite", async () => {
    const cortada = await chamarTool(TOKEN_SECRETARIA, "minhas_pendencias", { limite: 1 });
    expect(cortada.itens).toHaveLength(1);
    expect(cortada.truncado).toBe(true);
    expect(cortada.total_protocolos).toBe(2);

    const inteira = await chamarTool(TOKEN_SECRETARIA, "minhas_pendencias", { limite: 50 });
    expect(inteira.truncado).toBe(false);
  });
});

describe("consultar_historico não pode ser confundido com contagem de guias", () => {
  it("informa total no filtro, protocolos distintos e truncamento", async () => {
    const saida = await chamarTool(TOKEN_SECRETARIA, "consultar_historico", { limite: 3 });
    // A Secretaria vê a própria área mais o que não tem dono: o total do filtro não é o global.
    const totalEventos = (
      db
        .prepare(
          "SELECT COUNT(*) AS t FROM workflow_events e JOIN protocols p ON p.id = e.protocol_id WHERE p.assigned_area = 'SECRETARIA' OR p.assigned_area IS NULL",
        )
        .get() as { t: number }
    ).t;

    expect(saida.eventos_retornados).toBe(3);
    expect(saida.total_eventos_no_filtro).toBe(totalEventos);
    expect(saida.truncado).toBe(true);
    expect(saida.protocolos_distintos).toBeLessThan(totalEventos);
  });

  it("nomeia o estado como atual e do protocolo, para não virar contagem", async () => {
    const saida = await chamarTool(TOKEN_SECRETARIA, "consultar_historico", { limite: 100 });
    const evento = (saida.eventos as unknown as Array<Record<string, unknown>>)[0];

    expect(evento).toHaveProperty("status_validacao_atual_do_protocolo");
    expect(evento).not.toHaveProperty("validation_status");

    // Controle negativo: somar o estado por evento continua dando um número diferente da
    // contagem real de guias — por isso o nome do campo e a observação existem.
    const porEvento = (saida.eventos as unknown as Array<{ status_validacao_atual_do_protocolo: string }>).reduce<Record<string, number>>(
      (acumulado, e) => ({ ...acumulado, [e.status_validacao_atual_do_protocolo]: (acumulado[e.status_validacao_atual_do_protocolo] ?? 0) + 1 }),
      {},
    );
    expect(porEvento.CORRIGIR).not.toBe(contarPorStatus().CORRIGIR);
    expect(String(saida.observacao)).toContain("não uma guia");
  });
});
