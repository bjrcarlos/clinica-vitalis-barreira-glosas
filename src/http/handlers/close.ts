import type { ManipuladorRota } from "../routes";
import { ErroDominio, lerCorpoJson } from "../routes";
import {
  esquemaNumeroProtocolo,
  esquemaEncerrarProtocoloEntrada,
  esquemaEncerrarProtocoloResposta,
  type EncerrarProtocoloResposta,
} from "../contracts";
import type { FluxoStatus } from "../../domain/statuses";
import type { PapelSessao } from "../../infrastructure/auth/session";
import { criarRepositoriosD1 } from "../../infrastructure/d1/repositories";
import { GeradorIdCrypto } from "../../infrastructure/id";
import { RelogioReal } from "../../infrastructure/clock";
import { buscarResumoWire } from "./create-protocol";

/**
 * POST /api/protocols/:numero/close-private e POST /api/protocols/:numero/close-cancelled —
 * RN-07, papel FINANCEIRO. Mesmo corpo (`motivo` por extenso, `esquemaEncerrarProtocoloEntrada`
 * já rejeita vazio/só-espaço via `.trim().min(1)`); a rota chamada decide o destino
 * (`ENCERRADA_PARTICULAR` ou `ENCERRADA_CANCELADA`).
 *
 * Encerramento só a partir de estado coerente — suposição declarada (o contrato fixado pelo
 * orquestrador não lista os estados de origem permitidos): `EM_TRATAMENTO` ou
 * `LIBERADA_PARA_ENVIO`. Uma guia já `ENVIADA` não pode ser encerrada como particular nem como
 * cancelada por esta rota (o envio já é um fato consumado com o convênio; reverter isso é fora
 * do escopo desta fase), e `ENCERRADA_*`/`MESCLADA` não podem ser encerradas de novo.
 *
 * Ao encerrar: fecha (RESOLVIDO/RESOLVIDA) todo problema e tarefa ainda `ABERTO`/`ABERTA` deste
 * protocolo — o fluxo terminou, nada continua pendente para nenhuma área — e limpa
 * `assigned_area` (mesmo motivo: ninguém mais precisa agir). É isto que tira o protocolo do
 * risco pendente e o move para tratado no relatório (`GET /api/report`, PRD §27.4): a métrica
 * `risco_pendente_cents` já filtra por `workflow_status = 'EM_TRATAMENTO'` e `risco_tratado_cents`
 * já inclui `ENCERRADA_PARTICULAR`/`ENCERRADA_CANCELADA` (`src/http/handlers/report.ts`,
 * conferido nesta tarefa — já reflete a mudança de estado corretamente, nenhuma linha alterada
 * lá). `current_risk_cents`/`initial_risk_cents` não são zerados: continuam sendo o registro
 * histórico do valor que esteve em risco, igual ao que já acontece com `LIBERADA_PARA_ENVIO`/
 * `ENVIADA`.
 */

const ESTADOS_ENCERRAVEIS: readonly FluxoStatus[] = ["EM_TRATAMENTO", "LIBERADA_PARA_ENVIO"];

type DestinoEncerramento = Extract<FluxoStatus, "ENCERRADA_PARTICULAR" | "ENCERRADA_CANCELADA">;

interface LinhaProtocoloMinima {
  readonly id: string;
  readonly workflow_status: string;
  readonly current_version_id: string;
}

async function encerrarProtocoloComoDestino(
  db: D1Database,
  papel: PapelSessao,
  numeroProtocoloBruto: string,
  corpoBruto: unknown,
  destino: DestinoEncerramento,
): Promise<EncerrarProtocoloResposta> {
  if (papel !== "FINANCEIRO") {
    throw new ErroDominio("ROLE_NOT_ALLOWED", "Somente o Financeiro pode encerrar guias.");
  }

  const numeroProtocolo = esquemaNumeroProtocolo.parse(numeroProtocoloBruto);
  const entrada = esquemaEncerrarProtocoloEntrada.parse(corpoBruto);

  const protocoloLinha = await db
    .prepare(`SELECT id, workflow_status, current_version_id FROM protocols WHERE protocol_number = ?`)
    .bind(numeroProtocolo)
    .first<LinhaProtocoloMinima>();
  if (protocoloLinha === null) {
    throw new ErroDominio("PROTOCOLO_NAO_ENCONTRADO", "Protocolo não encontrado.", 404);
  }

  const fluxoAtual = protocoloLinha.workflow_status as FluxoStatus;
  if (!ESTADOS_ENCERRAVEIS.includes(fluxoAtual)) {
    throw new ErroDominio(
      "INVALID_STATE_TRANSITION",
      fluxoAtual === "ENVIADA"
        ? "Guia já enviada ao convênio não pode ser encerrada por esta rota."
        : "Protocolo não pode ser encerrado neste estado de fluxo.",
      409,
    );
  }

  const relogio = new RelogioReal();
  const ids = new GeradorIdCrypto();
  const repos = criarRepositoriosD1(db, ids, relogio);
  const agoraUtc = relogio.agoraUtc();

  await db.batch([
    db
      .prepare(`UPDATE protocols SET workflow_status = ?, assigned_area = NULL, updated_at_utc = ? WHERE id = ?`)
      .bind(destino, agoraUtc, protocoloLinha.id),
    db
      .prepare(
        `UPDATE validation_issues
         SET status = 'RESOLVIDO', resolved_at_utc = ?
         WHERE status = 'ABERTO'
           AND validation_run_id IN (SELECT id FROM validation_runs WHERE protocol_id = ?)`,
      )
      .bind(agoraUtc, protocoloLinha.id),
    db
      .prepare(`UPDATE tasks SET status = 'RESOLVIDA', resolved_at_utc = ? WHERE status = 'ABERTA' AND protocol_id = ?`)
      .bind(agoraUtc, protocoloLinha.id),
  ]);

  await repos.eventos.registrar({
    protocoloId: protocoloLinha.id,
    guiaVersaoId: protocoloLinha.current_version_id,
    evento: {
      tipo: "ENCERRAMENTO",
      ator: "financeiro@vitalis",
      papel: "FINANCEIRO",
      origem: "UI",
      ocorrido_em_utc: agoraUtc,
      registrado_em_utc: agoraUtc,
      motivo: entrada.motivo,
      metadata: { numero_protocolo: numeroProtocolo, destino },
    },
  });

  const protocoloWire = await buscarResumoWire(db, numeroProtocolo);
  return esquemaEncerrarProtocoloResposta.parse({ protocolo: protocoloWire });
}

/** Núcleo testável de `POST .../close-private`, sem `Request`/`Response`. */
export async function encerrarProtocoloParticular(
  db: D1Database,
  papel: PapelSessao,
  numeroProtocoloBruto: string,
  corpoBruto: unknown,
): Promise<EncerrarProtocoloResposta> {
  return encerrarProtocoloComoDestino(db, papel, numeroProtocoloBruto, corpoBruto, "ENCERRADA_PARTICULAR");
}

/** Núcleo testável de `POST .../close-cancelled`, sem `Request`/`Response`. */
export async function encerrarProtocoloCancelado(
  db: D1Database,
  papel: PapelSessao,
  numeroProtocoloBruto: string,
  corpoBruto: unknown,
): Promise<EncerrarProtocoloResposta> {
  return encerrarProtocoloComoDestino(db, papel, numeroProtocoloBruto, corpoBruto, "ENCERRADA_CANCELADA");
}

export const manipularEncerrarParticular: ManipuladorRota = async (ctx) => {
  const corpoBruto = await lerCorpoJson(ctx.request);
  const corpo = await encerrarProtocoloParticular(ctx.env.DB, ctx.papel, ctx.params.numero, corpoBruto);
  return Response.json(corpo);
};

export const manipularEncerrarCancelado: ManipuladorRota = async (ctx) => {
  const corpoBruto = await lerCorpoJson(ctx.request);
  const corpo = await encerrarProtocoloCancelado(ctx.env.DB, ctx.papel, ctx.params.numero, corpoBruto);
  return Response.json(corpo);
};
