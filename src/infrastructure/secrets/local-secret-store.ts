import type { ISecretStore } from '@domain/ports';
import { defaultStorage, type StorageLike } from '@infrastructure/persistence/local-store';

const PREFIX = 'hourglass.secret.';

/**
 * Web/dev secret store backed by the same StorageLike as the repositories
 * (localStorage in the browser + Tauri webview, in-memory in tests).
 *
 * NOTE: this is NOT hardware-backed. On desktop the intended production store is
 * the OS keychain via `tauri-plugin-stronghold`; this adapter is swapped in
 * composition once that plugin is wired. Kept behind {@link ISecretStore} so the
 * swap touches nothing else.
 */
export class LocalSecretStore implements ISecretStore {
  constructor(private readonly storage: StorageLike = defaultStorage()) {}

  async get(key: string): Promise<string | null> {
    return this.storage.getItem(PREFIX + key);
  }

  async set(key: string, value: string): Promise<void> {
    this.storage.setItem(PREFIX + key, value);
  }

  async delete(key: string): Promise<void> {
    this.storage.removeItem(PREFIX + key);
  }
}
