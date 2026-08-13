/**
 * Timeouts for calls that can stall indefinitely.
 *
 * Every desktop adapter bottoms out in a Tauri `invoke()`, which is a promise
 * resolved only from an IPC callback — if the Rust side never replies (most
 * often because a command panicked, which is invisible to the webview console)
 * the promise stays pending forever. Awaiting one of those inside a TanStack
 * mutation means a button sits on "Saving…" with no error, ever (ADR-032).
 *
 * A timeout converts that silent stall into a diagnosable failure.
 */

export class TimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(label: string, timeoutMs: number) {
    super(
      `${label} did not respond within ${timeoutMs}ms. On desktop this usually means the Tauri command never replied — check the terminal running \`tauri dev\` for a Rust panic.`,
    );
    this.name = 'TimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

/** Default ceiling for a local IPC round trip (SQLite, secret vault, path lookup). */
export const IPC_TIMEOUT_MS = 10_000;
/** Default ceiling for a remote HTTP call (Harvest/ADO/calendar). */
export const HTTP_TIMEOUT_MS = 30_000;

/**
 * Reject with a {@link TimeoutError} if `work` hasn't settled within `ms`.
 *
 * The underlying work is NOT cancelled — it can't be, for an in-flight IPC
 * call — so this bounds how long a *caller* waits, not how long the operation
 * runs. Rejections and the timer are both cleaned up so nothing leaks.
 */
export function withTimeout<T>(work: Promise<T>, label: string, ms: number = IPC_TIMEOUT_MS): Promise<T> {
  if (!Number.isFinite(ms) || ms <= 0) return work;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(label, ms)), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

/**
 * A memoized async initializer that **heals**: a failed (or timed-out) attempt
 * is discarded so the next call retries, instead of every future caller
 * awaiting the same poisoned promise for the life of the process.
 *
 * The plain `if (!this.ready) this.ready = init()` idiom this replaces had the
 * opposite behaviour — one stalled vault load bricked all secret I/O until an
 * app restart, and no amount of clicking Save could recover it.
 */
export function healingMemo<T>(init: () => Promise<T>, label: string, ms: number = IPC_TIMEOUT_MS): () => Promise<T> {
  let pending: Promise<T> | undefined;
  return () => {
    if (!pending) {
      pending = withTimeout(init(), label, ms).catch((e: unknown) => {
        pending = undefined; // let the next caller try again
        throw e;
      });
    }
    return pending;
  };
}
