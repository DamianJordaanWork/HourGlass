import type { ISecretStore } from '@domain/ports';
import type { StrongholdVault } from '@infrastructure/secrets/stronghold-vault';
import { healingMemo, IPC_TIMEOUT_MS, withTimeout } from '@infrastructure/async/with-timeout';

/** Thrown when the injected Stronghold vault binding fails (load, insert, get, remove, save). */
export class SecretStoreError extends Error {
  constructor(message: string, override readonly cause?: unknown) {
    super(message);
    this.name = 'SecretStoreError';
  }
}

export interface StrongholdSecretStoreConfig {
  /** Obtains the loaded vault (deferred so construction stays synchronous/side-effect-free). */
  readonly loadVault: () => Promise<StrongholdVault>;
  /** Ceiling on each vault IPC call. Defaults to {@link IPC_TIMEOUT_MS}. */
  readonly timeoutMs?: number;
}

/**
 * `ISecretStore` backed by `@tauri-apps/plugin-stronghold` (an OS-keychain-
 * adjacent, hardware-encrypted secret vault on desktop). The vault itself is
 * injected via `loadVault` so this class — including UTF-8 encode/decode and
 * error translation — is fully unit-testable with a fake vault in Node; only
 * `stronghold-secret-store-factory.ts` (the real plugin binding + password) is
 * desktop-only/not-run. See ADR-027.
 */
export class StrongholdSecretStore implements ISecretStore {
  private readonly timeoutMs: number;
  /**
   * Healing memo, not a plain one: a stalled or failed vault load is discarded
   * so the next call retries. Previously one bad load left every future
   * `get`/`set` awaiting the same pending promise — meaning a single hung
   * `plugin:stronghold|initialize` bricked all secret I/O until an app restart,
   * and clicking Save again could never recover (ADR-032).
   */
  private readonly ensureReady: () => Promise<StrongholdVault>;

  constructor(config: StrongholdSecretStoreConfig) {
    this.timeoutMs = config.timeoutMs ?? IPC_TIMEOUT_MS;
    this.ensureReady = healingMemo(
      async () => {
        try {
          return await config.loadVault();
        } catch (e) {
          throw new SecretStoreError(e instanceof Error ? e.message : 'Failed to load Stronghold vault', e);
        }
      },
      'Stronghold vault load',
      // Generous: the load is several IPC calls, each individually bounded by
      // the factory. The inner per-step timeout should win and name the exact
      // failing call, so this outer one is only a last-resort backstop.
      this.timeoutMs * 6,
    );
  }

  /** Bound one vault call and normalize any failure to `SecretStoreError`. */
  private async step<T>(label: string, work: () => Promise<T>): Promise<T> {
    try {
      return await withTimeout(work(), `Stronghold ${label}`, this.timeoutMs);
    } catch (e) {
      if (e instanceof SecretStoreError) throw e;
      throw new SecretStoreError(e instanceof Error ? e.message : `Stronghold ${label} failed`, e);
    }
  }

  async get(key: string): Promise<string | null> {
    const vault = await this.ensureReady();
    const bytes = await this.step('get', () => vault.store.get(key));
    if (bytes === null) return null;
    return new TextDecoder().decode(Uint8Array.from(bytes));
  }

  async set(key: string, value: string): Promise<void> {
    const vault = await this.ensureReady();
    const bytes = Array.from(new TextEncoder().encode(value));
    await this.step('set', () => vault.store.insert(key, bytes));
    await this.step('save', () => vault.save());
  }

  async delete(key: string): Promise<void> {
    const vault = await this.ensureReady();
    await this.step('delete', () => vault.store.remove(key));
    await this.step('save', () => vault.save());
  }
}
