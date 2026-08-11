import { describe, expect, it } from 'vitest';
import { FakeSqlDatabase } from '@test/fake-sql-database';
import { createInMemoryWasmDatabase } from '@test/wasm-sql-database';
import { MigrationError, runMigrations } from '@infrastructure/persistence/sql/migration-runner';
import { MIGRATIONS } from '@infrastructure/persistence/sql/migrations';
import { SCHEMA_V1 } from '@infrastructure/persistence/sql/schema';

const FIXED_NOW = '2026-08-11T00:00:00.000Z';
const fixedNowIso = (): string => FIXED_NOW;

describe('runMigrations', () => {
  it('applies v1, v2, v3 (append-only) against a fresh database', async () => {
    const db = new FakeSqlDatabase();

    const result = await runMigrations(db, MIGRATIONS, fixedNowIso);

    expect(result).toEqual({ applied: [1, 2, 3], currentVersion: 3 });

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

    // exactly three INSERTs recording versions 1, 2, 3, in order
    const inserts = db.log.filter((c) => c.sql.startsWith('INSERT INTO schema_migrations'));
    expect(inserts).toHaveLength(3);
    expect(inserts[0]!.params).toEqual([1, 'schema_v1', FIXED_NOW]);
    expect(inserts[1]!.params).toEqual([2, 'settings_google_client_id', FIXED_NOW]);
    expect(inserts[2]!.params).toEqual([3, 'ado_connection_harvest_guid', FIXED_NOW]);
  });

  it('is idempotent — a second run applies nothing', async () => {
    const db = new FakeSqlDatabase();
    await runMigrations(db, MIGRATIONS, fixedNowIso);

    const before = db.log.length;
    const result = await runMigrations(db, MIGRATIONS, fixedNowIso);

    expect(result).toEqual({ applied: [], currentVersion: 3 });
    // only the bootstrap CREATE TABLE + SELECT ran again, no DDL/INSERT re-applied
    const callsSinceSecondRun = db.log.slice(before);
    expect(callsSinceSecondRun.length).toBeGreaterThan(0);
    const insertsSinceSecondRun = callsSinceSecondRun.filter((c) => c.sql.startsWith('INSERT INTO schema_migrations'));
    expect(insertsSinceSecondRun).toHaveLength(0);
  });

  it('applies a synthetic v4 in order on a fresh database (v1, v2, v3, then v4)', async () => {
    const db = new FakeSqlDatabase();
    const v4 = { version: 4, name: 'add_widget', statements: [`CREATE TABLE IF NOT EXISTS widget (id TEXT PRIMARY KEY)`] };

    const result = await runMigrations(db, [...MIGRATIONS, v4], fixedNowIso);

    expect(result).toEqual({ applied: [1, 2, 3, 4], currentVersion: 4 });
    const inserts = db.log.filter((c) => c.sql.startsWith('INSERT INTO schema_migrations'));
    expect(inserts.map((i) => i.params[0])).toEqual([1, 2, 3, 4]);
  });

  it('applies only v2 and v3 on a database that already has v1', async () => {
    const db = new FakeSqlDatabase();
    await runMigrations(db, [MIGRATIONS[0]!], fixedNowIso);

    const result = await runMigrations(db, MIGRATIONS, fixedNowIso);

    expect(result).toEqual({ applied: [2, 3], currentVersion: 3 });
    const alterCalls = db.log.filter((c) => c.sql === 'ALTER TABLE settings ADD COLUMN google_client_id TEXT');
    expect(alterCalls).toHaveLength(1);
    const guidAlterCalls = db.log.filter((c) => c.sql === 'ALTER TABLE ado_connection ADD COLUMN harvest_guid TEXT');
    expect(guidAlterCalls).toHaveLength(1);
  });

  it('applies only v4 on a database that already has v1, v2, v3', async () => {
    const db = new FakeSqlDatabase();
    await runMigrations(db, MIGRATIONS, fixedNowIso);

    const v4 = { version: 4, name: 'add_widget', statements: [`CREATE TABLE IF NOT EXISTS widget (id TEXT PRIMARY KEY)`] };
    const result = await runMigrations(db, [...MIGRATIONS, v4], fixedNowIso);

    expect(result).toEqual({ applied: [4], currentVersion: 4 });
  });

  it('applies migrations in ascending order regardless of input order', async () => {
    const db = new FakeSqlDatabase();
    const v4 = { version: 4, name: 'add_widget', statements: [`CREATE TABLE IF NOT EXISTS widget (id TEXT PRIMARY KEY)`] };

    const result = await runMigrations(db, [v4, ...MIGRATIONS], fixedNowIso);

    expect(result).toEqual({ applied: [1, 2, 3, 4], currentVersion: 4 });
    const inserts = db.log.filter((c) => c.sql.startsWith('INSERT INTO schema_migrations'));
    expect(inserts.map((i) => i.params[0])).toEqual([1, 2, 3, 4]);
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
    it('a fresh database applies v1+v2+v3 and reaches currentVersion 3, with the column present', async () => {
      const db = createInMemoryWasmDatabase(MIGRATIONS);

      // WasmSqlDatabase runs migrations lazily on first use.
      const columns = await db.query<{ name: string }>('PRAGMA table_info(settings)');
      const names = columns.map((c) => c.name);
      expect(names).toContain('google_client_id');

      const versions = await db.query<{ version: number }>('SELECT version FROM schema_migrations ORDER BY version');
      expect(versions.map((v) => v.version)).toEqual([1, 2, 3]);
    });

    it('a database already at v1 applies only v2 and v3 and gains the columns', async () => {
      const v1Only = createInMemoryWasmDatabase([MIGRATIONS[0]!]);
      // Force v1-only initialization.
      await v1Only.query('SELECT 1');
      const columnsBefore = await v1Only.query<{ name: string }>('PRAGMA table_info(settings)');
      expect(columnsBefore.map((c) => c.name)).not.toContain('google_client_id');

      const result = await runMigrations(v1Only, MIGRATIONS, fixedNowIso);

      expect(result).toEqual({ applied: [2, 3], currentVersion: 3 });
      const columnsAfter = await v1Only.query<{ name: string }>('PRAGMA table_info(settings)');
      expect(columnsAfter.map((c) => c.name)).toContain('google_client_id');
      const adoColumnsAfter = await v1Only.query<{ name: string }>('PRAGMA table_info(ado_connection)');
      expect(adoColumnsAfter.map((c) => c.name)).toContain('harvest_guid');
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
