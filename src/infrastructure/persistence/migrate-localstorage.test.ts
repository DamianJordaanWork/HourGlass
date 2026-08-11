import { describe, expect, it } from 'vitest';
import { migrateLocalStorageIntoSql } from '@infrastructure/persistence/migrate-localstorage';
import { createSqlRepositories } from '@infrastructure/persistence/sql-repositories';
import { createInMemoryWasmDatabase } from '@test/wasm-sql-database';
import { MemoryStorage } from '@infrastructure/persistence/local-store';
import { KEY, createLocalRepositories } from '@infrastructure/persistence/local-repositories';
import type { TimeInterval } from '@domain/time/time-interval';

function interval(id: string, date: string): TimeInterval {
  return {
    id,
    date,
    notes: '',
    start: `${date}T09:00:00Z`,
    isManual: false,
    source: 'Manual',
    createdAt: `${date}T09:00:00Z`,
    updatedAt: `${date}T09:00:00Z`,
  };
}

describe('migrateLocalStorageIntoSql', () => {
  it('imports legacy hourglass.* data into the SQL repos exactly once', async () => {
    const storage = new MemoryStorage();
    const legacyRepos = createLocalRepositories(storage);
    await legacyRepos.intervals.upsert(interval('a', '2026-08-11'));
    await legacyRepos.settings.save({ ...(await legacyRepos.settings.get()), weeklyGoalHours: 55 });

    const db = createInMemoryWasmDatabase();
    const sqlRepos = createSqlRepositories(db);

    const ran = await migrateLocalStorageIntoSql(sqlRepos, storage);
    expect(ran).toBe(true);

    expect(await sqlRepos.intervals.get('a')).toEqual(await legacyRepos.intervals.get('a'));
    expect((await sqlRepos.settings.get()).weeklyGoalHours).toBe(55);

    // localStorage data is left intact (fallback store).
    expect(storage.getItem(KEY.intervals)).not.toBeNull();

    // Second run is a no-op.
    const ranAgain = await migrateLocalStorageIntoSql(sqlRepos, storage);
    expect(ranAgain).toBe(false);
  });

  it('does nothing (but sets the guard flag) when there is no legacy data', async () => {
    const storage = new MemoryStorage();
    const db = createInMemoryWasmDatabase();
    const sqlRepos = createSqlRepositories(db);

    const ran = await migrateLocalStorageIntoSql(sqlRepos, storage);
    expect(ran).toBe(false);
    expect(storage.getItem('hourglass.migratedToSqlite')).not.toBeNull();

    const ranAgain = await migrateLocalStorageIntoSql(sqlRepos, storage);
    expect(ranAgain).toBe(false);
  });
});
