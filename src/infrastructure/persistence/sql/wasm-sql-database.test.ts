import { describe, expect, it } from 'vitest';
import { createInMemoryWasmDatabase } from '@test/wasm-sql-database';
import { SqlError } from '@infrastructure/persistence/sql/sql-error';

interface CountRow {
  readonly n: number;
}

interface NoteRow {
  readonly id: string;
  readonly is_wip: number;
}

describe('WasmSqlDatabase', () => {
  it('initializes: creates all 10 schema tables + schema_migrations, and PRAGMA foreign_keys reads 1', async () => {
    const db = createInMemoryWasmDatabase();

    const tables = await db.query<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    );
    const names = tables.map((t) => t.name);

    for (const expected of [
      'time_interval',
      'mapping_rule',
      'mapping_condition',
      'quick_template',
      'calendar_account',
      'meeting',
      'note',
      'note_status',
      'ado_connection',
      'settings',
      'schema_migrations',
    ]) {
      expect(names).toContain(expected);
    }

    const pragma = await db.query<{ foreign_keys: number }>('PRAGMA foreign_keys');
    expect(pragma[0]?.foreign_keys).toBe(1);
  });

  it('execute + query round-trip, and reports rowsAffected', async () => {
    const db = createInMemoryWasmDatabase();

    const insertResult = await db.execute(
      'INSERT INTO note (id, content, color, is_wip, is_done, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ['n1', 'hello', 'none', 0, 0, 1, '2026-08-11T00:00:00Z'],
    );
    expect(insertResult.rowsAffected).toBe(1);

    const rows = await db.query<NoteRow>('SELECT id, is_wip FROM note WHERE id = ?', ['n1']);
    expect(rows).toEqual([{ id: 'n1', is_wip: 0 }]);

    const updateResult = await db.execute('UPDATE note SET is_wip = ? WHERE id = ?', [true, 'n1']);
    expect(updateResult.rowsAffected).toBe(1);

    const afterUpdate = await db.query<NoteRow>('SELECT id, is_wip FROM note WHERE id = ?', ['n1']);
    expect(afterUpdate[0]?.is_wip).toBe(1);
  });

  it('coerces boolean params to 0/1 (sql.js bind rejects raw booleans)', async () => {
    const db = createInMemoryWasmDatabase();

    await expect(
      db.execute(
        'INSERT INTO note (id, content, color, is_wip, is_done, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        ['n2', 'x', 'none', true, false, 1, '2026-08-11T00:00:00Z'],
      ),
    ).resolves.toMatchObject({ rowsAffected: 1 });

    const rows = await db.query<NoteRow>('SELECT is_wip FROM note WHERE id = ?', ['n2']);
    expect(rows[0]?.is_wip).toBe(1);
  });

  it('positional params bind correctly across multiple placeholders', async () => {
    const db = createInMemoryWasmDatabase();
    await db.execute(
      'INSERT INTO ado_connection (id, label, org_url, iteration_path, enabled) VALUES (?, ?, ?, ?, ?)',
      ['c1', 'Main', 'https://dev.azure.com/x', 'x\\Sprint 1', 1],
    );
    const rows = await db.query<{ id: string; label: string; org_url: string }>(
      'SELECT id, label, org_url FROM ado_connection WHERE id = ? AND enabled = ?',
      ['c1', 1],
    );
    expect(rows).toEqual([{ id: 'c1', label: 'Main', org_url: 'https://dev.azure.com/x' }]);
  });

  it('transaction commits all statements together', async () => {
    const db = createInMemoryWasmDatabase();

    await db.transaction(async (tx) => {
      await tx.execute(
        'INSERT INTO note (id, content, color, is_wip, is_done, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        ['a', 'A', 'none', 0, 0, 1, '2026-08-11T00:00:00Z'],
      );
      await tx.execute(
        'INSERT INTO note (id, content, color, is_wip, is_done, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        ['b', 'B', 'none', 0, 0, 2, '2026-08-11T00:00:00Z'],
      );
    });

    const rows = await db.query<CountRow>('SELECT COUNT(*) AS n FROM note');
    expect(rows[0]?.n).toBe(2);
  });

  it('transaction rolls back on throw, wraps in SqlError, and leaves no partial row', async () => {
    const db = createInMemoryWasmDatabase();

    await expect(
      db.transaction(async (tx) => {
        await tx.execute(
          'INSERT INTO note (id, content, color, is_wip, is_done, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          ['rollback-me', 'A', 'none', 0, 0, 1, '2026-08-11T00:00:00Z'],
        );
        throw new Error('boom');
      }),
    ).rejects.toThrow(SqlError);

    const rows = await db.query<{ id: string }>('SELECT id FROM note WHERE id = ?', ['rollback-me']);
    expect(rows).toEqual([]);
  });

  it('wraps malformed SQL in SqlError', async () => {
    const db = createInMemoryWasmDatabase();
    await expect(db.execute('NOT VALID SQL')).rejects.toThrow(SqlError);
    await expect(db.query('SELECT * FROM this_table_does_not_exist')).rejects.toThrow(SqlError);
  });
});
