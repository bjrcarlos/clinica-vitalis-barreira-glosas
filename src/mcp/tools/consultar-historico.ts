import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { esquemaNumeroProtocolo } from "../../http/contracts";
import { apresentarArea, apresentarFluxoStatus, apresentarValidacaoStatus, type Area, type FluxoStatus, type ValidacaoStatus } from "../../domain/statuses";
import { apresentarTipoEvento, formatarDataHoraBrasilia } from "../../domain/apresentacao";
import type { Env } from "../../worker/index";
import type { ContextoMcp } from "../auth";
import { SOMENTE_LEITURA, avisoTruncado, responder, tabela } from "../resposta";

const TIPOS_EVENTO = ["IMPORTACAO", "CADASTRO", "VALIDACAO", "CORRECAO", "REVISAO", "LIBERACAO", "ENVIO", "ENCERRAMENTO", "MERGE"] as const;

const schemaHistorico = z.object({
  protocolo: esquemaNumeroProtocolo.optional().describe("Número do protocolo (ex.: VIT-2026-000012)."),
  id_guia: z.string().trim().min(1).optional().describe("ID de origem da guia (coluna id_guia)."),
  data_de: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Eventos ocorridos a partir desta data (aaaa-mm-dd)."),
  data_ate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Eventos ocorridos até esta data (aaaa-mm-dd)."),
  evento: z.enum(TIPOS_EVENTO).optional().describe("Tipo de evento."),
  estado: z.enum(["OK", "CORRIGIR", "REVISAO_HUMANA", "NAO_FATURAR_CONVENIO"]).optional().describe("Estado de validação ATUAL do protocolo dono do evento."),
  limite: z.number().int().min(1).max(200).default(100).describe("Quantos eventos listar (os totais são sempre do filtro inteiro)."),
});

const esquemaEvento = z.object({
  numero_protocolo: z.string(),
  id_guia_origem: z.string().nullable(),
  evento: z.string(),
  evento_rotulo: z.string(),
  papel_do_autor: z.string(),
  papel_do_autor_rotulo: z.string(),
  origem: z.string(),
  motivo: z.string().nullable(),
  ocorrido_em_utc: z.string(),
  ocorrido_em: z.string(),
  registrado_em_utc: z.string(),
  status_validacao_atual_do_protocolo: z.string(),
  status_validacao_atual_rotulo: z.string(),
  status_fluxo_atual_do_protocolo: z.string(),
  status_fluxo_atual_rotulo: z.string(),
  metadata: z.unknown(),
});

const esquemaSaidaHistorico = z.object({
  eventos_retornados: z.number().int(),
  total_eventos_no_filtro: z.number().int(),
  protocolos_distintos: z.number().int(),
  limite_aplicado: z.number().int(),
  truncado: z.boolean(),
  observacao: z.string(),
  eventos: z.array(esquemaEvento),
});

interface LinhaEvento {
  protocol_number: string;
  source_guide_id: string | null;
  validation_status: string;
  workflow_status: string;
  event_type: string;
  actor_role: string;
  source: string;
  reason: string | null;
  occurred_at_utc: string;
  recorded_at_utc: string;
  metadata_json: string;
}

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
 * 3. o texto pronto não tem coluna de estado por linha — só o rodapé diz que o estado é de hoje.
 */
export function registrarConsultarHistorico(server: McpServer, env: Env, contexto: ContextoMcp): void {
  server.registerTool(
    "consultar_historico",
    {
      title: "Histórico de eventos",
      description:
        "Linha do tempo de EVENTOS (cadastro, importação, validação, correção, liberação, envio...) respeitando a área da credencial; a Direção vê tudo. Serve para responder 'o que aconteceu com o protocolo X' ou 'o que foi feito no período'. NÃO serve para contar guias por estado — cada protocolo aparece em vários eventos; para contagens use consultar_relatorio. Apresente o texto devolvido como veio.",
      inputSchema: schemaHistorico,
      outputSchema: esquemaSaidaHistorico,
      annotations: SOMENTE_LEITURA,
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
        .all<LinhaEvento>();

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
        evento_rotulo: apresentarTipoEvento(linha.event_type),
        papel_do_autor: linha.actor_role,
        papel_do_autor_rotulo: apresentarArea(linha.actor_role as Area),
        origem: linha.source,
        motivo: linha.reason,
        ocorrido_em_utc: linha.occurred_at_utc,
        ocorrido_em: formatarDataHoraBrasilia(linha.occurred_at_utc),
        registrado_em_utc: linha.recorded_at_utc,
        // Nome longo de propósito: é o estado de HOJE do protocolo, repetido em cada evento dele.
        // Somar este campo entre eventos não devolve contagem de guias.
        status_validacao_atual_do_protocolo: linha.validation_status,
        status_validacao_atual_rotulo: apresentarValidacaoStatus(linha.validation_status as ValidacaoStatus),
        status_fluxo_atual_do_protocolo: linha.workflow_status,
        status_fluxo_atual_rotulo: apresentarFluxoStatus(linha.workflow_status as FluxoStatus),
        metadata: JSON.parse(linha.metadata_json) as unknown,
      }));

      const totalEventos = totais?.eventos ?? eventos.length;
      const saida = {
        eventos_retornados: eventos.length,
        total_eventos_no_filtro: totalEventos,
        protocolos_distintos: totais?.protocolos ?? 0,
        limite_aplicado: entrada.limite,
        truncado: totalEventos > eventos.length,
        observacao:
          "Cada linha é um evento, não uma guia: um protocolo aparece várias vezes e leva o estado atual dele junto. Para contagem por estado use consultar_relatorio.",
        eventos,
      };

      const titulo = entrada.protocolo ? `## Histórico do protocolo ${entrada.protocolo}` : entrada.id_guia ? `## Histórico da guia ${entrada.id_guia}` : "## Histórico de eventos";
      const estadoAtual =
        entrada.protocolo && eventos.length > 0
          ? `\n\nEstado atual do protocolo: **${eventos[0].status_validacao_atual_rotulo}** · fluxo: ${eventos[0].status_fluxo_atual_rotulo}`
          : "";
      const texto =
        eventos.length === 0
          ? `${titulo}\n\n_Nenhum evento encontrado com esses filtros na sua área._`
          : `${titulo}

**${totalEventos} evento(s)** em **${saida.protocolos_distintos} protocolo(s)**${estadoAtual}

${tabela(
  ["Quando (Brasília)", "Protocolo", "Evento", "Por", "Motivo"],
  eventos.map((e) => [e.ocorrido_em.replace(" · horário de Brasília", ""), e.numero_protocolo, e.evento_rotulo, `${e.papel_do_autor_rotulo} (${e.origem})`, e.motivo ?? "—"]),
)}${avisoTruncado(eventos.length, totalEventos, "eventos")}

_Eventos não são guias: um protocolo aparece em várias linhas. Contagem por estado é de consultar_relatorio._`;

      return responder(texto, saida);
    },
  );
}
