import { describe, expect, it } from 'vitest';
import { FakeSqlDatabase } from '@test/fake-sql-database';
import { createInMemoryWasmDatabase } from '@test/wasm-sql-database';
import { MigrationError, runMigrations } from '@infrastructure/persistence/sql/migration-runner';
import { MIGRATIONS } from '@infrastructure/persistence/sql/migrations';
import { SCHEMA_V1 } from '@infrastructure/persistence/sql/schema';

const FIXED_NOW = '2026-08-11T00:00:00.000Z';
const fixedNowIso = (): string => FIXED_NOW;

/** The tip of the real migration set — assertions track it instead of a literal. */
const TIP = MIGRATIONS[MIGRATIONS.length - 1]!.version;
const ALL_VERSIONS = MIGRATIONS.map((m) => m.version);
/** A synthetic migration one past the tip, for the ordering/idempotency cases. */
const synthetic = { version: TIP + 1, name: 'add_widget', statements: [`CREATE TABLE IF NOT EXISTS widget (id TEXT PRIMARY KEY)`] };

describe('runMigrations', () => {
  it('applies every migration (append-only) against a fresh database', async () => {
    const db = new FakeSqlDatabase();

    const result = await runMigrations(db, MIGRATIONS, fixedNowIso);

    expect(result).toEqual({ applied: ALL_VERSIONS, currentVersion: TIP });

    // schema_migrations bootstrap table created
    expect(db.log[0]!.sql).toContain('CREATE TABLE IF NOT EXISTS schema_migrations');

    // every SCHEMA_V1 statement was executed
    for (const stmt of SCHEMA_V1) {
      expect(db.log.some((c) => c.sql === stmt)).toBe(true);
    }
    // the v2 append-only statement was executed
    expect(db.log.some((c) => c.sql === 'ALTER TABLE settings ADD COLUMN google_client_id TEXT')).toBe(true);
    // the v3 append-only statement was executed
    expect(db.log.some((c) => c.sql === 'ALTER TABLE ado_connection ADD COLUMN harvest_guid TEXT')).toBe(true);

    // one INSERT per migration, in ascending order
    const inserts = db.log.filter((c) => c.sql.startsWith('INSERT INTO schema_migrations'));
    expect(inserts.map((i) => i.params)).toEqual(MIGRATIONS.map((m) => [m.version, m.name, FIXED_NOW]));
  });

  it('is idempotent — a second run applies nothing', async () => {
    const db = new FakeSqlDatabase();
    await runMigrations(db, MIGRATIONS, fixedNowIso);

    const before = db.log.length;
    const result = await runMigrations(db, MIGRATIONS, fixedNowIso);

    expect(result).toEqual({ applied: [], currentVersion: TIP });
    // only the bootstrap CREATE TABLE + SELECT ran again, no DDL/INSERT re-applied
    const callsSinceSecondRun = db.log.slice(before);
    expect(callsSinceSecondRun.length).toBeGreaterThan(0);
    const insertsSinceSecondRun = callsSinceSecondRun.filter((c) => c.sql.startsWith('INSERT INTO schema_migrations'));
    expect(insertsSinceSecondRun).toHaveLength(0);
  });

  it('applies a synthetic migration past the tip, in order, on a fresh database', async () => {
    const db = new FakeSqlDatabase();

    const result = await runMigrations(db, [...MIGRATIONS, synthetic], fixedNowIso);

    expect(result).toEqual({ applied: [...ALL_VERSIONS, synthetic.version], currentVersion: synthetic.version });
    const inserts = db.log.filter((c) => c.sql.startsWith('INSERT INTO schema_migrations'));
    expect(inserts.map((i) => i.params[0])).toEqual([...ALL_VERSIONS, synthetic.version]);
  });

  it('applies only the outstanding migrations on a database that already has v1', async () => {
    const db = new FakeSqlDatabase();
    await runMigrations(db, [MIGRATIONS[0]!], fixedNowIso);

    const result = await runMigrations(db, MIGRATIONS, fixedNowIso);

    expect(result).toEqual({ applied: ALL_VERSIONS.slice(1), currentVersion: TIP });
    const alterCalls = db.log.filter((c) => c.sql === 'ALTER TABLE settings ADD COLUMN google_client_id TEXT');
    expect(alterCalls).toHaveLength(1);
    const guidAlterCalls = db.log.filter((c) => c.sql === 'ALTER TABLE ado_connection ADD COLUMN harvest_guid TEXT');
    expect(guidAlterCalls).toHaveLength(1);
  });

  it('applies only the new migration on a database already at the tip', async () => {
    const db = new FakeSqlDatabase();
    await runMigrations(db, MIGRATIONS, fixedNowIso);

    const result = await runMigrations(db, [...MIGRATIONS, synthetic], fixedNowIso);

    expect(result).toEqual({ applied: [synthetic.version], currentVersion: synthetic.version });
  });

  it('applies migrations in ascending order regardless of input order', async () => {
    const db = new FakeSqlDatabase();

    const result = await runMigrations(db, [synthetic, ...MIGRATIONS], fixedNowIso);

    expect(result).toEqual({ applied: [...ALL_VERSIONS, synthetic.version], currentVersion: synthetic.version });
    const inserts = db.log.filter((c) => c.sql.startsWith('INSERT INTO schema_migrations'));
    expect(inserts.map((i) => i.params[0])).toEqual([...ALL_VERSIONS, synthetic.version]);
  });

  it('throws MigrationError on duplicate versions', async () => {
    const db = new FakeSqlDatabase();
    const dupe = { version: 1, name: 'dupe', statements: [] };

    await expect(runMigrations(db, [...MIGRATIONS, dupe], fixedNowIso)).rejects.toThrow(MigrationError);
  });

  it('throws MigrationError on non-increasing versions supplied out of declaration order', async () => {
    const db = new FakeSqlDatabase();
    // Two distinct migrations sharing the same version number is non-increasing once sorted.
    const a = { version: 3, name: 'a', statements: [] };
    const b = { version: 3, name: 'b', statements: [] };

    await expect(runMigrations(db, [...MIGRATIONS, a, b], fixedNowIso)).rejects.toThrow(MigrationError);
  });

  it('rolls back on failure injection: no version INSERT recorded, error rethrown', async () => {
    const db = new FakeSqlDatabase();
    db.failOn = 'CREATE TABLE IF NOT EXISTS meeting';

    await expect(runMigrations(db, MIGRATIONS, fixedNowIso)).rejects.toThrow(/injected failure/);

    const inserts = db.log.filter((c) => c.sql.startsWith('INSERT INTO schema_migrations'));
    expect(inserts).toHaveLength(0);
    expect(db.appliedVersions.has(1)).toBe(false);
  });

  it('uses the injected nowIso for applied_at', async () => {
    const db = new FakeSqlDatabase();
    await runMigrations(db, MIGRATIONS, fixedNowIso);

    const insert = db.log.find((c) => c.sql.startsWith('INSERT INTO schema_migrations'));
    expect(insert?.params[2]).toBe(FIXED_NOW);
  });

  describe('migration v2 (settings_google_client_id) against a real SQLite engine', () => {
    it('a fresh database applies every migration and reaches the tip, with the column present', async () => {
      const db = createInMemoryWasmDatabase(MIGRATIONS);

      // WasmSqlDatabase runs migrations lazily on first use.
      const columns = await db.query<{ name: string }>('PRAGMA table_info(settings)');
      const names = columns.map((c) => c.name);
      expect(names).toContain('google_client_id');

      const versions = await db.query<{ version: number }>('SELECT version FROM schema_migrations ORDER BY version');
      expect(versions.map((v) => v.version)).toEqual(ALL_VERSIONS);
    });

    it('a database already at v1 applies the rest and gains the columns', async () => {
      const v1Only = createInMemoryWasmDatabase([MIGRATIONS[0]!]);
      // Force v1-only initialization.
      await v1Only.query('SELECT 1');
      const columnsBefore = await v1Only.query<{ name: string }>('PRAGMA table_info(settings)');
      expect(columnsBefore.map((c) => c.name)).not.toContain('google_client_id');

      const result = await runMigrations(v1Only, MIGRATIONS, fixedNowIso);

      expect(result).toEqual({ applied: ALL_VERSIONS.slice(1), currentVersion: TIP });
      const columnsAfter = await v1Only.query<{ name: string }>('PRAGMA table_info(settings)');
      expect(columnsAfter.map((c) => c.name)).toContain('google_client_id');
      const adoColumnsAfter = await v1Only.query<{ name: string }>('PRAGMA table_info(ado_connection)');
      expect(adoColumnsAfter.map((c) => c.name)).toContain('harvest_guid');
    });
  });

  describe('migration v4 (work item sections + multi-ticket intervals)', () => {
    it('a fresh database has work_item_refs, the sections tables, and the parent-fetch setting', async () => {
      const db = createInMemoryWasmDatabase(MIGRATIONS);

      const intervalCols = await db.query<{ name: string }>('PRAGMA table_info(time_interval)');
      expect(intervalCols.map((c) => c.name)).toContain('work_item_refs');

      const settingsCols = await db.query<{ name: string }>('PRAGMA table_info(settings)');
      expect(settingsCols.map((c) => c.name)).toContain('fetch_parent_work_items');

      const sectionCols = await db.query<{ name: string }>('PRAGMA table_info(work_item_section)');
      expect(sectionCols.map((c) => c.name)).toEqual(
        expect.arrayContaining(['id', 'label', 'sort_order', 'enabled', 'default_collapsed', 'nest_under_parent', 'group_by_parent', 'sort_by', 'sort_direction']),
      );
      const conditionCols = await db.query<{ name: string }>('PRAGMA table_info(work_item_section_condition)');
      expect(conditionCols.map((c) => c.name)).toEqual(
        expect.arrayContaining(['section_id', 'seq', 'field', 'operator', 'value', 'negate']),
      );
    });
  });

  describe('migration v3 (ado_connection_harvest_guid) against a real SQLite engine', () => {
    it('a fresh database has the harvest_guid column on ado_connection', async () => {
      const db = createInMemoryWasmDatabase(MIGRATIONS);
      const columns = await db.query<{ name: string }>('PRAGMA table_info(ado_connection)');
      expect(columns.map((c) => c.name)).toContain('harvest_guid');
    });
  });
});
