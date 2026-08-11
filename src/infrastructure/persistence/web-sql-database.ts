// Browser-only WASM SQLite factory. Keeps the Vite `?url` asset import isolated
// here so Node/Vitest never has to resolve it (see wasm-sql-database.test.ts /
// src/test/wasm-sql-database.ts for the Node path).
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import { WasmSqlDatabase } from '@infrastructure/persistence/sql/wasm-sql-database';
import { idbLoad, idbSave } from '@infrastructure/persistence/sql/indexeddb-store';

const DB_KEY = 'hourglass.db';

/**
 * Creates the browser WASM SQLite database: loads any previously persisted
 * bytes from IndexedDB, and flushes pending saves on tab hide/unload so a
 * debounced save in flight isn't lost.
 */
export async function createWebSqlDatabase(): Promise<WasmSqlDatabase> {
  const db = new WasmSqlDatabase({
    locateFile: () => wasmUrl,
    load: () => idbLoad(DB_KEY),
    save: (bytes) => idbSave(DB_KEY, bytes),
  });

  // Force initialization now (schema/migrations run) so any startup error
  // surfaces here and triggers the localStorage fallback in the caller.
  await db.execute('SELECT 1');

  const flush = () => {
    void db.flush();
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
  window.addEventListener('beforeunload', flush);

  return db;
}
