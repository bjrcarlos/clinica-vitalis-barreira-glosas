import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { GeradorIdCrypto } from "../../infrastructure/id";
import { assinarLink } from "../../infrastructure/signing/links";
import type { Env } from "../../worker/index";
import type { ContextoMcp } from "../auth";

const LIMITE_PADRAO = 50;

const schemaPendencias = z.object({
  data_de: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  data_ate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  estado: z.string().optional(),
  limite: z.number().int().min(1).max(100).default(LIMITE_PADRAO),
});

interface LinhaPendencia {
  protocol_number: string;
  validation_status: string;
  workflow_status: string;
  current_risk_cents: number;
  titulos: string;
  tarefas: number;
  aberta_desde: string;
}

/**
 * `minhas_pendencias` (PRD-SDD §23.3/§23.4): nunca recebe área — deriva de `contexto.papel`
 * (credencial autenticada). Emite links HMAC de revisão (finalidade `review`) quando há chave de
 * assinatura configurada.
 *
 * **A saída é uma linha por PROTOCOLO, não por tarefa, e cada número diz o que conta.** A versão
 * anterior devolvia `total` sem dizer que eram tarefas e somava `total_valor_cents` por linha de
 * tarefa: um protocolo com duas tarefas abertas na mesma área entrava duas vezes na soma de
 * risco, contra o invariante "risco conta uma vez por protocolo" (CLAUDE.md). Na base de agosto
 * isso dava 27 tarefas para 26 protocolos na Secretaria e 43 para 39 no Financeiro — e risco
 * inflado nas duas.
 *
 * `truncado` existe pelo mesmo motivo: sem ele, quem recebe a resposta não distingue "são 50"
 * de "são os 50 primeiros de 300", e passa a contar em cima de uma lista cortada.
 */
export function registrarMinhasPendencias(server: McpServer, env: Env, contexto: ContextoMcp): void {
  server.registerTool(
    "minhas_pendencias",
    {
      description:
        "Fila da área derivada da credencial: um item por protocolo que espera esta área, com risco e link de revisão. Os totais são da fila desta área — para contagens da clínica inteira use consultar_relatorio.",
      inputSchema: schemaPendencias,
    },
    async (entrada) => {
      if (contexto.papel === "DIRECAO") {
        throw new Error("A Direção não tem fila própria de pendências. Use consultar_relatorio para a visão consolidada.");
      }

      const area = contexto.papel;
      const condicoes = ["t.assigned_area = ?", "t.status = 'ABERTA'", "p.workflow_status != 'MESCLADA'"];
      const valores: (string | number)[] = [area];
      if (entrada.data_de) {
        condicoes.push("substr(t.created_at_utc, 1, 10) >= ?");
        valores.push(entrada.data_de);
      }
      if (entrada.data_ate) {
        condicoes.push("substr(t.created_at_utc, 1, 10) <= ?");
        valores.push(entrada.data_ate);
      }
      if (entrada.estado) {
        condicoes.push("p.validation_status = ?");
        valores.push(entrada.estado);
      }
      const filtro = condicoes.join(" AND ");

      // Uma linha por protocolo: as tarefas viram contagem e lista de títulos.
      const linhas = await env.DB.prepare(
        `SELECT p.protocol_number, p.validation_status, p.workflow_status, p.current_risk_cents,
                GROUP_CONCAT(t.title, ' | ') AS titulos, COUNT(t.id) AS tarefas, MIN(t.created_at_utc) AS aberta_desde
         FROM tasks t JOIN protocols p ON p.id = t.protocol_id
         WHERE ${filtro}
         GROUP BY p.id
         ORDER BY aberta_desde ASC
         LIMIT ?`,
      )
        .bind(...valores, entrada.limite)
        .all<LinhaPendencia>();

      // Totais vêm do banco inteiro, não da página: o risco soma cada protocolo UMA vez.
      const totais = await env.DB.prepare(
        `SELECT COUNT(DISTINCT p.id) AS protocolos, COUNT(t.id) AS tarefas
         FROM tasks t JOIN protocols p ON p.id = t.protocol_id
         WHERE ${filtro}`,
      )
        .bind(...valores)
        .first<{ protocolos: number; tarefas: number }>();

      // Risco à parte, agrupando por protocolo ANTES de somar: é o que impede contar duas vezes
      // o mesmo protocolo quando ele tem mais de uma tarefa aberta para a área.
      const risco = await env.DB.prepare(
        `SELECT COALESCE(SUM(risco), 0) AS risco_cents FROM (
           SELECT p.id, p.current_risk_cents AS risco
           FROM tasks t JOIN protocols p ON p.id = t.protocol_id
           WHERE ${filtro}
           GROUP BY p.id
         )`,
      )
        .bind(...valores)
        .first<{ risco_cents: number }>();

      const agora = new Date().toISOString();
      const itens = await Promise.all(
        linhas.results.map(async (linha) => {
          const link = env.LINK_SIGNING_KEY
            ? await assinarLink(
                { finalidade: "review", recursoId: linha.protocol_number, area },
                env.LINK_SIGNING_KEY,
                agora,
                new GeradorIdCrypto(),
              )
            : null;
          return {
            numero_protocolo: linha.protocol_number,
            status_validacao: linha.validation_status,
            status_fluxo: linha.workflow_status,
            risco_cents: linha.current_risk_cents,
            tarefas_abertas: linha.tarefas,
            titulos: linha.titulos.split(" | "),
            aberta_desde_utc: linha.aberta_desde,
            url_revisao: link
              ? `/protocolos/${encodeURIComponent(linha.protocol_number)}?token=${encodeURIComponent(link.token)}`
              : null,
            expira_em_utc: link?.payload.expiraEmUtc ?? null,
          };
        }),
      );

      const totalProtocolos = totais?.protocolos ?? 0;
      const saida = {
        area,
        total_protocolos: totalProtocolos,
        total_tarefas_abertas: totais?.tarefas ?? 0,
        risco_cents: risco?.risco_cents ?? 0,
        limite_aplicado: entrada.limite,
        truncado: itens.length < totalProtocolos,
        observacao:
          "Um item por protocolo. total_tarefas_abertas conta tarefas (um protocolo pode ter mais de uma); risco_cents soma cada protocolo uma única vez.",
        itens,
      };
      return { content: [{ type: "text", text: JSON.stringify(saida) }] };
    },
  );
}
