import type { ManipuladorRota } from "../routes";
import {
  esquemaListaProtocolosConsulta,
  esquemaListaProtocolosResposta,
  type ListaProtocolosConsulta,
  type ListaProtocolosResposta,
} from "../contracts";

/**
 * GET /api/protocols — PRD-SDD §24/§14 (RF-14: "a lista sem filtros mostra todas as guias").
 * Filtro, busca, ordenação e paginação inteiramente em SQL (PRD §31: mesmo com poucos
 * registros, a listagem sempre pagina) — nunca carrega as 80 linhas para filtrar em memória.
 *
 * Sem parâmetro de ordenação no contrato fixado (`esquemaListaProtocolosConsulta`): a ordem
 * padrão (mais atualizado primeiro) é uma escolha deste handler, não algo pedido pelo cliente.
 */

interface LinhaListagem {
  readonly protocol_number: string;
  readonly source_guide_id: string | null;
  readonly validation_status: string;
  readonly workflow_status: string;
  readonly assigned_area: string | null;
  readonly current_risk_cents: number;
  readonly updated_at_utc: string;
  readonly version_number: number;
  readonly unidade: string | null;
  readonly data_atendimento: string | null;
  readonly paciente: string | null;
  readonly convenio: string | null;
  readonly carteirinha: string | null;
  readonly procedimento_codigo: string | null;
  readonly procedimento_descricao: string | null;
  readonly resumo_validacao: string | null;
}

interface FiltroSql {
  readonly condicoes: string[];
  readonly parametros: unknown[];
}

function montarFiltro(consulta: ListaProtocolosConsulta): FiltroSql {
  const condicoes: string[] = [];
  const parametros: unknown[] = [];

  if (consulta.status_validacao && consulta.status_validacao.length > 0) {
    condicoes.push(`p.validation_status IN (${consulta.status_validacao.map(() => "?").join(",")})`);
    parametros.push(...consulta.status_validacao);
  }
  if (consulta.status_fluxo && consulta.status_fluxo.length > 0) {
    condicoes.push(`p.workflow_status IN (${consulta.status_fluxo.map(() => "?").join(",")})`);
    parametros.push(...consulta.status_fluxo);
  }
  if (consulta.area && consulta.area.length > 0) {
    condicoes.push(`p.assigned_area IN (${consulta.area.map(() => "?").join(",")})`);
    parametros.push(...consulta.area);
  }
  if (consulta.unidade) {
    condicoes.push(`json_extract(gv.normalized_payload_json, '$.unidade') = ?`);
    parametros.push(consulta.unidade);
  }
  if (consulta.convenio) {
    condicoes.push(`json_extract(gv.normalized_payload_json, '$.convenio') = ?`);
    parametros.push(consulta.convenio);
  }
  if (consulta.data_atendimento_inicio) {
    condicoes.push(`json_extract(gv.normalized_payload_json, '$.data_atendimento') >= ?`);
    parametros.push(consulta.data_atendimento_inicio);
  }
  if (consulta.data_atendimento_fim) {
    condicoes.push(`json_extract(gv.normalized_payload_json, '$.data_atendimento') <= ?`);
    parametros.push(consulta.data_atendimento_fim);
  }
  if (consulta.busca) {
    condicoes.push(
      `(p.protocol_number LIKE ? OR p.source_guide_id LIKE ? OR json_extract(gv.normalized_payload_json, '$.paciente') LIKE ?)`,
    );
    const termo = `%${consulta.busca}%`;
    parametros.push(termo, termo, termo);
  }

  return { condicoes, parametros };
}

export async function montarListaProtocolos(
  db: D1Database,
  parametrosConsulta: Record<string, string | undefined>,
): Promise<ListaProtocolosResposta> {
  const consulta = esquemaListaProtocolosConsulta.parse(parametrosConsulta);
  const { condicoes, parametros } = montarFiltro(consulta);
  const clausulaWhere = condicoes.length > 0 ? `WHERE ${condicoes.join(" AND ")}` : "";

  const totalLinha = await db
    .prepare(
      `SELECT COUNT(*) AS total
       FROM protocols p
       JOIN guide_versions gv ON gv.id = p.current_version_id
       ${clausulaWhere}`,
    )
    .bind(...parametros)
    .first<{ total: number }>();
  const total = totalLinha?.total ?? 0;

  const deslocamento = (consulta.pagina - 1) * consulta.tamanho;

  const itensResultado = await db
    .prepare(
      `SELECT p.protocol_number, p.source_guide_id, p.validation_status, p.workflow_status,
              p.assigned_area, p.current_risk_cents, p.updated_at_utc, gv.version_number,
              json_extract(gv.normalized_payload_json, '$.unidade') AS unidade,
              json_extract(gv.normalized_payload_json, '$.data_atendimento') AS data_atendimento,
              json_extract(gv.normalized_payload_json, '$.paciente') AS paciente,
              json_extract(gv.normalized_payload_json, '$.convenio') AS convenio,
              json_extract(gv.normalized_payload_json, '$.carteirinha') AS carteirinha,
              json_extract(gv.normalized_payload_json, '$.procedimento_codigo') AS procedimento_codigo,
              json_extract(gv.normalized_payload_json, '$.procedimento_descricao') AS procedimento_descricao,
              (SELECT vr.summary FROM validation_runs vr
                 WHERE vr.guide_version_id = gv.id ORDER BY vr.finished_at_utc DESC LIMIT 1) AS resumo_validacao
       FROM protocols p
       JOIN guide_versions gv ON gv.id = p.current_version_id
       ${clausulaWhere}
       ORDER BY p.updated_at_utc DESC, p.protocol_number ASC
       LIMIT ? OFFSET ?`,
    )
    .bind(...parametros, consulta.tamanho, deslocamento)
    .all<LinhaListagem>();

  const protocolos = itensResultado.results.map((linha) => ({
    numero_protocolo: linha.protocol_number,
    id_guia_origem: linha.source_guide_id,
    unidade: linha.unidade ?? "",
    data_atendimento: linha.data_atendimento ?? "",
    paciente: linha.paciente ?? "",
    convenio: linha.convenio ?? "",
    carteirinha: linha.carteirinha ?? "",
    procedimento_codigo: linha.procedimento_codigo ?? "",
    procedimento_descricao: linha.procedimento_descricao ?? "",
    status_validacao: linha.validation_status as ListaProtocolosResposta["protocolos"][number]["status_validacao"],
    resumo_validacao: linha.resumo_validacao ?? "",
    status_fluxo: linha.workflow_status as ListaProtocolosResposta["protocolos"][number]["status_fluxo"],
    area_responsavel: linha.assigned_area as ListaProtocolosResposta["protocolos"][number]["area_responsavel"],
    risco_cents: linha.current_risk_cents,
    numero_versao_atual: linha.version_number,
    atualizado_em_utc: linha.updated_at_utc,
  }));

  return esquemaListaProtocolosResposta.parse({
    protocolos,
    paginacao: {
      pagina: consulta.pagina,
      tamanho: consulta.tamanho,
      total,
      total_paginas: Math.ceil(total / consulta.tamanho),
    },
  });
}

export const manipularListaProtocolos: ManipuladorRota = async (ctx) => {
  const parametrosConsulta = Object.fromEntries(ctx.url.searchParams);
  const resposta = await montarListaProtocolos(ctx.env.DB, parametrosConsulta);
  return Response.json(resposta);
};
