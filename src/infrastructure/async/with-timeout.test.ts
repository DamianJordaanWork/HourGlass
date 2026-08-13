import { describe, expect, it, vi } from 'vitest';
import { healingMemo, TimeoutError, withTimeout } from '@infrastructure/async/with-timeout';

const never = <T,>(): Promise<T> => new Promise<T>(() => {});

describe('withTimeout', () => {
  it('passes through a value that resolves in time', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 'work', 1000)).resolves.toBe('ok');
  });

  it('rejects a promise that never settles — the desktop hang case', async () => {
    const promise = withTimeout(never<string>(), 'Stronghold vault load', 10);
    await expect(promise).rejects.toBeInstanceOf(TimeoutError);
    await expect(promise).rejects.toThrow(/Stronghold vault load did not respond within 10ms/);
  });

  it('points at the likely cause so the failure is diagnosable', async () => {
    await expect(withTimeout(never(), 'x', 5)).rejects.toThrow(/Rust panic/);
  });

  it('preserves the original rejection rather than masking it as a timeout', async () => {
    const boom = new Error('real failure');
    await expect(withTimeout(Promise.reject(boom), 'work', 1000)).rejects.toBe(boom);
  });

  it('wraps a non-Error rejection', async () => {
    await expect(withTimeout(Promise.reject('a string'), 'work', 1000)).rejects.toThrow('a string');
  });

  it('clears its timer on success, so it never keeps the process alive', async () => {
    const clear = vi.spyOn(globalThis, 'clearTimeout');
    await withTimeout(Promise.resolve(1), 'work', 1000);
    expect(clear).toHaveBeenCalled();
    clear.mockRestore();
  });

  it('is a no-op for a non-positive or infinite budget', async () => {
    await expect(withTimeout(Promise.resolve(2), 'work', 0)).resolves.toBe(2);
    await expect(withTimeout(Promise.resolve(3), 'work', Number.POSITIVE_INFINITY)).resolves.toBe(3);
  });
});

describe('healingMemo', () => {
  it('initializes once and shares the result', async () => {
    const init = vi.fn(async () => 'vault');
    const ensure = healingMemo(init, 'load', 1000);
    await expect(Promise.all([ensure(), ensure()])).resolves.toEqual(['vault', 'vault']);
    expect(init).toHaveBeenCalledTimes(1);
  });

  it('retries after a failure instead of caching it forever', async () => {
    let attempt = 0;
    const ensure = healingMemo(
      async () => {
        attempt += 1;
        if (attempt === 1) throw new Error('first attempt failed');
        return 'vault';
      },
      'load',
      1000,
    );

    await expect(ensure()).rejects.toThrow('first attempt failed');
    // The old plain-memo idiom would have replayed the same rejection here.
    await expect(ensure()).resolves.toBe('vault');
    expect(attempt).toBe(2);
  });

  it('recovers after a stall — the case that used to need an app restart', async () => {
    let attempt = 0;
    const ensure = healingMemo(
      async () => {
        attempt += 1;
        if (attempt === 1) return never<string>();
        return 'vault';
      },
      'Stronghold vault load',
      10,
    );

    await expect(ensure()).rejects.toBeInstanceOf(TimeoutError);
    await expect(ensure()).resolves.toBe('vault');
  });
});
