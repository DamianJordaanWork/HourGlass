import type { ISqlDatabase, ISqlExecutor, SqlExecuteResult, SqlParam } from '@infrastructure/persistence/sql/sql-database';
import { runMigrations } from '@infrastructure/persistence/sql/migration-runner';
import { MIGRATIONS, type Migration } from '@infrastructure/persistence/sql/migrations';
import { driverErrorMessage, SqlError } from '@infrastructure/persistence/sql/sql-error';
import { healingMemo, IPC_TIMEOUT_MS, withTimeout } from '@infrastructure/async/with-timeout';
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
  /** Ceiling on each driver call. Defaults to {@link IPC_TIMEOUT_MS}. */
  readonly timeoutMs?: number;
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
  private readonly timeoutMs: number;
  /**
   * Healing memo: a stalled/failed init is discarded so the next call retries,
   * rather than every future query awaiting one poisoned promise (ADR-032).
   */
  private readonly ensureReady: () => Promise<void>;

  constructor(private readonly config: TauriSqlDatabaseConfig) {
    this.timeoutMs = config.timeoutMs ?? IPC_TIMEOUT_MS;
    // Init is generous: it opens the file AND runs every outstanding migration.
    this.ensureReady = healingMemo(() => this.init(), 'SQLite init', this.timeoutMs * 6);
  }

  private async init(): Promise<void> {
    this.driver = await withTimeout(this.config.loadDriver(), 'SQLite driver load', this.timeoutMs);
    await this.rawExecute('PRAGMA foreign_keys = ON');
    // Use the raw (non-ready-gated) executor here — awaiting `ensureReady()`
    // from inside the promise that *is* `ensureReady()` would deadlock.
    await runMigrations(
      { ...this.rawExecutor(), transaction: (work) => this.rawTransaction(work) },
      this.config.migrations ?? MIGRATIONS,
    );
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
      const result = await withTimeout(
        driver.execute(toPositionalDollar(sql), normalizeParams(params)),
        'SQLite execute',
        this.timeoutMs,
      );
      return result.lastInsertId === undefined
        ? { rowsAffected: result.rowsAffected }
        : { rowsAffected: result.rowsAffected, lastInsertId: result.lastInsertId };
    } catch (e) {
      throw new SqlError(driverErrorMessage(e, 'tauri-sql execute failed'), sql, e);
    }
  }

  async query<T>(sql: string, params: readonly SqlParam[] = []): Promise<readonly T[]> {
    await this.ensureReady();
    return this.rawQuery<T>(sql, params);
  }

  private async rawQuery<T>(sql: string, params: readonly SqlParam[] = []): Promise<readonly T[]> {
    const driver = this.getDriver();
    try {
      return await withTimeout(
        driver.select<T[]>(toPositionalDollar(sql), normalizeParams(params)),
        'SQLite query',
        this.timeoutMs,
      );
    } catch (e) {
      throw new SqlError(driverErrorMessage(e, 'tauri-sql query failed'), sql, e);
    }
  }

  async transaction<T>(work: (tx: ISqlExecutor) => Promise<T>): Promise<T> {
    await this.ensureReady();
    return this.rawTransaction(work);
  }

  /**
   * Runs `work` WITHOUT `BEGIN`/`COMMIT` — deliberately, and not because
   * atomicity doesn't matter (ADR-033).
   *
   * `tauri-plugin-sql` sends every statement through its own `invoke` call, and
   * each one is served by `sqlx`'s connection `Pool` (10 connections by
   * default) as a *prepared* query. So a `BEGIN` issued by one call and the
   * `COMMIT` issued by the next land on different connections, and SQLite
   * rejects the commit with "cannot commit - no transaction is active". The
   * plugin exposes no transaction API, no way to pin a connection, and no way
   * to size the pool, and multi-statement SQL is impossible through a prepared
   * query — so there is no way to be atomic across the IPC boundary.
   *
   * The consequence: a multi-statement write (e.g. a mapping rule's
   * delete-then-reinsert of its conditions) can be left half-applied if the app
   * dies mid-write. That matches the localStorage backend, which has never been
   * atomic either; `WasmSqlDatabase` (web) keeps real transactions.
   */
  private async rawTransaction<T>(work: (tx: ISqlExecutor) => Promise<T>): Promise<T> {
    try {
      return await work(this.rawExecutor());
    } catch (e) {
      if (e instanceof SqlError) throw e;
      throw new SqlError(e instanceof Error ? e.message : 'transaction failed', 'TRANSACTION', e);
    }
  }
}
