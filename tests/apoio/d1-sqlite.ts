import type { DatabaseSync, StatementSync } from "node:sqlite";

/**
 * Adaptador "D1Database" sobre `node:sqlite` para teste, com uma diferença que importa em
 * relação ao que os testes mais antigos montam inline: `run()` devolve `meta.changes` de
 * verdade.
 *
 * O OAuth depende disso. Consumir um código de autorização é
 * `UPDATE ... WHERE used_at_utc IS NULL`, e a decisão "o código ainda valia?" é exatamente o
 * número de linhas afetadas. Um adaptador que devolve `meta: {}` faria o teste passar por
 * motivo errado — ou reprovar código correto.
 */
class Statement {
  constructor(
    private readonly db: DatabaseSync,
    private readonly sql: string,
    private readonly valores: unknown[] = [],
  ) {}

  bind(...valores: unknown[]): Statement {
    return new Statement(this.db, this.sql, valores);
  }

  private preparar(): StatementSync {
    return this.db.prepare(this.sql);
  }

  async first<T>(): Promise<T | null> {
    return (this.preparar().get(...(this.valores as never[])) ?? null) as T | null;
  }

  async run<T>(): Promise<{ success: true; meta: { changes: number }; results: T[] }> {
    const resultado = this.preparar().run(...(this.valores as never[]));
    return { success: true, meta: { changes: Number(resultado.changes ?? 0) }, results: [] };
  }

  async all<T>(): Promise<{ success: true; meta: { changes: number }; results: T[] }> {
    const linhas = this.preparar().all(...(this.valores as never[]));
    return { success: true, meta: { changes: 0 }, results: linhas as T[] };
  }
}

export class D1SobreSqlite {
  constructor(private readonly db: DatabaseSync) {}

  prepare(sql: string): Statement {
    return new Statement(this.db, sql);
  }

  async batch<T>(statements: Statement[]): Promise<Array<{ success: true; meta: { changes: number }; results: T[] }>> {
    this.db.exec("BEGIN");
    try {
      const resultados = [];
      for (const statement of statements) resultados.push(await statement.all<T>());
      this.db.exec("COMMIT");
      return resultados;
    } catch (erro) {
      this.db.exec("ROLLBACK");
      throw erro;
    }
  }
}
