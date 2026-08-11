import type { AppRepositories } from '@infrastructure/persistence/app-repositories';
import { RepositoriesFacade } from '@infrastructure/persistence/app-repositories';
import { createSqlRepositories } from '@infrastructure/persistence/sql-repositories';
import { createWebSqlDatabase } from '@infrastructure/persistence/web-sql-database';
import { migrateLocalStorageIntoSql } from '@infrastructure/persistence/migrate-localstorage';
import { createLocalRepositories } from '@infrastructure/persistence/local-repositories';

/**
 * Web composition entry point for persistence. Prefers WASM SQLite (IndexedDB-
 * backed); falls back to the localStorage repos if sql.js/WASM can't load in
 * this environment. `repos` is usable immediately (proxies the async backend);
 * `ready` resolves once the backend — and, for SQLite, the one-time
 * localStorage import — has settled.
 */
export function createWebRepositories(): { repos: AppRepositories; ready: Promise<void> } {
  const backend: Promise<AppRepositories> = (async () => {
    try {
      const db = await createWebSqlDatabase();
      const sqlRepos = createSqlRepositories(db);
      await migrateLocalStorageIntoSql(sqlRepos);
      return sqlRepos;
    } catch (e) {
      console.error('[persistence] WASM SQLite unavailable — falling back to localStorage', e);
      return createLocalRepositories();
    }
  })();

  const repos = new RepositoriesFacade(backend);
  const ready = backend.then(() => undefined);

  return { repos, ready };
}
