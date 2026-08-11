import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import type { ISqlDatabase, ISqlExecutor, SqlExecuteResult, SqlParam } from '@infrastructure/persistence/sql/sql-database';
import { runMigrations } from '@infrastructure/persistence/sql/migration-runner';
import { MIGRATIONS, type Migration } from '@infrastructure/persistence/sql/migrations';
import { SqlError } from '@infrastructure/persistence/sql/sql-error';

const SAVE_DEBOUNCE_MS = 250;

export interface WasmSqlConfig {
  /** Resolves the on-disk/network location of `sql-wasm.wasm` for the current environment. */
  readonly locateFile: (file: string) => string;
  /** Loads previously persisted DB bytes (IndexedDB on web, undefined ⇒ fresh DB). */
  readonly load?: () => Promise<Uint8Array | null>;
  /** Persists the current DB bytes (debounced). Absent ⇒ in-memory only (tests). */
  readonly save?: (bytes: Uint8Array) => Promise<void>;
  readonly migrations?: readonly Migration[];
}

/** Coerce booleans (sql.js's bind rejects them) and keep everything else as-is. */
function normalizeParams(params: readonly SqlParam[]): (string | number | null)[] {
  return params.map((p) => {
    if (typeof p === 'boolean') return p ? 1 : 0;
    return p;
  });
}

/**
 * `ISqlDatabase` backed by sql.js (SQLite compiled to WASM). Runs identically in
 * the browser and under Vitest/Node — the deciding factor for choosing sql.js
 * over a browser-only driver. The whole database lives in memory and is
 * (re)serialized to `save()` after mutations; see ADR-014.
 */
export class WasmSqlDatabase implements ISqlDatabase {
  private db: Database | undefined;
  private ready: Promise<void> | undefined;
  private saveTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly config: WasmSqlConfig) {}

  private async init(): Promise<void> {
    const SQL: SqlJsStatic = await initSqlJs({ locateFile: this.config.locateFile });
    const bytes = (await this.config.load?.()) ?? undefined;
    this.db = new SQL.Database(bytes);
    this.db.run('PRAGMA foreign_keys=ON');
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

  private getDb(): Database {
    if (!this.db) throw new SqlError('WasmSqlDatabase used before initialization completed', '');
    return this.db;
  }

  /** A raw (non-ready-gated) executor — safe to pass as `tx` from inside `rawTransaction`. */
  private rawExecutor(): ISqlExecutor {
    return {
      execute: (sql, params) => this.rawExecute(sql, params ?? []),
      query: (sql, params) => this.rawQuery(sql, params ?? []),
    };
  }

  private scheduleSave(): void {
    if (!this.config.save) return;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined;
      const db = this.db;
      if (!db) return;
      void this.config.save?.(db.export());
    }, SAVE_DEBOUNCE_MS);
  }

  async execute(sql: string, params: readonly SqlParam[] = []): Promise<SqlExecuteResult> {
    await this.ensureReady();
    return this.rawExecute(sql, params);
  }

  private async rawExecute(sql: string, params: readonly SqlParam[] = []): Promise<SqlExecuteResult> {
    const db = this.getDb();
    try {
      db.run(sql, normalizeParams(params));
      const rowsAffected = db.getRowsModified();
      let lastInsertId: number | undefined;
      if (/^\s*insert/i.test(sql)) {
        const rows = db.exec('SELECT last_insert_rowid() AS id');
        const value = rows[0]?.values[0]?.[0];
        if (typeof value === 'number') lastInsertId = value;
      }
      if (/^\s*(insert|update|delete)/i.test(sql)) this.scheduleSave();
      return lastInsertId === undefined ? { rowsAffected } : { rowsAffected, lastInsertId };
    } catch (e) {
      throw new SqlError(e instanceof Error ? e.message : 'sql.js execute failed', sql, e);
    }
  }

  async query<T>(sql: string, params: readonly SqlParam[] = []): Promise<readonly T[]> {
    await this.ensureReady();
    return this.rawQuery<T>(sql, params);
  }

  private async rawQuery<T>(sql: string, params: readonly SqlParam[] = []): Promise<readonly T[]> {
    const db = this.getDb();
    try {
      const stmt = db.prepare(sql);
      try {
        stmt.bind(normalizeParams(params));
        const rows: T[] = [];
        while (stmt.step()) {
          rows.push(stmt.getAsObject() as T);
        }
        return rows;
      } finally {
        stmt.free();
      }
    } catch (e) {
      throw new SqlError(e instanceof Error ? e.message : 'sql.js query failed', sql, e);
    }
  }

  async transaction<T>(work: (tx: ISqlExecutor) => Promise<T>): Promise<T> {
    await this.ensureReady();
    return this.rawTransaction(work);
  }

  private async rawTransaction<T>(work: (tx: ISqlExecutor) => Promise<T>): Promise<T> {
    const db = this.getDb();
    try {
      db.run('BEGIN');
    } catch (e) {
      throw new SqlError(e instanceof Error ? e.message : 'sql.js BEGIN failed', 'BEGIN', e);
    }
    try {
      const result = await work(this.rawExecutor());
      db.run('COMMIT');
      this.scheduleSave();
      return result;
    } catch (e) {
      try {
        db.run('ROLLBACK');
      } catch {
        // best-effort — the original error is what matters.
      }
      if (e instanceof SqlError) throw e;
      throw new SqlError(e instanceof Error ? e.message : 'transaction failed', 'TRANSACTION', e);
    }
  }

  /** Flush any pending debounced save immediately (e.g. before unload). */
  async flush(): Promise<void> {
    if (!this.saveTimer) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
    const db = this.db;
    if (db) await this.config.save?.(db.export());
  }
}
