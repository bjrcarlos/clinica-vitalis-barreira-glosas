import type { GeradorId, Relogio } from "../../application/ports";
import { isArea, type Area } from "../../domain/statuses";

/**
 * Repositório D1 de `evidence_objects`/`evidence_links` (PRD-SDD §19.8, §19.9). Interface e
 * implementação vivem juntas neste arquivo — diferente dos outros repositórios de
 * `src/infrastructure/d1/`, que implementam portas já declaradas em `src/application/ports.ts`
 * (fora do escopo desta tarefa; quem ligar isto a `criarRepositoriosD1` decide se promove esta
 * interface para lá).
 *
 * `evidence_objects` nunca sofre DELETE nem perde uma linha: uma evidência errada é invalidada
 * (`invalidated_at_utc` + `invalidation_reason`) e substituída por outra, nunca apagada (RF-12).
 * `evidence_links` é o que permite o mesmo objeto aparecer em dois protocolos depois de um merge
 * sem duplicar o arquivo no R2 (RF-13, §26.2) — `origin_protocol_id` preserva de onde a evidência
 * veio originalmente, mesmo depois de vinculada também ao protocolo principal.
 */

/** Dados mínimos para gravar uma evidência já armazenada no R2 (ver `../r2/evidence-store.ts`). */
export interface NovaEvidenciaObjeto {
  readonly r2Key: string;
  readonly originalFilename: string;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly uploadedByRole: Area;
  readonly uploadedByPrincipal: string;
}

/** Uma evidência já persistida, com seu estado de invalidação (nunca removida, só marcada). */
export interface EvidenciaObjeto {
  readonly id: string;
  readonly r2Key: string;
  readonly originalFilename: string;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly uploadedByRole: Area;
  readonly uploadedByPrincipal: string;
  readonly uploadedAtUtc: string;
  readonly invalidatedAtUtc: string | null;
  readonly invalidationReason: string | null;
}

/**
 * Dados de um vínculo entre uma evidência e um protocolo. `tipoRelacao` é texto livre (PRD §19.9:
 * "importação, autorização, envio etc." — a lista é exemplificativa, não um código estável
 * fechado do CLAUDE.md), decidido por quem grava o vínculo. `protocoloOrigemId` normalmente
 * repete `protocoloId`; no merge (RF-13) o vínculo novo do protocolo principal aponta
 * `protocoloOrigemId` para o protocolo que originalmente recebeu a evidência, preservando de onde
 * ela veio mesmo depois de vinculada também ao principal.
 */
export interface NovoVinculoEvidencia {
  readonly evidenciaId: string;
  readonly protocoloId: string;
  readonly eventoId: string | null;
  readonly guiaVersaoId: string | null;
  readonly tipoRelacao: string;
  readonly protocoloOrigemId: string;
}

/** Uma evidência já vinculada a um protocolo, com os dados do próprio vínculo — para exibir em "Evidências" na tela do protocolo. */
export interface EvidenciaVinculada extends EvidenciaObjeto {
  readonly eventoId: string | null;
  readonly guiaVersaoId: string | null;
  readonly tipoRelacao: string;
  readonly protocoloOrigemId: string;
}

interface LinhaEvidenciaObjeto {
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

interface LinhaEvidenciaVinculada extends LinhaEvidenciaObjeto {
  readonly link_event_id: string | null;
  readonly link_guide_version_id: string | null;
  readonly link_relation_type: string;
  readonly link_origin_protocol_id: string;
}

function paraArea(valor: string): Area {
  if (!isArea(valor)) {
    throw new Error(`uploaded_by_role inválido em disco: ${valor}`);
  }
  return valor;
}

function paraEvidenciaObjeto(linha: LinhaEvidenciaObjeto): EvidenciaObjeto {
  return {
    id: linha.id,
    r2Key: linha.r2_key,
    originalFilename: linha.original_filename,
    contentType: linha.content_type,
    sizeBytes: linha.size_bytes,
    sha256: linha.sha256,
    uploadedByRole: paraArea(linha.uploaded_by_role),
    uploadedByPrincipal: linha.uploaded_by_principal,
    uploadedAtUtc: linha.uploaded_at_utc,
    invalidatedAtUtc: linha.invalidated_at_utc,
    invalidationReason: linha.invalidation_reason,
  };
}

function paraEvidenciaVinculada(linha: LinhaEvidenciaVinculada): EvidenciaVinculada {
  return {
    ...paraEvidenciaObjeto(linha),
    eventoId: linha.link_event_id,
    guiaVersaoId: linha.link_guide_version_id,
    tipoRelacao: linha.link_relation_type,
    protocoloOrigemId: linha.link_origin_protocol_id,
  };
}

/** Porta local deste repositório (ver nota de topo sobre não estar em `application/ports.ts` ainda). */
export interface EvidenciaObjetos {
  gravar(dados: NovaEvidenciaObjeto): Promise<EvidenciaObjeto>;
  buscarPorId(id: string): Promise<EvidenciaObjeto | null>;
  /** Marca a evidência como inválida com `motivo` obrigatório — nunca apaga a linha (RF-12). Devolve `false` sem alterar nada se o id não existir ou já estiver invalidado. */
  invalidar(id: string, motivo: string): Promise<boolean>;
  vincular(dados: NovoVinculoEvidencia): Promise<void>;
  listarPorProtocolo(protocoloId: string): Promise<readonly EvidenciaVinculada[]>;
}

/** Implementação D1 de `EvidenciaObjetos`. */
export class RepositorioEvidenciasD1 implements EvidenciaObjetos {
  constructor(
    private readonly db: D1Database,
    private readonly ids: GeradorId,
    private readonly relogio: Relogio,
  ) {}

  async gravar(dados: NovaEvidenciaObjeto): Promise<EvidenciaObjeto> {
    const id = this.ids.novo();
    const uploadedAtUtc = this.relogio.agoraUtc();

    await this.db
      .prepare(
        `INSERT INTO evidence_objects (
           id, r2_key, original_filename, content_type, size_bytes, sha256,
           uploaded_by_role, uploaded_by_principal, uploaded_at_utc,
           invalidated_at_utc, invalidation_reason
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)`,
      )
      .bind(
        id,
        dados.r2Key,
        dados.originalFilename,
        dados.contentType,
        dados.sizeBytes,
        dados.sha256,
        dados.uploadedByRole,
        dados.uploadedByPrincipal,
        uploadedAtUtc,
      )
      .run();

    return {
      id,
      r2Key: dados.r2Key,
      originalFilename: dados.originalFilename,
      contentType: dados.contentType,
      sizeBytes: dados.sizeBytes,
      sha256: dados.sha256,
      uploadedByRole: dados.uploadedByRole,
      uploadedByPrincipal: dados.uploadedByPrincipal,
      uploadedAtUtc,
      invalidatedAtUtc: null,
      invalidationReason: null,
    };
  }

  async buscarPorId(id: string): Promise<EvidenciaObjeto | null> {
    const linha = await this.db
      .prepare(`SELECT * FROM evidence_objects WHERE id = ?`)
      .bind(id)
      .first<LinhaEvidenciaObjeto>();
    return linha === null ? null : paraEvidenciaObjeto(linha);
  }

  async invalidar(id: string, motivo: string): Promise<boolean> {
    const invalidatedAtUtc = this.relogio.agoraUtc();
    const resultado = await this.db
      .prepare(
        `UPDATE evidence_objects
         SET invalidated_at_utc = ?, invalidation_reason = ?
         WHERE id = ? AND invalidated_at_utc IS NULL`,
      )
      .bind(invalidatedAtUtc, motivo, id)
      .run();
    return resultado.meta.changes > 0;
  }

  async vincular(dados: NovoVinculoEvidencia): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO evidence_links (
           evidence_id, protocol_id, event_id, guide_version_id, relation_type, origin_protocol_id
         ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        dados.evidenciaId,
        dados.protocoloId,
        dados.eventoId,
        dados.guiaVersaoId,
        dados.tipoRelacao,
        dados.protocoloOrigemId,
      )
      .run();
  }

  async listarPorProtocolo(protocoloId: string): Promise<readonly EvidenciaVinculada[]> {
    const linhas = await this.db
      .prepare(
        `SELECT eo.*,
                el.event_id AS link_event_id,
                el.guide_version_id AS link_guide_version_id,
                el.relation_type AS link_relation_type,
                el.origin_protocol_id AS link_origin_protocol_id
         FROM evidence_links el
         JOIN evidence_objects eo ON eo.id = el.evidence_id
         WHERE el.protocol_id = ?
         ORDER BY eo.uploaded_at_utc ASC`,
      )
      .bind(protocoloId)
      .all<LinhaEvidenciaVinculada>();

    return linhas.results.map(paraEvidenciaVinculada);
  }
}
