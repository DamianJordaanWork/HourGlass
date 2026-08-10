/**
 * Infrastructure-boundary port for a positional-parameter SQL database. No
 * concrete driver here (Tauri SQL plugin / sql.js WASM implement this in a
 * later slice) — this file exists purely to give infra code (migrations,
 * future SQL repos) a stable, testable seam. See ADR-013.
 */

export type SqlParam = string | number | boolean | null;

export interface SqlExecuteResult {
  readonly rowsAffected: number;
  readonly lastInsertId?: number;
}

export interface ISqlExecutor {
  execute(sql: string, params?: readonly SqlParam[]): Promise<SqlExecuteResult>;
  query<T>(sql: string, params?: readonly SqlParam[]): Promise<readonly T[]>;
}

export interface ISqlDatabase extends ISqlExecutor {
  transaction<T>(work: (tx: ISqlExecutor) => Promise<T>): Promise<T>;
}
