import { describe, expect, it } from 'vitest';
import { FakeSqlDatabase } from '@test/fake-sql-database';
import { MigrationError, runMigrations } from '@infrastructure/persistence/sql/migration-runner';
import { MIGRATIONS } from '@infrastructure/persistence/sql/migrations';
import { SCHEMA_V1 } from '@infrastructure/persistence/sql/schema';

const FIXED_NOW = '2026-08-11T00:00:00.000Z';
const fixedNowIso = (): string => FIXED_NOW;

describe('runMigrations', () => {
  it('applies v1 against a fresh database', async () => {
    const db = new FakeSqlDatabase();

    const result = await runMigrations(db, MIGRATIONS, fixedNowIso);

    expect(result).toEqual({ applied: [1], currentVersion: 1 });

    // schema_migrations bootstrap table created
    expect(db.log[0]!.sql).toContain('CREATE TABLE IF NOT EXISTS schema_migrations');

    // every SCHEMA_V1 statement was executed
    for (const stmt of SCHEMA_V1) {
      expect(db.log.some((c) => c.sql === stmt)).toBe(true);
    }

    // exactly one INSERT recording version 1
    const inserts = db.log.filter((c) => c.sql.startsWith('INSERT INTO schema_migrations'));
    expect(inserts).toHaveLength(1);
    expect(inserts[0]!.params).toEqual([1, 'schema_v1', FIXED_NOW]);
  });

  it('is idempotent — a second run applies nothing', async () => {
    const db = new FakeSqlDatabase();
    await runMigrations(db, MIGRATIONS, fixedNowIso);

    const before = db.log.length;
    const result = await runMigrations(db, MIGRATIONS, fixedNowIso);

    expect(result).toEqual({ applied: [], currentVersion: 1 });
    // only the bootstrap CREATE TABLE + SELECT ran again, no DDL/INSERT re-applied
    const callsSinceSecondRun = db.log.slice(before);
    expect(callsSinceSecondRun.length).toBeGreaterThan(0);
    const insertsSinceSecondRun = callsSinceSecondRun.filter((c) => c.sql.startsWith('INSERT INTO schema_migrations'));
    expect(insertsSinceSecondRun).toHaveLength(0);
  });

  it('applies a synthetic v2 in order on a fresh database (v1 then v2)', async () => {
    const db = new FakeSqlDatabase();
    const v2 = { version: 2, name: 'add_widget', statements: [`CREATE TABLE IF NOT EXISTS widget (id TEXT PRIMARY KEY)`] };

    const result = await runMigrations(db, [...MIGRATIONS, v2], fixedNowIso);

    expect(result).toEqual({ applied: [1, 2], currentVersion: 2 });
    const inserts = db.log.filter((c) => c.sql.startsWith('INSERT INTO schema_migrations'));
    expect(inserts.map((i) => i.params[0])).toEqual([1, 2]);
  });

  it('applies only v2 on a database that already has v1', async () => {
    const db = new FakeSqlDatabase();
    await runMigrations(db, MIGRATIONS, fixedNowIso);

    const v2 = { version: 2, name: 'add_widget', statements: [`CREATE TABLE IF NOT EXISTS widget (id TEXT PRIMARY KEY)`] };
    const result = await runMigrations(db, [...MIGRATIONS, v2], fixedNowIso);

    expect(result).toEqual({ applied: [2], currentVersion: 2 });
  });

  it('applies migrations in ascending order regardless of input order', async () => {
    const db = new FakeSqlDatabase();
    const v2 = { version: 2, name: 'add_widget', statements: [`CREATE TABLE IF NOT EXISTS widget (id TEXT PRIMARY KEY)`] };

    const result = await runMigrations(db, [v2, ...MIGRATIONS], fixedNowIso);

    expect(result).toEqual({ applied: [1, 2], currentVersion: 2 });
    const inserts = db.log.filter((c) => c.sql.startsWith('INSERT INTO schema_migrations'));
    expect(inserts.map((i) => i.params[0])).toEqual([1, 2]);
  });

  it('throws MigrationError on duplicate versions', async () => {
    const db = new FakeSqlDatabase();
    const dupe = { version: 1, name: 'dupe', statements: [] };

    await expect(runMigrations(db, [...MIGRATIONS, dupe], fixedNowIso)).rejects.toThrow(MigrationError);
  });

  it('throws MigrationError on non-increasing versions supplied out of declaration order', async () => {
    const db = new FakeSqlDatabase();
    // Two distinct migrations sharing the same version number is non-increasing once sorted.
    const a = { version: 2, name: 'a', statements: [] };
    const b = { version: 2, name: 'b', statements: [] };

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
});
