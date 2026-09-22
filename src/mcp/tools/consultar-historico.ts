import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { esquemaNumeroProtocolo } from "../../http/contracts";
import type { Env } from "../../worker/index";
import type { ContextoMcp } from "../auth";

const schemaHistorico = z.object({
  protocolo: esquemaNumeroProtocolo.optional(),
  id_guia: z.string().trim().min(1).optional(),
  data_de: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  data_ate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  evento: z.string().optional(),
  estado: z.string().optional(),
  limite: z.number().int().min(1).max(200).default(100),
});

/** `consultar_historico` (PRD-SDD §23.3): filtra por papel autenticado; nunca inclui secrets ou binários. */
export function registrarConsultarHistorico(server: McpServer, env: Env, contexto: ContextoMcp): void {
  server.registerTool(
    "consultar_historico",
    {
      description: "Consulta eventos do histórico respeitando a área autenticada.",
      inputSchema: schemaHistorico,
    },
    async (entrada) => {
      // Secretaria e Financeiro veem o que é da sua área (mais o que não tem área). A Direção
      // lê o histórico inteiro — é o papel de leitura ampla, sem fila e sem escrita.
      const condicoes: string[] = [];
      const valores: (string | number)[] = [];
      if (contexto.papel !== "DIRECAO") {
        condicoes.push("(p.assigned_area = ? OR p.assigned_area IS NULL)");
        valores.push(contexto.papel);
      }
      if (entrada.protocolo) {
        condicoes.push("p.protocol_number = ?");
        valores.push(entrada.protocolo);
      }
      if (entrada.id_guia) {
        condicoes.push("p.source_guide_id = ?");
        valores.push(entrada.id_guia);
      }
      if (entrada.data_de) {
        condicoes.push("substr(e.occurred_at_utc, 1, 10) >= ?");
        valores.push(entrada.data_de);
      }
      if (entrada.data_ate) {
        condicoes.push("substr(e.occurred_at_utc, 1, 10) <= ?");
        valores.push(entrada.data_ate);
      }
      if (entrada.evento) {
        condicoes.push("e.event_type = ?");
        valores.push(entrada.evento);
      }
      if (entrada.estado) {
        condicoes.push("p.validation_status = ?");
        valores.push(entrada.estado);
      }
      // Direção sem nenhum filtro deixa `condicoes` vazio — `WHERE` vazio é SQL inválido, então
      // o recorte some da query em vez de virar string vazia.
      const filtro = condicoes.length > 0 ? `WHERE ${condicoes.join(" AND ")}` : "";
      const linhas = await env.DB.prepare(
        `SELECT p.protocol_number, p.source_guide_id, p.validation_status, p.workflow_status, e.event_type, e.actor_role, e.source, e.reason, e.occurred_at_utc, e.recorded_at_utc, e.metadata_json FROM workflow_events e JOIN protocols p ON p.id = e.protocol_id ${filtro} ORDER BY e.recorded_at_utc DESC LIMIT ?`,
      )
        .bind(...valores, entrada.limite)
        .all<{ protocol_number: string; source_guide_id: string | null; validation_status: string; workflow_status: string; event_type: string; actor_role: string; source: string; reason: string | null; occurred_at_utc: string; recorded_at_utc: string; metadata_json: string }>();
      const saida = { total: linhas.results.length, eventos: linhas.results.map((linha) => ({ ...linha, metadata: JSON.parse(linha.metadata_json) })) };
      return { content: [{ type: "text", text: JSON.stringify(saida) }] };
    },
  );
}
