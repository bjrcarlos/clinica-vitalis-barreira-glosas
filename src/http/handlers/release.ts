import type { ManipuladorRota } from "../routes";
import { ErroDominio } from "../routes";
import {
  esquemaNumeroProtocolo,
  esquemaLiberarProtocoloEntrada,
  esquemaLiberarProtocoloResposta,
  type LiberarProtocoloResposta,
} from "../contracts";
import type { FluxoStatus } from "../../domain/statuses";
import type { PapelSessao } from "../../infrastructure/auth/session";
import { criarRepositoriosD1 } from "../../infrastructure/d1/repositories";
import { GeradorIdCrypto } from "../../infrastructure/id";
import { RelogioReal } from "../../infrastructure/clock";
import { buscarResumoWire } from "./create-protocol";

/**
 * POST /api/protocols/:numero/release — RF-09, papel FINANCEIRO. Recalcula a trava de
 * liberação NO SERVIDOR (a interface nunca decide isso sozinha, CLAUDE.md) e só muda
 * `workflow_status` para `LIBERADA_PARA_ENVIO` quando os quatro requisitos estão satisfeitos.
 * Liberar não é enviar — nenhum código de envio é tocado aqui.
 *
 * Mesma semântica de "problema aberto"/"revisão humana pendente"/"tarefa bloqueante aberta"
 * usada por `src/http/handlers/protocol-detail.ts` (GET .../:numero, `trava_liberacao`):
 * problemas e tarefas são contados por PROTOCOLO (todas as execuções de validação já
 * gravadas), não só pela execução da versão atual — depois de uma correção
 * (`POST .../versions`), os antigos já foram marcados `RESOLVIDO`/`RESOLVIDA` por aquele
 * handler, então só o que ainda está genuinamente aberto conta aqui. Mantenha os dois cálculos
 * em sincronia se um dia mudar.
 */

interface LinhaProtocoloMinima {
  readonly id: string;
  readonly workflow_status: string;
  readonly validation_status: string;
  readonly current_version_id: string;
}

interface LinhaIssueAberta {
  readonly recommended_action: string;
}

const DESCRICAO_FALTA: Readonly<Record<"OK" | "PROBLEMA" | "REVISAO" | "TAREFA", string>> = {
  OK: "a versão atual não está com status OK",
  PROBLEMA: "há problema aberto nesta guia",
  REVISAO: "há revisão humana pendente",
  TAREFA: "há tarefa bloqueante aberta",
};

/** Núcleo testável, sem `Request`/`Response`. */
export async function liberarProtocolo(
  db: D1Database,
  papel: PapelSessao,
  numeroProtocoloBruto: string,
  corpoTexto: string,
): Promise<LiberarProtocoloResposta> {
  if (papel !== "FINANCEIRO") {
    throw new ErroDominio("ROLE_NOT_ALLOWED", "Somente o Financeiro pode liberar guias para envio.");
  }

  const numeroProtocolo = esquemaNumeroProtocolo.parse(numeroProtocoloBruto);
  // Corpo vazio por contrato (`esquemaLiberarProtocoloEntrada` é `z.object({}).strict()`) —
  // aceita ausência de corpo (texto vazio) sem lançar em `JSON.parse`. Corpo não vazio mas
  // malformado (`SyntaxError`) vira erro de validação estável, nunca o 500 genérico do
  // catch-all (auditoria, item 4: "todas as entradas passam por Zod?").
  let corpoParseado: unknown = {};
  if (corpoTexto.trim() !== "") {
    try {
      corpoParseado = JSON.parse(corpoTexto);
    } catch {
      throw new ErroDominio("VALIDATION_ERROR", "Corpo da requisição não é JSON válido.", 422);
    }
  }
  esquemaLiberarProtocoloEntrada.parse(corpoParseado);

  const ids = new GeradorIdCrypto();
  const relogio = new RelogioReal();
  const repos = criarRepositoriosD1(db, ids, relogio);

  const protocoloLinha = await db
    .prepare(`SELECT id, workflow_status, validation_status, current_version_id FROM protocols WHERE protocol_number = ?`)
    .bind(numeroProtocolo)
    .first<LinhaProtocoloMinima>();
  if (protocoloLinha === null) {
    throw new ErroDominio("PROTOCOLO_NAO_ENCONTRADO", "Protocolo não encontrado.", 404);
  }

  const fluxoAtual = protocoloLinha.workflow_status as FluxoStatus;
  if (fluxoAtual !== "EM_TRATAMENTO") {
    throw new ErroDominio(
      "INVALID_STATE_TRANSITION",
      "Protocolo não está em tratamento; liberação não se aplica neste estado.",
      409,
    );
  }

  const issuesAbertas = await db
    .prepare(
      `SELECT vi.recommended_action
       FROM validation_issues vi
       JOIN validation_runs vr ON vr.id = vi.validation_run_id
       WHERE vr.protocol_id = ? AND vi.status = 'ABERTO'`,
    )
    .bind(protocoloLinha.id)
    .all<LinhaIssueAberta>();

  const tarefasBloqueantesLinha = await db
    .prepare(`SELECT COUNT(*) AS n FROM tasks WHERE protocol_id = ? AND status = 'ABERTA' AND blocking = 1`)
    .bind(protocoloLinha.id)
    .first<{ n: number }>();

  const validacaoAtualOk = protocoloLinha.validation_status === "OK";
  const semProblemaAberto = issuesAbertas.results.length === 0;
  const semRevisaoHumanaPendente = !issuesAbertas.results.some((linha) => linha.recommended_action === "REVISAR");
  const semTarefaBloqueanteAberta = (tarefasBloqueantesLinha?.n ?? 0) === 0;

  const podeLiberar = validacaoAtualOk && semProblemaAberto && semRevisaoHumanaPendente && semTarefaBloqueanteAberta;

  if (!podeLiberar) {
    const faltas: string[] = [];
    if (!validacaoAtualOk) faltas.push(DESCRICAO_FALTA.OK);
    if (!semProblemaAberto) faltas.push(DESCRICAO_FALTA.PROBLEMA);
    if (!semRevisaoHumanaPendente) faltas.push(DESCRICAO_FALTA.REVISAO);
    if (!semTarefaBloqueanteAberta) faltas.push(DESCRICAO_FALTA.TAREFA);

    // OPEN_BLOCKING_TASKS quando a causa (ou uma delas) é tarefa bloqueante aberta; caso
    // contrário GUIDE_NOT_READY cobre os demais motivos (validação não-OK, problema aberto,
    // revisão humana pendente) — códigos estáveis fixados pelo CLAUDE.md, escolha entre os
    // dois é desta tarefa.
    const codigo = !semTarefaBloqueanteAberta ? "OPEN_BLOCKING_TASKS" : "GUIDE_NOT_READY";
    throw new ErroDominio(codigo, `Não é possível liberar: ${faltas.join("; ")}.`);
  }

  const agoraUtc = relogio.agoraUtc();

  await db
    .prepare(`UPDATE protocols SET workflow_status = 'LIBERADA_PARA_ENVIO', updated_at_utc = ? WHERE id = ?`)
    .bind(agoraUtc, protocoloLinha.id)
    .run();

  await repos.eventos.registrar({
    protocoloId: protocoloLinha.id,
    guiaVersaoId: protocoloLinha.current_version_id,
    evento: {
      tipo: "LIBERACAO",
      ator: "financeiro@vitalis",
      papel: "FINANCEIRO",
      origem: "UI",
      ocorrido_em_utc: agoraUtc,
      registrado_em_utc: agoraUtc,
      motivo: null,
      metadata: { numero_protocolo: numeroProtocolo },
    },
  });

  const protocoloWire = await buscarResumoWire(db, numeroProtocolo);
  return esquemaLiberarProtocoloResposta.parse({ protocolo: protocoloWire });
}

export const manipularLiberacaoProtocolo: ManipuladorRota = async (ctx) => {
  const textoCorpo = await ctx.request.text();
  const corpo = await liberarProtocolo(ctx.env.DB, ctx.papel, ctx.params.numero, textoCorpo);
  return Response.json(corpo);
};
