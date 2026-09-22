import type { ManipuladorRota } from "../routes";
import { ErroDominio, lerCorpoJson } from "../routes";
import {
  esquemaNumeroProtocolo,
  esquemaRegistrarEnvioEntrada,
  esquemaRegistrarEnvioResposta,
  type RegistrarEnvioResposta,
  type EnvioWire,
} from "../contracts";
import type { FluxoStatus } from "../../domain/statuses";
import type { PapelSessao } from "../../infrastructure/auth/session";
import { criarRepositoriosD1 } from "../../infrastructure/d1/repositories";
import { GeradorIdCrypto } from "../../infrastructure/id";
import { RelogioReal } from "../../infrastructure/clock";
import { buscarResumoWire } from "./create-protocol";

/**
 * POST /api/protocols/:numero/send — RF-09/RN-04, papel FINANCEIRO. Liberar não é enviar: só
 * aceita registrar o envio quando o protocolo está `LIBERADA_PARA_ENVIO`, `ocorrido_em_utc` (a
 * data em que o envio de fato ocorreu — pode ser retroativa, nunca no futuro) é informado, e
 * existe uma evidência VÁLIDA (não invalidada) já vinculada a este protocolo. Sem evidência,
 * recusa com `EVIDENCE_REQUIRED` explicando o que anexar (RF-12). O evento grava
 * `ocorrido_em_utc`/`registrado_em_utc` separados (RF-11) — a interface mostra os dois quando
 * divergem. Enviar duas vezes o mesmo protocolo é recusado com `INVALID_STATE_TRANSITION` (o
 * protocolo já não está mais `LIBERADA_PARA_ENVIO` depois do primeiro envio).
 *
 * O vínculo evidência↔protocolo em si (`evidence_links`) é criado por
 * `POST /api/protocols/:numero/evidence` (outro handler desta mesma fase, escrito em paralelo);
 * este handler só CONFERE que um vínculo válido já existe e acrescenta um segundo vínculo com
 * `relation_type = 'envio'` apontando para o evento de envio recém-criado — a chave composta de
 * `evidence_links` inclui `relation_type`, então isso nunca colide com o vínculo original.
 */

interface LinhaProtocoloMinima {
  readonly id: string;
  readonly workflow_status: string;
  readonly current_version_id: string;
}

interface LinhaEvidenciaValida {
  readonly id: string;
}

/** Núcleo testável, sem `Request`/`Response` — mesmo padrão de `release.ts`/`create-version.ts`. */
export async function registrarEnvioProtocolo(
  db: D1Database,
  papel: PapelSessao,
  numeroProtocoloBruto: string,
  corpoBruto: unknown,
): Promise<RegistrarEnvioResposta> {
  if (papel !== "FINANCEIRO") {
    throw new ErroDominio("ROLE_NOT_ALLOWED", "Somente o Financeiro pode registrar o envio ao convênio.");
  }

  const numeroProtocolo = esquemaNumeroProtocolo.parse(numeroProtocoloBruto);
  const entrada = esquemaRegistrarEnvioEntrada.parse(corpoBruto);

  const relogio = new RelogioReal();
  const ids = new GeradorIdCrypto();
  const repos = criarRepositoriosD1(db, ids, relogio);
  const agoraUtc = relogio.agoraUtc();

  if (Date.parse(entrada.ocorrido_em_utc) > Date.parse(agoraUtc)) {
    throw new ErroDominio("VALIDATION_ERROR", "Data do envio (ocorrido_em_utc) não pode estar no futuro.", 422);
  }

  const protocoloLinha = await db
    .prepare(`SELECT id, workflow_status, current_version_id FROM protocols WHERE protocol_number = ?`)
    .bind(numeroProtocolo)
    .first<LinhaProtocoloMinima>();
  if (protocoloLinha === null) {
    throw new ErroDominio("PROTOCOLO_NAO_ENCONTRADO", "Protocolo não encontrado.", 404);
  }

  const fluxoAtual = protocoloLinha.workflow_status as FluxoStatus;
  if (fluxoAtual !== "LIBERADA_PARA_ENVIO") {
    throw new ErroDominio(
      "INVALID_STATE_TRANSITION",
      fluxoAtual === "ENVIADA"
        ? "Este protocolo já foi enviado ao convênio; o envio não pode ser registrado duas vezes."
        : "Protocolo precisa estar liberado para envio (RF-09) antes de registrar o envio.",
      409,
    );
  }

  const evidenciaValida = await db
    .prepare(
      `SELECT eo.id
       FROM evidence_objects eo
       JOIN evidence_links el ON el.evidence_id = eo.id
       WHERE eo.id = ? AND el.protocol_id = ? AND eo.invalidated_at_utc IS NULL
       LIMIT 1`,
    )
    .bind(entrada.evidence_id, protocoloLinha.id)
    .first<LinhaEvidenciaValida>();
  if (evidenciaValida === null) {
    throw new ErroDominio(
      "EVIDENCE_REQUIRED",
      "Envio exige uma evidência válida (PDF, JPEG ou PNG) já anexada a este protocolo — use POST /api/protocols/:numero/evidence para anexar o comprovante antes de registrar o envio.",
    );
  }

  await db
    .prepare(`UPDATE protocols SET workflow_status = 'ENVIADA', updated_at_utc = ? WHERE id = ?`)
    .bind(agoraUtc, protocoloLinha.id)
    .run();

  const eventoId = await repos.eventos.registrar({
    protocoloId: protocoloLinha.id,
    guiaVersaoId: protocoloLinha.current_version_id,
    evento: {
      tipo: "ENVIO",
      ator: "financeiro@vitalis",
      papel: "FINANCEIRO",
      origem: "UI",
      ocorrido_em_utc: entrada.ocorrido_em_utc,
      registrado_em_utc: agoraUtc,
      motivo: null,
      metadata: { numero_protocolo: numeroProtocolo, evidence_id: entrada.evidence_id },
    },
  });

  await db
    .prepare(
      `INSERT INTO evidence_links (evidence_id, protocol_id, event_id, guide_version_id, relation_type, origin_protocol_id)
       VALUES (?, ?, ?, ?, 'envio', ?)`,
    )
    .bind(entrada.evidence_id, protocoloLinha.id, eventoId, protocoloLinha.current_version_id, protocoloLinha.id)
    .run();

  const protocoloWire = await buscarResumoWire(db, numeroProtocolo);
  const envio: EnvioWire = {
    ocorrido_em_utc: entrada.ocorrido_em_utc,
    registrado_em_utc: agoraUtc,
    evidence_id: entrada.evidence_id,
    registrado_por_principal: "financeiro@vitalis",
  };

  return esquemaRegistrarEnvioResposta.parse({ protocolo: protocoloWire, envio });
}

export const manipularRegistrarEnvio: ManipuladorRota = async (ctx) => {
  const corpoBruto = await lerCorpoJson(ctx.request);
  const corpo = await registrarEnvioProtocolo(ctx.env.DB, ctx.papel, ctx.params.numero, corpoBruto);
  return Response.json(corpo);
};
