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

/**
 * Best-effort message for a driver rejection. Tauri's `invoke` rejects with a
 * plain **string** (e.g. a capability denial like "sql.execute not allowed"),
 * not an `Error` — reporting only `fallback` in that case throws away the one
 * piece of information that explains the failure.
 */
export function driverErrorMessage(cause: unknown, fallback: string): string {
  if (cause instanceof Error) return cause.message;
  if (typeof cause === 'string' && cause.trim() !== '') return cause;
  if (cause !== null && typeof cause === 'object') {
    const message = (cause as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim() !== '') return message;
    try {
      return `${fallback}: ${JSON.stringify(cause)}`;
    } catch {
      return fallback;
    }
  }
  return fallback;
}
