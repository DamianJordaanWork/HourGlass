import type { ISecretStore } from '@domain/ports';
import { isTauri } from '@infrastructure/http/http-transport';
import { LocalSecretStore } from '@infrastructure/secrets/local-secret-store';
import { createStrongholdSecretStore } from '@infrastructure/secrets/stronghold-secret-store-factory';

/**
 * Single platform switch for secret storage (mirrors `createRepositories` /
 * `createHttpTransport`, see ADR-027). Desktop (isTauri()): hardware-encrypted
 * Stronghold vault. Web/dev: `localStorage`-backed `LocalSecretStore`.
 */
export function createSecretStore(): ISecretStore {
  if (isTauri()) return createStrongholdSecretStore();
  return new LocalSecretStore();
}
