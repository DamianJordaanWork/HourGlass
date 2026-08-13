import { describe, expect, it } from 'vitest';
import { driverErrorMessage, SqlError } from '@infrastructure/persistence/sql/sql-error';

describe('driverErrorMessage', () => {
  it('uses an Error message', () => {
    expect(driverErrorMessage(new Error('boom'), 'fallback')).toBe('boom');
  });

  it('surfaces a bare string rejection — how Tauri invoke reports capability denials', () => {
    const denial = 'sql.execute not allowed. Permissions associated with this command: sql:allow-execute';
    expect(driverErrorMessage(denial, 'tauri-sql execute failed')).toBe(denial);
  });

  it('reads a message property off a plain object', () => {
    expect(driverErrorMessage({ message: 'nope' }, 'fallback')).toBe('nope');
  });

  it('serializes an opaque object rather than dropping it', () => {
    expect(driverErrorMessage({ code: 5 }, 'fallback')).toBe('fallback: {"code":5}');
  });

  it('falls back for empty or non-informative values', () => {
    expect(driverErrorMessage('   ', 'fallback')).toBe('fallback');
    expect(driverErrorMessage(undefined, 'fallback')).toBe('fallback');
    expect(driverErrorMessage(null, 'fallback')).toBe('fallback');
  });

  it('keeps the original cause on SqlError for debugging', () => {
    const cause = 'raw rejection';
    const err = new SqlError(driverErrorMessage(cause, 'fallback'), 'PRAGMA foreign_keys = ON', cause);
    expect(err.message).toBe('raw rejection');
    expect(err.sql).toBe('PRAGMA foreign_keys = ON');
    expect(err.cause).toBe(cause);
  });
});
