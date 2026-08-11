// Desktop-only factory. Keeps the `@tauri-apps/plugin-sql` import isolated
// here so Node/Vitest never has to resolve/run it — this file requires the
// Tauri desktop shell (and the Rust-side plugin registration from F18) and is
// NOT exercised by any test in this repo; see ADR-015.
import { TauriSqlDatabase } from '@infrastructure/persistence/sql/tauri-sql-database';
import type { TauriSqlDriver } from '@infrastructure/persistence/sql/tauri-sql-driver';

const DB_PATH = 'sqlite:hourglass.db';

/**
 * Creates the desktop SQLite database: connects via the Tauri SQL plugin,
 * runs `PRAGMA foreign_keys=ON` + migrations, and returns a ready
 * `TauriSqlDatabase`. NOT YET RUN — requires a Tauri desktop build with the
 * `tauri-plugin-sql` Rust plugin registered (F18).
 */
export async function createDesktopSqlDatabase(): Promise<TauriSqlDatabase> {
  const db = new TauriSqlDatabase({
    loadDriver: async (): Promise<TauriSqlDriver> => {
      const Database = (await import('@tauri-apps/plugin-sql')).default;
      return Database.load(DB_PATH);
    },
  });

  // Force initialization now (schema/migrations run) so any startup error
  // surfaces here and triggers the localStorage fallback in the caller.
  await db.execute('SELECT 1');

  return db;
}
