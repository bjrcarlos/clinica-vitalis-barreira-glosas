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

/**
 * `consultar_historico` (PRD-SDD §23.3): filtra por papel autenticado; nunca inclui secrets ou
 * binários.
 *
 * **Esta tool devolve EVENTOS, e evento não é guia.** Um mesmo protocolo aparece uma vez por
 * cadastro, importação, validação, correção e assim por diante — e cada evento carrega o estado
 * ATUAL do protocolo, repetido. Somar esses estados dá um número que parece "guias por estado" e
 * não é: na base de agosto, contar os 100 eventos devolvidos dava 54 OK / 28 corrigir / 18
 * revisão, enquanto a verdade são 29 / 12 / 34 em 80 guias.
 *
 * Três decisões impedem que isso volte a acontecer:
 *
 * 1. os campos de estado dizem no nome que são do protocolo e atuais
 *    (`status_validacao_atual_do_protocolo`), não uma foto do momento do evento;
 * 2. a resposta informa `total_eventos_no_filtro`, `limite_aplicado`, `truncado` e
 *    `protocolos_distintos`, então quem lê sabe se está olhando uma lista cortada;
 * 3. a descrição da tool manda usar `consultar_relatorio` para contagem por estado.
 */
export function registrarConsultarHistorico(server: McpServer, env: Env, contexto: ContextoMcp): void {
  server.registerTool(
    "consultar_historico",
    {
      description:
        "Linha do tempo de EVENTOS (cadastro, importação, validação, correção...) respeitando a área autenticada. Não serve para contar guias por estado — cada protocolo aparece em vários eventos; para contagens use consultar_relatorio.",
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

      // Totais do filtro inteiro, não da página: é o que revela que a lista veio cortada.
      const totais = await env.DB.prepare(
        `SELECT COUNT(*) AS eventos, COUNT(DISTINCT p.id) AS protocolos FROM workflow_events e JOIN protocols p ON p.id = e.protocol_id ${filtro}`,
      )
        .bind(...valores)
        .first<{ eventos: number; protocolos: number }>();

      const eventos = linhas.results.map((linha) => ({
        numero_protocolo: linha.protocol_number,
        id_guia_origem: linha.source_guide_id,
        evento: linha.event_type,
        papel_do_autor: linha.actor_role,
        origem: linha.source,
        motivo: linha.reason,
        ocorrido_em_utc: linha.occurred_at_utc,
        registrado_em_utc: linha.recorded_at_utc,
        // Nome longo de propósito: é o estado de HOJE do protocolo, repetido em cada evento dele.
        // Somar este campo entre eventos não devolve contagem de guias.
        status_validacao_atual_do_protocolo: linha.validation_status,
        status_fluxo_atual_do_protocolo: linha.workflow_status,
        metadata: JSON.parse(linha.metadata_json) as unknown,
      }));

      const saida = {
        eventos_retornados: eventos.length,
        total_eventos_no_filtro: totais?.eventos ?? eventos.length,
        protocolos_distintos: totais?.protocolos ?? 0,
        limite_aplicado: entrada.limite,
        truncado: (totais?.eventos ?? 0) > eventos.length,
        observacao:
          "Cada linha é um evento, não uma guia: um protocolo aparece várias vezes e leva o estado atual dele junto. Para contagem por estado use consultar_relatorio.",
        eventos,
      };
      return { content: [{ type: "text", text: JSON.stringify(saida) }] };
    },
  );
}
