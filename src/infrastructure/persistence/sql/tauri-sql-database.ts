import type { ISqlDatabase, ISqlExecutor, SqlExecuteResult, SqlParam } from '@infrastructure/persistence/sql/sql-database';
import { runMigrations } from '@infrastructure/persistence/sql/migration-runner';
import { MIGRATIONS, type Migration } from '@infrastructure/persistence/sql/migrations';
import { SqlError } from '@infrastructure/persistence/sql/sql-error';
import type { TauriSqlDriver } from '@infrastructure/persistence/sql/tauri-sql-driver';

/** Coerce booleans (the plugin-sql driver rejects them) — same normalization as `WasmSqlDatabase`. */
function normalizeParams(params: readonly SqlParam[]): (string | number | null)[] {
  return params.map((p) => {
    if (typeof p === 'boolean') return p ? 1 : 0;
    return p;
  });
}

/**
 * Rewrites our shared `?`-style positional placeholders to the `$1, $2, ...`
 * style `@tauri-apps/plugin-sql`'s sqlite driver requires (its own docs show
 * `?` only for the mysql driver; sqlite/postgres examples use `$n` — see
 * `tauri-sql-driver.ts` and ADR-015). A left-to-right replacement of each
 * standalone `?` is sufficient because none of our schema/repo SQL embeds a
 * literal `?` inside a quoted string.
 */
function toPositionalDollar(sql: string): string {
  let n = 0;
  return sql.replace(/\?/g, () => {
    n += 1;
    return `$${n}`;
  });
}

export interface TauriSqlDatabaseConfig {
  /** Obtains the connected driver (deferred so construction stays synchronous/side-effect-free). */
  readonly loadDriver: () => Promise<TauriSqlDriver>;
  readonly migrations?: readonly Migration[];
}

/**
 * `ISqlDatabase` backed by `@tauri-apps/plugin-sql` (native SQLite via the
 * Tauri desktop shell). The driver itself is injected via `loadDriver` so this
 * class — including migrations, transactions, and param handling — is fully
 * unit-testable with a fake driver in Node; only `desktop-sql-database.ts`
 * (the `Database.load(...)` binding) is desktop-only/not-run. See ADR-015.
 */
export class TauriSqlDatabase implements ISqlDatabase {
  private driver: TauriSqlDriver | undefined;
  private ready: Promise<void> | undefined;

  constructor(private readonly config: TauriSqlDatabaseConfig) {}

  private async init(): Promise<void> {
    this.driver = await this.config.loadDriver();
    await this.rawExecute('PRAGMA foreign_keys = ON');
    // Use the raw (non-ready-gated) executor here — awaiting `ensureReady()`
    // from inside the promise that *is* `ensureReady()` would deadlock.
    await runMigrations(
      { ...this.rawExecutor(), transaction: (work) => this.rawTransaction(work) },
      this.config.migrations ?? MIGRATIONS,
    );
  }

  private ensureReady(): Promise<void> {
    if (!this.ready) this.ready = this.init();
    return this.ready;
  }

  private getDriver(): TauriSqlDriver {
    if (!this.driver) throw new SqlError('TauriSqlDatabase used before initialization completed', '');
    return this.driver;
  }

  /** A raw (non-ready-gated) executor — safe to pass as `tx` from inside `rawTransaction`. */
  private rawExecutor(): ISqlExecutor {
    return {
      execute: (sql, params) => this.rawExecute(sql, params ?? []),
      query: (sql, params) => this.rawQuery(sql, params ?? []),
    };
  }

  async execute(sql: string, params: readonly SqlParam[] = []): Promise<SqlExecuteResult> {
    await this.ensureReady();
    return this.rawExecute(sql, params);
  }

  private async rawExecute(sql: string, params: readonly SqlParam[] = []): Promise<SqlExecuteResult> {
    const driver = this.getDriver();
    try {
      const result = await driver.execute(toPositionalDollar(sql), normalizeParams(params));
      return result.lastInsertId === undefined
        ? { rowsAffected: result.rowsAffected }
        : { rowsAffected: result.rowsAffected, lastInsertId: result.lastInsertId };
    } catch (e) {
      throw new SqlError(e instanceof Error ? e.message : 'tauri-sql execute failed', sql, e);
    }
  }

  async query<T>(sql: string, params: readonly SqlParam[] = []): Promise<readonly T[]> {
    await this.ensureReady();
    return this.rawQuery<T>(sql, params);
  }

  private async rawQuery<T>(sql: string, params: readonly SqlParam[] = []): Promise<readonly T[]> {
    const driver = this.getDriver();
    try {
      return await driver.select<T[]>(toPositionalDollar(sql), normalizeParams(params));
    } catch (e) {
      throw new SqlError(e instanceof Error ? e.message : 'tauri-sql query failed', sql, e);
    }
  }

  async transaction<T>(work: (tx: ISqlExecutor) => Promise<T>): Promise<T> {
    await this.ensureReady();
    return this.rawTransaction(work);
  }

  private async rawTransaction<T>(work: (tx: ISqlExecutor) => Promise<T>): Promise<T> {
    try {
      await this.rawExecute('BEGIN');
    } catch (e) {
      throw new SqlError(e instanceof Error ? e.message : 'tauri-sql BEGIN failed', 'BEGIN', e);
    }
    try {
      const result = await work(this.rawExecutor());
      await this.rawExecute('COMMIT');
      return result;
    } catch (e) {
      try {
        await this.rawExecute('ROLLBACK');
      } catch {
        // best-effort — the original error is what matters.
      }
      if (e instanceof SqlError) throw e;
      throw new SqlError(e instanceof Error ? e.message : 'transaction failed', 'TRANSACTION', e);
    }
  }
}
