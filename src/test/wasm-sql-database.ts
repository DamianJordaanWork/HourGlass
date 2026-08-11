import { createRequire } from 'node:module';
import { WasmSqlDatabase } from '@infrastructure/persistence/sql/wasm-sql-database';
import type { Migration } from '@infrastructure/persistence/sql/migrations';

const require = createRequire(import.meta.url);

/**
 * Node/Vitest WASM SQLite factory: no `load`/`save` (pure in-memory), migrated
 * on first use. Mirrors the browser factory's shape without touching the
 * `?url` asset import (that stays isolated in `web-sql-database.ts`).
 */
export function createInMemoryWasmDatabase(migrations?: readonly Migration[]): WasmSqlDatabase {
  return new WasmSqlDatabase({
    locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm'),
    migrations,
  });
}
