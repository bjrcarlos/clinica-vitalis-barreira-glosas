import type { ManipuladorRota } from "../routes";
import { ErroDominio, lerCorpoJson } from "../routes";
import {
  esquemaNumeroProtocolo,
  esquemaDecidirRevisaoEntrada,
  esquemaDecidirRevisaoResposta,
  type DecidirRevisaoResposta,
  type ProblemaHistoricoWire,
} from "../contracts";
import type { ValidacaoStatus } from "../../domain/statuses";
import type { CodigoProblema } from "../../domain/validation";
import type { PapelSessao } from "../../infrastructure/auth/session";
import { criarRepositoriosD1 } from "../../infrastructure/d1/repositories";
import { GeradorIdCrypto } from "../../infrastructure/id";
import { RelogioReal } from "../../infrastructure/clock";
import { buscarResumoWire } from "./create-protocol";

/**
 * POST /api/protocols/:numero/review-decisions — RN-06/RF-12, papel FINANCEIRO. Decide um
 * problema em `REVISAO_HUMANA` pendente (`validation_issues.recommended_action = 'REVISAR'`,
 * `status = 'ABERTO'`) — suposição declarada: só problemas de revisão (não `CORRIGIR`, que se
 * resolve por nova versão em `POST .../versions`, nem `NAO_FATURAR`, que se resolve por
 * `close-private`/`close-cancelled`) podem ser decididos aqui.
 *
 * `CONFIRMAR_PROBLEMA` (concorda com o motor): registra o evento `REVISAO` com a justificativa,
 * mas NÃO fecha o problema — ele continua `ABERTO` e continua bloqueando liberação (documentado
 * em `esquemaDecidirRevisaoEntrada`, `src/http/contracts.ts`).
 *
 * `INVALIDAR_PROBLEMA` (contraria o motor, fecha como falso positivo): exige evidência (RF-12,
 * "contrariar resultado automático quando o fato depender de documento externo"). Suposição
 * declarada, já que `esquemaDecidirRevisaoEntrada` (contrato fixado, fora do escopo desta
 * tarefa) não carrega um `evidence_id` próprio: a regra aplicada aqui é que o protocolo precisa
 * já ter ao menos uma evidência válida (não invalidada) vinculada, anexada antes via
 * `POST .../evidence`. Fecha o problema (`INVALIDADO`) e a(s) tarefa(s) correspondentes, e
 * dispara uma "revalidação" leve — recalcula `protocols.validation_status`/`assigned_area` a
 * partir do que ainda está `ABERTO` para este protocolo (RN-06: `NAO_FATURAR` > `REVISAR` >
 * `CORRIGIR` > `OK`), sem rodar o motor de novo (a guia em si não mudou, só a leitura humana de
 * um problema já apontado).
 */

interface LinhaProtocoloMinima {
  readonly id: string;
}

interface LinhaProblema {
  readonly id: string;
  readonly protocol_id: string;
  readonly code: string;
  readonly title: string;
  readonly recommended_action: string;
  readonly owner_area: string;
  readonly status: string;
  readonly subproblems_json: string;
  readonly rule_reference_json: string;
  readonly resolved_at_utc: string | null;
  readonly version_number: number;
}

interface LinhaTarefaAberta {
  readonly assigned_area: string;
  readonly blocking: number;
}

/** Mesma ordem de precedência de RN-06 / `PRECEDENCIA_VALIDACAO_STATUS` (`domain/statuses.ts`), indexada por ação em vez de por status — só 3 entradas fixas, não vale reimportar a constante para isto. */
function recomputarStatusValidacao(acoesAbertas: ReadonlySet<string>): ValidacaoStatus {
  if (acoesAbertas.has("NAO_FATURAR")) return "NAO_FATURAR_CONVENIO";
  if (acoesAbertas.has("REVISAR")) return "REVISAO_HUMANA";
  if (acoesAbertas.has("CORRIGIR")) return "CORRIGIR";
  return "OK";
}

function paraProblemaHistorico(linha: LinhaProblema): ProblemaHistoricoWire {
  return {
    id: linha.id,
    codigo: linha.code as CodigoProblema,
    titulo: linha.title,
    acao_recomendada: linha.recommended_action as "CORRIGIR" | "REVISAR" | "NAO_FATURAR",
    area_responsavel: linha.owner_area as "SECRETARIA" | "FINANCEIRO",
    subproblemas: JSON.parse(linha.subproblems_json),
    referencia_regra: (JSON.parse(linha.rule_reference_json) as { referencia_regra: string }).referencia_regra,
    numero_versao_origem: linha.version_number,
    status: linha.status as "ABERTO" | "RESOLVIDO" | "INVALIDADO",
    resolvido_em_utc: linha.resolved_at_utc,
  };
}

/** Núcleo testável, sem `Request`/`Response` — mesmo padrão de `release.ts`/`create-version.ts`. */
export async function decidirRevisaoProtocolo(
  db: D1Database,
  papel: PapelSessao,
  numeroProtocoloBruto: string,
  corpoBruto: unknown,
): Promise<DecidirRevisaoResposta> {
  if (papel !== "FINANCEIRO") {
    throw new ErroDominio("ROLE_NOT_ALLOWED", "Somente o Financeiro decide revisões humanas pendentes.");
  }

  const numeroProtocolo = esquemaNumeroProtocolo.parse(numeroProtocoloBruto);
  const entrada = esquemaDecidirRevisaoEntrada.parse(corpoBruto);

  const protocoloLinha = await db
    .prepare(`SELECT id FROM protocols WHERE protocol_number = ?`)
    .bind(numeroProtocolo)
    .first<LinhaProtocoloMinima>();
  if (protocoloLinha === null) {
    throw new ErroDominio("PROTOCOLO_NAO_ENCONTRADO", "Protocolo não encontrado.", 404);
  }

  const problemaLinha = await db
    .prepare(
      `SELECT vi.id, vr.protocol_id, vi.code, vi.title, vi.recommended_action, vi.owner_area, vi.status,
              vi.subproblems_json, vi.rule_reference_json, vi.resolved_at_utc, gv.version_number
       FROM validation_issues vi
       JOIN validation_runs vr ON vr.id = vi.validation_run_id
       JOIN guide_versions gv ON gv.id = vr.guide_version_id
       WHERE vi.id = ?`,
    )
    .bind(entrada.problema_id)
    .first<LinhaProblema>();
  if (problemaLinha === null || problemaLinha.protocol_id !== protocoloLinha.id) {
    throw new ErroDominio("PROBLEMA_NAO_ENCONTRADO", "Problema não encontrado para este protocolo.", 404);
  }
  if (problemaLinha.recommended_action !== "REVISAR") {
    throw new ErroDominio(
      "PROBLEMA_NAO_E_REVISAO_HUMANA",
      "Este problema não é uma revisão humana pendente (a ação recomendada não é revisar).",
      409,
    );
  }
  if (problemaLinha.status !== "ABERTO") {
    throw new ErroDominio("INVALID_STATE_TRANSITION", "Este problema já foi decidido; não está mais pendente.", 409);
  }

  const relogio = new RelogioReal();
  const ids = new GeradorIdCrypto();
  const repos = criarRepositoriosD1(db, ids, relogio);
  const agoraUtc = relogio.agoraUtc();

  let problemaFinal: LinhaProblema = problemaLinha;

  if (entrada.decisao === "INVALIDAR_PROBLEMA") {
    const evidenciaValida = await db
      .prepare(
        `SELECT eo.id FROM evidence_objects eo
         JOIN evidence_links el ON el.evidence_id = eo.id
         WHERE el.protocol_id = ? AND eo.invalidated_at_utc IS NULL
         LIMIT 1`,
      )
      .bind(protocoloLinha.id)
      .first<{ id: string }>();
    if (evidenciaValida === null) {
      throw new ErroDominio(
        "EVIDENCE_REQUIRED",
        "Invalidar um problema contraria o resultado automático e exige evidência (RF-12): anexe um comprovante (PDF, JPEG ou PNG) a este protocolo em POST /api/protocols/:numero/evidence antes de decidir.",
      );
    }

    await db.batch([
      db
        .prepare(`UPDATE validation_issues SET status = 'INVALIDADO', resolved_at_utc = ? WHERE id = ?`)
        .bind(agoraUtc, problemaLinha.id),
      db
        .prepare(`UPDATE tasks SET status = 'RESOLVIDA', resolved_at_utc = ? WHERE issue_id = ? AND status = 'ABERTA'`)
        .bind(agoraUtc, problemaLinha.id),
    ]);

    const acoesAbertasResultado = await db
      .prepare(
        `SELECT DISTINCT vi.recommended_action AS acao
         FROM validation_issues vi
         JOIN validation_runs vr ON vr.id = vi.validation_run_id
         WHERE vr.protocol_id = ? AND vi.status = 'ABERTO'`,
      )
      .bind(protocoloLinha.id)
      .all<{ acao: string }>();
    const novoStatusValidacao = recomputarStatusValidacao(
      new Set(acoesAbertasResultado.results.map((linha) => linha.acao)),
    );

    const tarefasAbertasResultado = await db
      .prepare(
        `SELECT assigned_area, blocking FROM tasks WHERE protocol_id = ? AND status = 'ABERTA' ORDER BY created_at_utc ASC`,
      )
      .bind(protocoloLinha.id)
      .all<LinhaTarefaAberta>();
    const tarefaBloqueante = tarefasAbertasResultado.results.find((tarefa) => tarefa.blocking === 1);
    const novaAreaResponsavel = (tarefaBloqueante ?? tarefasAbertasResultado.results[0])?.assigned_area ?? null;

    await db
      .prepare(
        `UPDATE protocols
            SET validation_status = ?,
                assigned_area = ?,
                current_risk_cents = CASE WHEN ? = 'OK' THEN 0 ELSE current_risk_cents END,
                updated_at_utc = ?
          WHERE id = ?`,
      )
      .bind(novoStatusValidacao, novaAreaResponsavel, novoStatusValidacao, agoraUtc, protocoloLinha.id)
      .run();

    problemaFinal = { ...problemaLinha, status: "INVALIDADO", resolved_at_utc: agoraUtc };
  }

  await repos.eventos.registrar({
    protocoloId: protocoloLinha.id,
    guiaVersaoId: null,
    evento: {
      tipo: "REVISAO",
      ator: "financeiro@vitalis",
      papel: "FINANCEIRO",
      origem: "UI",
      ocorrido_em_utc: agoraUtc,
      registrado_em_utc: agoraUtc,
      motivo: entrada.motivo,
      metadata: {
        numero_protocolo: numeroProtocolo,
        problema_id: entrada.problema_id,
        decisao: entrada.decisao,
        codigo: problemaLinha.code,
      },
    },
  });

  const protocoloWire = await buscarResumoWire(db, numeroProtocolo);
  return esquemaDecidirRevisaoResposta.parse({
    protocolo: protocoloWire,
    problema: paraProblemaHistorico(problemaFinal),
  });
}

export const manipularDecidirRevisao: ManipuladorRota = async (ctx) => {
  const corpoBruto = await lerCorpoJson(ctx.request);
  const corpo = await decidirRevisaoProtocolo(ctx.env.DB, ctx.papel, ctx.params.numero, corpoBruto);
  return Response.json(corpo);
};
