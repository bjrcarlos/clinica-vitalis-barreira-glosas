import type { GeradorId, NovaTarefa, Relogio, Tarefas } from "../../application/ports";

/** Implementação D1 da porta `Tarefas`: grava em lote, atômico, as tarefas de uma execução. */
export class RepositorioTarefasD1 implements Tarefas {
  constructor(
    private readonly db: D1Database,
    private readonly ids: GeradorId,
    private readonly relogio: Relogio,
  ) {}

  async criarEmLote(tarefas: readonly NovaTarefa[]): Promise<readonly string[]> {
    if (tarefas.length === 0) {
      return [];
    }

    const criadoEmUtc = this.relogio.agoraUtc();
    const idsGerados = tarefas.map(() => this.ids.novo());

    const statements = tarefas.map((nova, indice) =>
      this.db
        .prepare(
          `INSERT INTO tasks (
             id, protocol_id, issue_id, assigned_area, task_type, title, status,
             blocking, created_at_utc, resolved_at_utc
           ) VALUES (?, ?, ?, ?, ?, ?, 'ABERTA', ?, ?, NULL)`,
        )
        .bind(
          idsGerados[indice],
          nova.protocoloId,
          nova.issueId,
          nova.tarefa.area,
          nova.tarefa.tipo,
          nova.tarefa.titulo,
          nova.tarefa.bloqueante ? 1 : 0,
          criadoEmUtc,
        ),
    );

    await this.db.batch(statements);
    return idsGerados;
  }
}
