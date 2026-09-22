import type { Eventos, GeradorId, RegistroEvento } from "../../application/ports";

/**
 * Monta (sem executar) o INSERT de um evento — extraído de `RepositorioEventosD1.registrar`
 * para que o merge (`src/http/handlers/merges.ts`, PRD §26.2) possa compor eventos de DOIS
 * protocolos com outras escritas dentro de um único `db.batch()` atômico. `registrar` abaixo
 * é só a forma "executa sozinho" desta mesma montagem, usada por todo o resto do sistema.
 */
export function montarInsercaoEvento(
  db: D1Database,
  ids: GeradorId,
  registro: RegistroEvento,
): { statement: D1PreparedStatement; eventoId: string } {
  const id = ids.novo();
  const statement = db
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
    );
  return { statement, eventoId: id };
}

/** Implementação D1 da porta `Eventos`: apenas insere — `workflow_events` é append-only (nunca UPDATE/DELETE). */
export class RepositorioEventosD1 implements Eventos {
  constructor(
    private readonly db: D1Database,
    private readonly ids: GeradorId,
  ) {}

  async registrar(registro: RegistroEvento): Promise<string> {
    const { statement, eventoId } = montarInsercaoEvento(this.db, this.ids, registro);
    await statement.run();
    return eventoId;
  }
}
