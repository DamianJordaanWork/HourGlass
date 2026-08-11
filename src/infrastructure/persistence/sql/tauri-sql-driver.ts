/**
 * Minimal structural seam over `@tauri-apps/plugin-sql`'s `Database` class —
 * lets `TauriSqlDatabase` be unit-tested with a fake driver in Node, with no
 * Tauri runtime involved. The real `Database` (see
 * `node_modules/@tauri-apps/plugin-sql/dist-js/index.d.ts`) is structurally
 * assignable to this interface:
 *
 *   execute(query: string, bindValues?: unknown[]): Promise<QueryResult>
 *   select<T>(query: string, bindValues?: unknown[]): Promise<T>
 *
 * where `QueryResult = { rowsAffected: number; lastInsertId?: number }`. Note
 * `select<T>` resolves to `T` itself (not `T[]`) — callers instantiate it with
 * an array type, e.g. `driver.select<Row[]>(sql, params)`.
 */
export interface TauriSqlDriver {
  execute(sql: string, params?: unknown[]): Promise<{ rowsAffected: number; lastInsertId?: number }>;
  select<T>(sql: string, params?: unknown[]): Promise<T>;
}
