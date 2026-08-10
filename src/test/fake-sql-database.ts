import type { ISqlDatabase, ISqlExecutor, SqlExecuteResult, SqlParam } from '@infrastructure/persistence/sql/sql-database';

export interface RecordedCall {
  readonly sql: string;
  readonly params: readonly SqlParam[];
}

/**
 * Scriptable ISqlDatabase double for unit tests. Records every {sql, params}
 * call in order. Only understands `schema_migrations` semantics (tracks
 * applied versions in a Set and answers the runner's SELECT/INSERT against
 * it) — all other DDL/DML is opaque and merely recorded, never parsed.
 */
export class FakeSqlDatabase implements ISqlDatabase {
  readonly log: RecordedCall[] = [];
  readonly appliedVersions = new Set<number>();

  /** When set, execute() throws for any sql containing this substring (failure injection). */
  failOn: string | undefined;

  async execute(sql: string, params: readonly SqlParam[] = []): Promise<SqlExecuteResult> {
    this.log.push({ sql, params });

    if (this.failOn !== undefined && sql.includes(this.failOn)) {
      throw new Error(`FakeSqlDatabase: injected failure for statement containing "${this.failOn}"`);
    }

    if (sql.startsWith('INSERT INTO schema_migrations')) {
      const version = params[0];
      if (typeof version === 'number') this.appliedVersions.add(version);
      return { rowsAffected: 1 };
    }

    return { rowsAffected: 0 };
  }

  async query<T>(sql: string, params: readonly SqlParam[] = []): Promise<readonly T[]> {
    this.log.push({ sql, params });

    if (sql.includes('SELECT version FROM schema_migrations')) {
      const rows = [...this.appliedVersions].map((version) => ({ version }));
      return rows as unknown as readonly T[];
    }

    return [];
  }

  async transaction<T>(work: (tx: ISqlExecutor) => Promise<T>): Promise<T> {
    return work(this);
  }
}
