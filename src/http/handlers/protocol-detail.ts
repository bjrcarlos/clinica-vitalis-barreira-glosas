import type { ManipuladorRota } from "../routes";
import { ErroDominio } from "../routes";
import {
  esquemaNumeroProtocolo,
  esquemaProtocoloDetalheResposta,
  type ProtocoloDetalheResposta,
} from "../contracts";
import { normalizarGuia } from "../../domain/normalize";
import type { GuiaBruta } from "../../domain/guide";
import type { Area } from "../../domain/statuses";
import type { CodigoProblema } from "../../domain/validation";

/** Espelha `CODIGOS_REQUISITO_LIBERACAO` de `../contracts` — não exportado como tipo próprio de lá. */
type CodigoRequisitoLiberacao =
  | "VALIDACAO_ATUAL_OK"
  | "SEM_PROBLEMA_ABERTO"
  | "SEM_REVISAO_HUMANA_PENDENTE"
  | "SEM_TAREFA_BLOQUEANTE_ABERTA";

/**
 * GET /api/protocols/:numero — PRD-SDD §12.2/§19. Reconstrói o detalhe inteiro a partir do que
 * já está gravado (Fase 1): nenhuma regra nova é decidida aqui.
 *
 * `diff_json` de `guide_versions` é escrito pelo handler de correção (RF-10,
 * `POST /protocols/:numero/versions`), fora do escopo desta tarefa e implementado em paralelo.
 * `mapearDiff` aceita tanto `{campo, valor_anterior, valor_novo}` (a forma do contrato,
 * `esquemaDiffCampo`) quanto `{campo, antes, depois}` (a forma citada em prosa por
 * `migrations/0001_init.sql`), para não quebrar a leitura se a gravação usar a segunda —
 * incerteza documentada em vez de suposição silenciosa.
 */

interface LinhaProtocolo {
  readonly id: string;
  readonly protocol_number: string;
  readonly source_guide_id: string | null;
  readonly current_version_id: string;
  readonly validation_status: string;
  readonly workflow_status: string;
  readonly assigned_area: string | null;
  readonly current_risk_cents: number;
  readonly initial_risk_cents: number;
  readonly created_at_utc: string;
  readonly updated_at_utc: string;
}

interface LinhaVersao {
  readonly id: string;
  readonly version_number: number;
  readonly raw_payload_json: string;
  readonly normalized_payload_json: string;
  readonly diff_json: string;
  readonly change_reason: string | null;
  readonly created_by_role: string;
  readonly created_by_principal: string;
  readonly occurred_at_utc: string;
  readonly recorded_at_utc: string;
}

interface LinhaExecucaoAtual {
  readonly id: string;
  readonly result_status: string;
  readonly summary: string;
  readonly regra_versao: string;
  readonly regra_sha256: string;
}

interface LinhaProblemaHistorico {
  readonly id: string;
  readonly validation_run_id: string;
  readonly code: string;
  readonly title: string;
  readonly recommended_action: string;
  readonly owner_area: string;
  readonly status: string;
  readonly subproblems_json: string;
  readonly rule_reference_json: string;
  readonly created_at_utc: string;
  readonly resolved_at_utc: string | null;
  readonly version_number: number;
}

interface LinhaTarefa {
  readonly id: string;
  readonly issue_id: string | null;
  readonly assigned_area: string;
  readonly task_type: string;
  readonly title: string;
  readonly status: string;
  readonly blocking: number;
  readonly created_at_utc: string;
  readonly resolved_at_utc: string | null;
}

interface LinhaEvento {
  readonly id: string;
  readonly event_type: string;
  readonly actor_role: string;
  readonly actor_principal: string;
  readonly source: string;
  readonly guide_version_id: string | null;
  readonly reason: string | null;
  readonly metadata_json: string;
  readonly occurred_at_utc: string;
  readonly recorded_at_utc: string;
}

function mapearDiff(bruto: unknown): { campo: string; valor_anterior: string | null; valor_novo: string | null }[] {
  if (!Array.isArray(bruto)) return [];
  return bruto.map((item) => {
    const registro = (item ?? {}) as Record<string, unknown>;
    const campo = String(registro.campo ?? "");
    const anterior = registro.valor_anterior ?? registro.antes ?? null;
    const novo = registro.valor_novo ?? registro.depois ?? null;
    return {
      campo,
      valor_anterior: anterior === null || anterior === undefined ? null : String(anterior),
      valor_novo: novo === null || novo === undefined ? null : String(novo),
    };
  });
}

const DESCRICAO_REQUISITO: Readonly<Record<CodigoRequisitoLiberacao, string>> = {
  VALIDACAO_ATUAL_OK: "A versão atual da guia está com status OK.",
  SEM_PROBLEMA_ABERTO: "Não há problema aberto nesta guia.",
  SEM_REVISAO_HUMANA_PENDENTE: "Não há revisão humana pendente.",
  SEM_TAREFA_BLOQUEANTE_ABERTA: "Não há tarefa bloqueante aberta.",
};

export async function montarDetalheProtocolo(
  db: D1Database,
  numeroProtocoloBruto: string,
): Promise<ProtocoloDetalheResposta> {
  const numeroProtocolo = esquemaNumeroProtocolo.parse(numeroProtocoloBruto);

  const protocolo = await db
    .prepare(`SELECT * FROM protocols WHERE protocol_number = ?`)
    .bind(numeroProtocolo)
    .first<LinhaProtocolo>();
  if (protocolo === null) {
    throw new ErroDominio("PROTOCOLO_NAO_ENCONTRADO", "Protocolo não encontrado.", 404);
  }

  const [versoesResultado, execucaoAtual, problemasResultado, tarefasResultado, eventosResultado] =
    await Promise.all([
      db
        .prepare(`SELECT * FROM guide_versions WHERE protocol_id = ? ORDER BY version_number ASC`)
        .bind(protocolo.id)
        .all<LinhaVersao>(),

      db
        .prepare(
          `SELECT vr.id, vr.result_status, vr.summary, rs.version AS regra_versao, rs.source_sha256 AS regra_sha256
           FROM validation_runs vr
           JOIN rule_sets rs ON rs.id = vr.rule_set_id
           WHERE vr.guide_version_id = ?
           ORDER BY vr.finished_at_utc DESC
           LIMIT 1`,
        )
        .bind(protocolo.current_version_id)
        .first<LinhaExecucaoAtual>(),

      db
        .prepare(
          `SELECT vi.id, vi.validation_run_id, vi.code, vi.title, vi.recommended_action, vi.owner_area, vi.status,
                  vi.subproblems_json, vi.rule_reference_json, vi.created_at_utc, vi.resolved_at_utc,
                  gv.version_number
           FROM validation_issues vi
           JOIN validation_runs vr ON vr.id = vi.validation_run_id
           JOIN guide_versions gv ON gv.id = vr.guide_version_id
           WHERE vr.protocol_id = ?
           ORDER BY vi.created_at_utc DESC`,
        )
        .bind(protocolo.id)
        .all<LinhaProblemaHistorico>(),

      db
        .prepare(`SELECT * FROM tasks WHERE protocol_id = ? ORDER BY created_at_utc DESC`)
        .bind(protocolo.id)
        .all<LinhaTarefa>(),

      db
        .prepare(`SELECT * FROM workflow_events WHERE protocol_id = ? ORDER BY recorded_at_utc DESC, occurred_at_utc DESC`)
        .bind(protocolo.id)
        .all<LinhaEvento>(),
    ]);

  if (execucaoAtual === null) {
    throw new Error(`Protocolo ${numeroProtocolo} não tem execução de validação para a versão atual.`);
  }

  type VersaoWire = ProtocoloDetalheResposta["versoes"][number];

  const versoes = versoesResultado.results.map((versao) => {
    const brutaObjeto = JSON.parse(versao.raw_payload_json) as GuiaBruta;
    const { avisos } = normalizarGuia(brutaObjeto);
    return {
      id: versao.id,
      numero_versao: versao.version_number,
      guia: JSON.parse(versao.normalized_payload_json) as VersaoWire["guia"],
      guia_bruta: brutaObjeto as unknown as VersaoWire["guia_bruta"],
      diff: mapearDiff(JSON.parse(versao.diff_json)),
      avisos_normalizacao: avisos,
      motivo_alteracao: versao.change_reason,
      criado_por_papel: versao.created_by_role as Area,
      criado_por_principal: versao.created_by_principal,
      ocorrido_em_utc: versao.occurred_at_utc,
      registrado_em_utc: versao.recorded_at_utc,
    };
  });

  const versaoAtual = versoesResultado.results.find((v) => v.id === protocolo.current_version_id);
  if (versaoAtual === undefined) {
    throw new Error(`Protocolo ${numeroProtocolo}: current_version_id não corresponde a nenhuma guide_version gravada.`);
  }
  const numeroVersaoAtual = versaoAtual.version_number;

  // Problemas da execução ATUAL (resultado_validacao_atual): exatamente os desta `validation_run`
  // (não "da versão", que poderia reunir mais de uma execução se a versão for revalidada) —
  // reconstrói o `ResultadoValidacao` daquele momento com precisão.
  const problemasDaVersaoAtual = problemasResultado.results.filter(
    (linha) => linha.validation_run_id === execucaoAtual.id,
  );
  const referenciasAtuais = Array.from(
    new Set(
      problemasDaVersaoAtual.map(
        (linha) => (JSON.parse(linha.rule_reference_json) as { referencia_regra: string }).referencia_regra,
      ),
    ),
  );

  const problemas = problemasResultado.results.map((linha) => ({
    id: linha.id,
    codigo: linha.code as CodigoProblema,
    titulo: linha.title,
    acao_recomendada: linha.recommended_action as "CORRIGIR" | "REVISAR" | "NAO_FATURAR",
    area_responsavel: linha.owner_area as "SECRETARIA" | "FINANCEIRO",
    subproblemas: JSON.parse(linha.subproblems_json),
    referencia_regra: (JSON.parse(linha.rule_reference_json) as { referencia_regra: string }).referencia_regra,
    numero_versao_origem: linha.version_number,
    status: linha.status as "ABERTO" | "RESOLVIDO",
    resolvido_em_utc: linha.resolved_at_utc,
  }));

  const tarefas = tarefasResultado.results.map((linha) => ({
    id: linha.id,
    issue_id: linha.issue_id,
    tipo: linha.task_type,
    titulo: linha.title,
    area: linha.assigned_area as Area,
    bloqueante: linha.blocking === 1,
    status: linha.status as "ABERTA" | "RESOLVIDA",
    criada_em_utc: linha.created_at_utc,
    resolvida_em_utc: linha.resolved_at_utc,
  }));

  const eventos = eventosResultado.results.map((linha) => ({
    id: linha.id,
    tipo: linha.event_type as ProtocoloDetalheResposta["eventos"][number]["tipo"],
    ator: linha.actor_principal,
    papel: linha.actor_role as Area,
    origem: linha.source as ProtocoloDetalheResposta["eventos"][number]["origem"],
    guia_versao_id: linha.guide_version_id,
    ocorrido_em_utc: linha.occurred_at_utc,
    registrado_em_utc: linha.recorded_at_utc,
    motivo: linha.reason,
    metadata: JSON.parse(linha.metadata_json),
  }));

  const temProblemaAberto = problemasResultado.results.some((linha) => linha.status === "ABERTO");
  const temRevisaoHumanaPendente = problemasResultado.results.some(
    (linha) => linha.status === "ABERTO" && linha.recommended_action === "REVISAR",
  );
  const temTarefaBloqueanteAberta = tarefasResultado.results.some(
    (linha) => linha.status === "ABERTA" && linha.blocking === 1,
  );
  const validacaoAtualOk = protocolo.validation_status === "OK";

  const codigosRequisito: { codigo: CodigoRequisitoLiberacao; atendido: boolean }[] = [
    { codigo: "VALIDACAO_ATUAL_OK", atendido: validacaoAtualOk },
    { codigo: "SEM_PROBLEMA_ABERTO", atendido: !temProblemaAberto },
    { codigo: "SEM_REVISAO_HUMANA_PENDENTE", atendido: !temRevisaoHumanaPendente },
    { codigo: "SEM_TAREFA_BLOQUEANTE_ABERTA", atendido: !temTarefaBloqueanteAberta },
  ];
  const requisitos = codigosRequisito.map((r) => ({ ...r, descricao: DESCRICAO_REQUISITO[r.codigo] }));
  const podeLiberar = requisitos.every((r) => r.atendido);
  const faltantes = requisitos.filter((r) => !r.atendido);
  const motivo = podeLiberar
    ? null
    : faltantes.length === 1
      ? `Travada: ${DESCRICAO_REQUISITO[faltantes[0].codigo].toLowerCase()}`
      : `Travada: faltam ${faltantes.length} requisitos — ${faltantes.map((f) => DESCRICAO_REQUISITO[f.codigo].toLowerCase()).join("; ")}.`;

  const resposta: ProtocoloDetalheResposta = {
    protocolo: {
      protocolo_id: protocolo.id,
      numero_protocolo: protocolo.protocol_number,
      id_guia_origem: protocolo.source_guide_id,
      status_validacao: protocolo.validation_status as ProtocoloDetalheResposta["protocolo"]["status_validacao"],
      status_fluxo: protocolo.workflow_status as ProtocoloDetalheResposta["protocolo"]["status_fluxo"],
      area_responsavel: protocolo.assigned_area as Area | null,
      risco_atual_cents: protocolo.current_risk_cents,
      risco_inicial_cents: protocolo.initial_risk_cents,
      numero_versao_atual: numeroVersaoAtual,
      criado_em_utc: protocolo.created_at_utc,
      atualizado_em_utc: protocolo.updated_at_utc,
    },
    resultado_validacao_atual: {
      status: execucaoAtual.result_status as ProtocoloDetalheResposta["resultado_validacao_atual"]["status"],
      resumo: execucaoAtual.summary,
      problemas: problemasDaVersaoAtual.map((linha) => ({
        codigo: linha.code as CodigoProblema,
        titulo: linha.title,
        acao_recomendada: linha.recommended_action as "CORRIGIR" | "REVISAR" | "NAO_FATURAR",
        area_responsavel: linha.owner_area as "SECRETARIA" | "FINANCEIRO",
        subproblemas: JSON.parse(linha.subproblems_json),
        referencia_regra: (JSON.parse(linha.rule_reference_json) as { referencia_regra: string }).referencia_regra,
      })),
      risco_cents: protocolo.current_risk_cents,
      regras_aplicadas: {
        versao: execucaoAtual.regra_versao,
        sha256: execucaoAtual.regra_sha256,
        referencias: referenciasAtuais,
      },
    },
    versoes,
    problemas,
    tarefas,
    eventos,
    trava_liberacao: { pode_liberar: podeLiberar, motivo, requisitos },
  };

  return esquemaProtocoloDetalheResposta.parse(resposta);
}

export const manipularDetalheProtocolo: ManipuladorRota = async (ctx) => {
  const resposta = await montarDetalheProtocolo(ctx.env.DB, ctx.params.numero);
  return Response.json(resposta);
};
