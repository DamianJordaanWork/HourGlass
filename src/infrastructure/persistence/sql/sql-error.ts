/** Wraps any driver-level failure (sql.js / Tauri SQL plugin) so callers only ever catch one type. */
export class SqlError extends Error {
  readonly sql: string;
  override readonly cause?: unknown;

  constructor(message: string, sql: string, cause?: unknown) {
    super(message);
    this.name = 'SqlError';
    this.sql = sql;
    this.cause = cause;
  }
}
