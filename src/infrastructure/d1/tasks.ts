import type { GeradorId, NovaTarefa, Relogio, Tarefas } from "../../application/ports";

/**
 * Monta (sem executar) os INSERTs em lote de tarefas — extraído de
 * `RepositorioTarefasD1.criarEmLote` para que o merge (`src/http/handlers/merges.ts`, PRD
 * §26.2) possa incluir as tarefas da revalidação dentro do único `db.batch()` atômico da
 * operação inteira, em vez de num `db.batch()` próprio e separado.
 */
export function montarInsercoesTarefas(
  db: D1Database,
  ids: GeradorId,
  relogio: Relogio,
  tarefas: readonly NovaTarefa[],
): { statements: D1PreparedStatement[]; taskIds: string[] } {
  if (tarefas.length === 0) {
    return { statements: [], taskIds: [] };
  }

  const criadoEmUtc = relogio.agoraUtc();
  const idsGerados = tarefas.map(() => ids.novo());

  const statements = tarefas.map((nova, indice) =>
    db
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

  return { statements, taskIds: idsGerados };
}

/** Implementação D1 da porta `Tarefas`: grava em lote, atômico, as tarefas de uma execução. */
export class RepositorioTarefasD1 implements Tarefas {
  constructor(
    private readonly db: D1Database,
    private readonly ids: GeradorId,
    private readonly relogio: Relogio,
  ) {}

  async criarEmLote(tarefas: readonly NovaTarefa[]): Promise<readonly string[]> {
    const { statements, taskIds } = montarInsercoesTarefas(this.db, this.ids, this.relogio, tarefas);
    if (statements.length === 0) {
      return [];
    }
    await this.db.batch(statements);
    return taskIds;
  }
}
