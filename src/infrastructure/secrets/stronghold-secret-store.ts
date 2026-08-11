import type { ISecretStore } from '@domain/ports';
import type { StrongholdVault } from '@infrastructure/secrets/stronghold-vault';

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
  private ready: Promise<StrongholdVault> | undefined;

  constructor(private readonly config: StrongholdSecretStoreConfig) {}

  private ensureReady(): Promise<StrongholdVault> {
    if (!this.ready) {
      this.ready = this.config.loadVault().catch((e) => {
        throw new SecretStoreError(e instanceof Error ? e.message : 'Failed to load Stronghold vault', e);
      });
    }
    return this.ready;
  }

  async get(key: string): Promise<string | null> {
    const vault = await this.ensureReady();
    try {
      const bytes = await vault.store.get(key);
      if (bytes === null) return null;
      return new TextDecoder().decode(Uint8Array.from(bytes));
    } catch (e) {
      if (e instanceof SecretStoreError) throw e;
      throw new SecretStoreError(e instanceof Error ? e.message : 'Stronghold get failed', e);
    }
  }

  async set(key: string, value: string): Promise<void> {
    const vault = await this.ensureReady();
    try {
      const bytes = Array.from(new TextEncoder().encode(value));
      await vault.store.insert(key, bytes);
      await vault.save();
    } catch (e) {
      if (e instanceof SecretStoreError) throw e;
      throw new SecretStoreError(e instanceof Error ? e.message : 'Stronghold set failed', e);
    }
  }

  async delete(key: string): Promise<void> {
    const vault = await this.ensureReady();
    try {
      await vault.store.remove(key);
      await vault.save();
    } catch (e) {
      if (e instanceof SecretStoreError) throw e;
      throw new SecretStoreError(e instanceof Error ? e.message : 'Stronghold delete failed', e);
    }
  }
}
