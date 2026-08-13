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
 * NOTE: the desktop branch needs both the Rust-side `tauri-plugin-sql`
 * registration (F18) AND `sql:allow-execute` in `capabilities/default.json` —
 * the plugin's `sql:default` set grants only load/select/close, so without the
 * extra grant every write (and the opening `PRAGMA`) is denied and the app
 * silently degrades to localStorage. See ADR-031.
 */
export function createRepositories(): { repos: AppRepositories; ready: Promise<void> } {
  if (!isTauri()) return createWebRepositories();

  const backend: Promise<AppRepositories> = (async () => {
    try {
      const db = await createDesktopSqlDatabase();
      return createSqlRepositories(db);
    } catch (e) {
      // Log the raw cause, not just the wrapped message: Tauri rejects with
      // plain strings/objects, and a capability denial is only identifiable
      // from that payload (ADR-031). The `marker` field doubles as proof that
      // the webview is running current frontend code and not a stale bundle.
      const sqlError = e as { message?: string; sql?: string; cause?: unknown };
      console.error(
        '[persistence] Desktop SQLite unavailable — falling back to localStorage',
        JSON.stringify(
          {
            marker: 'ADR-031-diagnostics',
            message: sqlError?.message,
            failingSql: sqlError?.sql,
            causeType: typeof sqlError?.cause,
            cause: sqlError?.cause,
          },
          (_k, v: unknown) => (v instanceof Error ? { name: v.name, message: v.message } : v),
          2,
        ),
        e,
      );
      return createLocalRepositories();
    }
  })();

  const repos = new RepositoriesFacade(backend);
  const ready = backend.then(() => undefined);

  return { repos, ready };
}
