import { describe, expect, it } from 'vitest';
import { TauriSqlDatabase } from '@infrastructure/persistence/sql/tauri-sql-database';
import type { TauriSqlDriver } from '@infrastructure/persistence/sql/tauri-sql-driver';
import { SqlError } from '@infrastructure/persistence/sql/sql-error';
import type { Migration } from '@infrastructure/persistence/sql/migrations';

interface Call {
  readonly kind: 'execute' | 'select';
  readonly sql: string;
  readonly params: readonly unknown[];
}

/** Just enough of a fake sqlite table to model `schema_migrations` for `runMigrations`. */
function createFakeDriver(opts: { failOn?: (sql: string) => boolean } = {}): {
  driver: TauriSqlDriver;
  calls: Call[];
  migrationRows: { version: number; name: string; applied_at: string }[];
  noteRows: { id: string; is_wip: number }[];
} {
  const calls: Call[] = [];
  const migrationRows: { version: number; name: string; applied_at: string }[] = [];
  const noteRows: { id: string; is_wip: number }[] = [];

  const driver: TauriSqlDriver = {
    async execute(sql, params = []) {
      calls.push({ kind: 'execute', sql, params });
      if (opts.failOn?.(sql)) throw new Error(`fake driver failure: ${sql}`);

      if (/^\s*INSERT INTO schema_migrations/i.test(sql)) {
        const [version, name, appliedAt] = params as [number, string, string];
        migrationRows.push({ version, name, applied_at: appliedAt });
        return { rowsAffected: 1 };
      }
      if (/^\s*INSERT INTO note/i.test(sql)) {
        const [id, , , isWip] = params as [string, string, string, number];
        noteRows.push({ id, is_wip: isWip });
        return { rowsAffected: 1, lastInsertId: 1 };
      }
      return { rowsAffected: 0 };
    },
    async select<T>(sql: string, params: unknown[] = []): Promise<T> {
      calls.push({ kind: 'select', sql, params });
      if (opts.failOn?.(sql)) throw new Error(`fake driver failure: ${sql}`);

      if (/^\s*SELECT version FROM schema_migrations/i.test(sql)) {
        return migrationRows.map((r) => ({ version: r.version })) as unknown as T;
      }
      if (/^\s*SELECT \* FROM note/i.test(sql)) {
        return noteRows as unknown as T;
      }
      return [] as unknown as T;
    },
  };

  return { driver, calls, migrationRows, noteRows };
}

const NOOP_MIGRATIONS: readonly Migration[] = [
  { version: 1, name: 'schema_v1', statements: ['CREATE TABLE note (id TEXT, is_wip INTEGER)'] },
];

describe('TauriSqlDatabase', () => {
  it('init runs PRAGMA foreign_keys=ON, then migrations, then records schema_migrations', async () => {
    const { driver, calls, migrationRows } = createFakeDriver();
    const db = new TauriSqlDatabase({ loadDriver: async () => driver, migrations: NOOP_MIGRATIONS });

    await db.execute('SELECT 1');

    const sqls = calls.filter((c) => c.kind === 'execute').map((c) => c.sql);
    expect(sqls[0]).toBe('PRAGMA foreign_keys = ON');
    expect(sqls).toContain('CREATE TABLE IF NOT EXISTS schema_migrations (\n  version INTEGER PRIMARY KEY,\n  name TEXT NOT NULL,\n  applied_at TEXT NOT NULL\n)');
    expect(sqls.some((s) => /CREATE TABLE note/.test(s))).toBe(true);
    expect(migrationRows).toEqual([{ version: 1, name: 'schema_v1', applied_at: expect.any(String) }]);
  });

  it('execute returns rowsAffected and lastInsertId', async () => {
    const { driver } = createFakeDriver();
    const db = new TauriSqlDatabase({ loadDriver: async () => driver, migrations: NOOP_MIGRATIONS });

    const result = await db.execute('INSERT INTO note (id, content, color, is_wip) VALUES (?, ?, ?, ?)', [
      'n1',
      'hi',
      'none',
      0,
    ]);

    expect(result).toEqual({ rowsAffected: 1, lastInsertId: 1 });
  });

  it('coerces boolean params to 1/0 before calling the driver', async () => {
    const { driver, calls } = createFakeDriver();
    const db = new TauriSqlDatabase({ loadDriver: async () => driver, migrations: NOOP_MIGRATIONS });

    await db.execute('INSERT INTO note (id, content, color, is_wip) VALUES (?, ?, ?, ?)', ['n1', 'hi', 'none', true]);

    const insertCall = calls.find((c) => c.kind === 'execute' && /INSERT INTO note/.test(c.sql));
    expect(insertCall?.params).toEqual(['n1', 'hi', 'none', 1]);
  });

  it('translates `?` placeholders to `$1, $2, ...` for the sqlite driver', async () => {
    const { driver, calls } = createFakeDriver();
    const db = new TauriSqlDatabase({ loadDriver: async () => driver, migrations: NOOP_MIGRATIONS });

    await db.execute('INSERT INTO note (id, content, color, is_wip) VALUES (?, ?, ?, ?)', ['n1', 'hi', 'none', 0]);

    const insertCall = calls.find((c) => c.kind === 'execute' && /INSERT INTO note/.test(c.sql));
    expect(insertCall?.sql).toBe('INSERT INTO note (id, content, color, is_wip) VALUES ($1, $2, $3, $4)');
    expect(insertCall?.params).toHaveLength(4);
  });

  it('query returns rows via driver.select', async () => {
    const { driver } = createFakeDriver();
    const db = new TauriSqlDatabase({ loadDriver: async () => driver, migrations: NOOP_MIGRATIONS });

    await db.execute('INSERT INTO note (id, content, color, is_wip) VALUES (?, ?, ?, ?)', ['n1', 'hi', 'none', 1]);
    const rows = await db.query<{ id: string; is_wip: number }>('SELECT * FROM note WHERE id = ?', ['n1']);

    expect(rows).toEqual([{ id: 'n1', is_wip: 1 }]);
  });

  it('transaction commits: BEGIN ... COMMIT wraps the work', async () => {
    const { driver, calls } = createFakeDriver();
    const db = new TauriSqlDatabase({ loadDriver: async () => driver, migrations: NOOP_MIGRATIONS });
    await db.execute('SELECT 1');
    calls.length = 0;

    await db.transaction(async (tx) => {
      await tx.execute('INSERT INTO note (id, content, color, is_wip) VALUES (?, ?, ?, ?)', ['a', 'A', 'none', 0]);
    });

    const sqls = calls.filter((c) => c.kind === 'execute').map((c) => c.sql);
    expect(sqls[0]).toBe('BEGIN');
    expect(sqls[sqls.length - 1]).toBe('COMMIT');
  });

  it('transaction rolls back on throw, wraps in SqlError, and rethrows', async () => {
    const { driver, calls } = createFakeDriver();
    const db = new TauriSqlDatabase({ loadDriver: async () => driver, migrations: NOOP_MIGRATIONS });
    await db.execute('SELECT 1');
    calls.length = 0;

    await expect(
      db.transaction(async (tx) => {
        await tx.execute('INSERT INTO note (id, content, color, is_wip) VALUES (?, ?, ?, ?)', ['b', 'B', 'none', 0]);
        throw new Error('boom');
      }),
    ).rejects.toThrow(SqlError);

    const sqls = calls.filter((c) => c.kind === 'execute').map((c) => c.sql);
    expect(sqls[0]).toBe('BEGIN');
    expect(sqls[sqls.length - 1]).toBe('ROLLBACK');
  });

  it('wraps driver errors in SqlError', async () => {
    const { driver } = createFakeDriver({ failOn: (sql) => /this_table_does_not_exist/.test(sql) });
    const db = new TauriSqlDatabase({ loadDriver: async () => driver, migrations: NOOP_MIGRATIONS });

    await expect(db.query('SELECT * FROM this_table_does_not_exist')).rejects.toThrow(SqlError);
  });
});
