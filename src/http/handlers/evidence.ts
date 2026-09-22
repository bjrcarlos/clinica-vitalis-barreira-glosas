import type { ManipuladorRota } from "../routes";
import { ErroDominio, lerCorpoJson } from "../routes";
import {
  esquemaAnexarEvidenciaResposta,
  esquemaInvalidarEvidenciaEntrada,
  esquemaInvalidarEvidenciaResposta,
  esquemaNumeroProtocolo,
  type EvidenciaWire,
} from "../contracts";
import { GeradorIdCrypto } from "../../infrastructure/id";
import { RelogioReal } from "../../infrastructure/clock";
import { criarRepositoriosD1 } from "../../infrastructure/d1/repositories";
import { guardarEvidencia, recuperarEvidencia, EvidenciaRejeitadaError } from "../../infrastructure/r2/evidence-store";
import { assinarLink, verificarLink } from "../../infrastructure/signing/links";
import type { PapelSessao } from "../../infrastructure/auth/session";

const PAPEIS_EVIDENCIA: ReadonlySet<PapelSessao> = new Set(["SECRETARIA", "FINANCEIRO"]);

interface LinhaProtocolo {
  readonly id: string;
  readonly current_version_id: string;
}

interface LinhaEvidencia {
  readonly id: string;
  readonly r2_key: string;
  readonly original_filename: string;
  readonly content_type: string;
  readonly size_bytes: number;
  readonly sha256: string;
  readonly uploaded_by_role: string;
  readonly uploaded_by_principal: string;
  readonly uploaded_at_utc: string;
  readonly invalidated_at_utc: string | null;
  readonly invalidation_reason: string | null;
}

function principalDoPapel(papel: PapelSessao): string {
  if (papel === "SECRETARIA") return "secretaria@vitalis";
  if (papel === "FINANCEIRO") return "financeiro@vitalis";
  return "direcao@vitalis";
}

function paraWire(linha: LinhaEvidencia): EvidenciaWire {
  return {
    id: linha.id,
    nome_exibicao: linha.original_filename,
    tipo_mime: linha.content_type as EvidenciaWire["tipo_mime"],
    tamanho_bytes: linha.size_bytes,
    sha256: linha.sha256,
    anexado_por_papel: linha.uploaded_by_role as EvidenciaWire["anexado_por_papel"],
    anexado_por_principal: linha.uploaded_by_principal,
    anexado_em_utc: linha.uploaded_at_utc,
    invalidada_em_utc: linha.invalidated_at_utc,
    motivo_invalidacao: linha.invalidation_reason,
  };
}

async function buscarProtocolo(db: D1Database, numero: string): Promise<LinhaProtocolo> {
  const protocolo = await db
    .prepare(`SELECT id, current_version_id FROM protocols WHERE protocol_number = ?`)
    .bind(esquemaNumeroProtocolo.parse(numero))
    .first<LinhaProtocolo>();
  if (protocolo === null) throw new ErroDominio("PROTOCOLO_NAO_ENCONTRADO", "Protocolo não encontrado.", 404);
  return protocolo;
}

async function buscarEvidencia(db: D1Database, id: string): Promise<LinhaEvidencia> {
  const evidencia = await db.prepare(`SELECT * FROM evidence_objects WHERE id = ?`).bind(id).first<LinhaEvidencia>();
  if (evidencia === null) throw new ErroDominio("EVIDENCE_NOT_FOUND", "Evidência não encontrada.", 404);
  return evidencia;
}

function traduzirRejeicao(erro: EvidenciaRejeitadaError): ErroDominio {
  return new ErroDominio(erro.codigo, erro.message, 422);
}

export async function anexarEvidencia(
  db: D1Database,
  bucket: EnvEvidenceBucket,
  papel: PapelSessao,
  numeroBruto: string,
  request: Request,
): Promise<ReturnType<typeof esquemaAnexarEvidenciaResposta.parse>> {
  if (!PAPEIS_EVIDENCIA.has(papel)) throw new ErroDominio("ROLE_NOT_ALLOWED", "Somente Secretaria ou Financeiro podem anexar evidências.");
  const protocolo = await buscarProtocolo(db, numeroBruto);
  const form = await request.formData();
  const arquivo = form.get("arquivo");
  if (!(arquivo instanceof File)) throw new ErroDominio("VALIDATION_ERROR", "O campo arquivo é obrigatório.", 422);

  const agora = new RelogioReal().agoraUtc();
  const ids = new GeradorIdCrypto();
  const eventoId = ids.novo();
  const ocorrido = typeof form.get("ocorrido_em_utc") === "string" ? String(form.get("ocorrido_em_utc")) : agora;
  if (Number.isNaN(Date.parse(ocorrido)) || Date.parse(ocorrido) > Date.parse(agora)) {
    throw new ErroDominio("VALIDATION_ERROR", "A data do fato deve ser um instante UTC válido e não pode estar no futuro.", 422);
  }

  let armazenada;
  try {
    armazenada = await guardarEvidencia(bucket, {
      protocoloId: protocolo.id,
      eventoId,
      nomeArquivoOriginal: arquivo.name,
      contentType: arquivo.type,
      tamanhoDeclaradoBytes: arquivo.size,
      conteudo: arquivo.stream() as ReadableStream<Uint8Array>,
    }, ids);
  } catch (erro) {
    if (erro instanceof EvidenciaRejeitadaError) throw traduzirRejeicao(erro);
    throw erro;
  }

  const evidenciaId = ids.novo();
  try {
    await db.batch([
      db.prepare(`INSERT INTO workflow_events (
        id, protocol_id, guide_version_id, event_type, actor_role, actor_principal, source, reason,
        metadata_json, occurred_at_utc, recorded_at_utc
      ) VALUES (?, ?, ?, 'REVISAO', ?, ?, 'UI', ?, ?, ?, ?)`)
        .bind(eventoId, protocolo.id, protocolo.current_version_id, papel === "DIRECAO" ? "SISTEMA" : papel,
          principalDoPapel(papel), "Evidência anexada", JSON.stringify({ evidencia_id: evidenciaId, r2_key: armazenada.chave }), ocorrido, agora),
      db.prepare(`INSERT INTO evidence_objects (
        id, r2_key, original_filename, content_type, size_bytes, sha256, uploaded_by_role,
        uploaded_by_principal, uploaded_at_utc, invalidated_at_utc, invalidation_reason
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)`)
        .bind(evidenciaId, armazenada.chave, armazenada.nomeArquivoSanitizado, armazenada.contentType,
          armazenada.tamanhoBytes, armazenada.sha256, papel === "DIRECAO" ? "SISTEMA" : papel,
          principalDoPapel(papel), agora),
      db.prepare(`INSERT INTO evidence_links (
        evidence_id, protocol_id, event_id, guide_version_id, relation_type, origin_protocol_id
      ) VALUES (?, ?, ?, ?, 'anexo', ?)`)
        .bind(evidenciaId, protocolo.id, eventoId, protocolo.current_version_id, protocolo.id),
    ]);
  } catch (erro) {
    await bucket.delete(armazenada.chave);
    throw erro;
  }

  const linha = await buscarEvidencia(db, evidenciaId);
  return esquemaAnexarEvidenciaResposta.parse({ evidencia: paraWire(linha) });
}

export const manipularAnexarEvidencia: ManipuladorRota = async (ctx) => {
  const corpo = await anexarEvidencia(ctx.env.DB, ctx.env.EVIDENCE as EnvEvidenceBucket, ctx.papel, ctx.params.numero, ctx.request);
  return Response.json(corpo, { status: 201 });
};

export const manipularBaixarEvidencia: ManipuladorRota = async (ctx) => {
  const evidencia = await buscarEvidencia(ctx.env.DB, ctx.params.id);
  const token = ctx.url.searchParams.get("token");
  if (token === null) {
    if (!ctx.env.LINK_SIGNING_KEY) throw new ErroDominio("LINK_CONFIG_MISSING", "Links temporários não estão configurados.", 503);
    const link = await assinarLink({ finalidade: "evidence", recursoId: evidencia.id }, ctx.env.LINK_SIGNING_KEY, new Date().toISOString(), new GeradorIdCrypto());
    return Response.json({ url: `${ctx.url.origin}/api/evidence/${encodeURIComponent(evidencia.id)}?token=${encodeURIComponent(link.token)}`, expira_em_utc: link.payload.expiraEmUtc });
  }
  if (!ctx.env.LINK_SIGNING_KEY || await verificarLink(token, ctx.env.LINK_SIGNING_KEY, new Date().toISOString(), { finalidadeEsperada: "evidence", recursoIdEsperado: evidencia.id }) === null) {
    throw new ErroDominio("LINK_INVALIDO", "Link de evidência inválido ou expirado.", 403);
  }
  const objeto = await recuperarEvidencia(ctx.env.EVIDENCE as EnvEvidenceBucket, evidencia.r2_key);
  if (objeto === null) throw new ErroDominio("EVIDENCE_NOT_FOUND", "Arquivo de evidência não encontrado no armazenamento.", 404);
  return new Response(objeto.conteudo, {
    headers: {
      "Content-Type": objeto.contentType ?? evidencia.content_type,
      "Content-Disposition": `attachment; filename="${evidencia.original_filename.replace(/[^a-zA-Z0-9._ -]/g, "_")}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
};

export const manipularInvalidarEvidencia: ManipuladorRota = async (ctx) => {
  if (!PAPEIS_EVIDENCIA.has(ctx.papel)) throw new ErroDominio("ROLE_NOT_ALLOWED", "Somente Secretaria ou Financeiro podem invalidar evidências.");
  const entrada = esquemaInvalidarEvidenciaEntrada.parse(await lerCorpoJson(ctx.request));
  const evidencia = await buscarEvidencia(ctx.env.DB, ctx.params.id);
  if (evidencia.invalidated_at_utc !== null) throw new ErroDominio("INVALID_STATE_TRANSITION", "A evidência já está invalidada.", 409);
  const agora = new RelogioReal().agoraUtc();
  const resultado = await ctx.env.DB.prepare(`UPDATE evidence_objects SET invalidated_at_utc = ?, invalidation_reason = ? WHERE id = ? AND invalidated_at_utc IS NULL`).bind(agora, entrada.motivo, evidencia.id).run();
  if (resultado.meta.changes !== 1) throw new ErroDominio("INVALID_STATE_TRANSITION", "A evidência já foi invalidada.", 409);
  return Response.json(esquemaInvalidarEvidenciaResposta.parse({ evidencia: paraWire({ ...evidencia, invalidated_at_utc: agora, invalidation_reason: entrada.motivo }) }));
};

export interface EnvEvidenceBucket {
  put(chave: string, valor: Uint8Array, opcoes?: { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> }): Promise<unknown>;
  get(chave: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer>; httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> } | null>;
  delete(chave: string): Promise<unknown>;
}
