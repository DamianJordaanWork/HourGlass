import type { AppRepositories } from '@infrastructure/persistence/app-repositories';
import { RepositoriesFacade } from '@infrastructure/persistence/app-repositories';
import { createSqlRepositories } from '@infrastructure/persistence/sql-repositories';
import { createDesktopSqlDatabase } from '@infrastructure/persistence/desktop-sql-database';
import { createLocalRepositories } from '@infrastructure/persistence/local-repositories';
import { createWebRepositories } from '@infrastructure/persistence/create-web-repositories';
import { isTauri } from '@infrastructure/http/http-transport';

/**
 * Single platform switch for persistence composition (F4 seam, now wired).
 * Desktop (isTauri()): native SQLite via `@tauri-apps/plugin-sql`
 * (`createDesktopSqlDatabase`) wired through the same `createSqlRepositories`
 * used on web, falling back to the localStorage repos on failure — no
 * one-time localStorage *import* here, since that migration is web-only (a
 * fresh desktop install has no prior localStorage data to import). Web:
 * delegates unchanged to `createWebRepositories()` (WASM SQLite + localStorage
 * fallback + one-time import). Both branches return a `RepositoriesFacade`
 * usable immediately, plus a `ready` promise.
 *
 * NOTE: the desktop branch is not yet exercised at runtime — it requires a
 * Tauri desktop build with the Rust-side `tauri-plugin-sql` registered (F18).
 */
export function createRepositories(): { repos: AppRepositories; ready: Promise<void> } {
  if (!isTauri()) return createWebRepositories();

  const backend: Promise<AppRepositories> = (async () => {
    try {
      const db = await createDesktopSqlDatabase();
      return createSqlRepositories(db);
    } catch (e) {
      console.error('[persistence] Desktop SQLite unavailable — falling back to localStorage', e);
      return createLocalRepositories();
    }
  })();

  const repos = new RepositoriesFacade(backend);
  const ready = backend.then(() => undefined);

  return { repos, ready };
}
