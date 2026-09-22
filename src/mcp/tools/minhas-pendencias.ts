import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { GeradorIdCrypto } from "../../infrastructure/id";
import { assinarLink } from "../../infrastructure/signing/links";
import type { Env } from "../../worker/index";
import type { ContextoMcp } from "../auth";

const schemaPendencias = z.object({
  data_de: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  data_ate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  estado: z.string().optional(),
  limite: z.number().int().min(1).max(100).default(50),
});

/**
 * `minhas_pendencias` (PRD-SDD §23.3/§23.4): nunca recebe área — deriva de `contexto.papel`
 * (Bearer autenticado). Emite links HMAC de revisão (finalidade `review`) quando há chave de
 * assinatura configurada.
 */
export function registrarMinhasPendencias(server: McpServer, env: Env, contexto: ContextoMcp): void {
  server.registerTool(
    "minhas_pendencias",
    {
      description: "Lista pendências da área derivada da credencial e links temporários de revisão.",
      inputSchema: schemaPendencias,
    },
    async (entrada) => {
      // Direção não tem fila: a tool devolve a fila de QUEM CHAMOU, e não existe fila da Direção.
      // Devolver as duas áreas juntas aqui quebraria o contrato da tool; a visão do todo é
      // `consultar_relatorio`.
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
      const linhas = await env.DB.prepare(
        `SELECT p.protocol_number, p.validation_status, p.workflow_status, p.current_risk_cents, t.title, t.created_at_utc FROM tasks t JOIN protocols p ON p.id = t.protocol_id WHERE ${condicoes.join(" AND ")} ORDER BY t.created_at_utc ASC LIMIT ?`,
      )
        .bind(...valores, entrada.limite)
        .all<{ protocol_number: string; validation_status: string; workflow_status: string; current_risk_cents: number; title: string; created_at_utc: string }>();
      const totais = await env.DB.prepare(
        `SELECT COUNT(*) AS total, COALESCE(SUM(risco_cents), 0) AS total_valor_cents FROM (SELECT t.id AS task_id, p.id, p.current_risk_cents AS risco_cents FROM tasks t JOIN protocols p ON p.id = t.protocol_id WHERE ${condicoes.join(" AND ")} GROUP BY t.id, p.id)`,
      )
        .bind(...valores)
        .first<{ total: number; total_valor_cents: number }>();
      const agora = new Date().toISOString();
      const itens = await Promise.all(
        linhas.results.map(async (linha) => {
          const link = env.LINK_SIGNING_KEY ? await assinarLink({ finalidade: "review", recursoId: linha.protocol_number, area }, env.LINK_SIGNING_KEY, agora, new GeradorIdCrypto()) : null;
          return {
            numero_protocolo: linha.protocol_number,
            status_validacao: linha.validation_status,
            status_fluxo: linha.workflow_status,
            risco_cents: linha.current_risk_cents,
            titulo: linha.title,
            aberta_desde_utc: linha.created_at_utc,
            url_revisao: link ? `/protocolos/${encodeURIComponent(linha.protocol_number)}?token=${encodeURIComponent(link.token)}` : null,
            expira_em_utc: link?.payload.expiraEmUtc ?? null,
          };
        }),
      );
      const saida = { area, total: totais?.total ?? 0, total_valor_cents: totais?.total_valor_cents ?? 0, itens };
      return { content: [{ type: "text", text: JSON.stringify(saida) }] };
    },
  );
}
