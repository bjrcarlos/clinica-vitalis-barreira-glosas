import type { Eventos, GeradorId, RegistroEvento } from "../../application/ports";

/** Implementação D1 da porta `Eventos`: apenas insere — `workflow_events` é append-only (nunca UPDATE/DELETE). */
export class RepositorioEventosD1 implements Eventos {
  constructor(
    private readonly db: D1Database,
    private readonly ids: GeradorId,
  ) {}

  async registrar(registro: RegistroEvento): Promise<string> {
    const id = this.ids.novo();
    await this.db
      .prepare(
        `INSERT INTO workflow_events (
           id, protocol_id, guide_version_id, event_type, actor_role, actor_principal,
           source, reason, metadata_json, occurred_at_utc, recorded_at_utc
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        registro.protocoloId,
        registro.guiaVersaoId,
        registro.evento.tipo,
        registro.evento.papel,
        registro.evento.ator,
        registro.evento.origem,
        registro.evento.motivo,
        JSON.stringify(registro.evento.metadata),
        registro.evento.ocorrido_em_utc,
        registro.evento.registrado_em_utc,
      )
      .run();
    return id;
  }
}
