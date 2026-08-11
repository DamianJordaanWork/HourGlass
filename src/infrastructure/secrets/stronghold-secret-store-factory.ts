// desktop-only — not run in this environment; verified by typecheck; runtime pending a Tauri build.
//
// Keeps the `@tauri-apps/plugin-stronghold` + `@tauri-apps/api/path` imports
// isolated here so Node/Vitest never has to resolve/run them.
// `StrongholdSecretStore` itself (memoized ready, encode/decode, error
// translation) is fully unit-tested with a fake `StrongholdVault` — see
// `stronghold-secret-store.test.ts` and ADR-027.
//
// OPEN QUESTION (human-gated): the snapshot password below is a placeholder.
// Stronghold requires the *same* password every time the snapshot is
// (re)loaded, so this needs a durable, user-independent secret (e.g. derived
// from OS keychain / a machine-bound key) — do NOT hardcode a real secret
// here. See ADR-027 open questions.
import { appDataDir } from '@tauri-apps/api/path';
import { Stronghold } from '@tauri-apps/plugin-stronghold';
import type { ISecretStore } from '@domain/ports';
import { StrongholdSecretStore } from '@infrastructure/secrets/stronghold-secret-store';
import type { StrongholdStore, StrongholdVault } from '@infrastructure/secrets/stronghold-vault';

const VAULT_FILE = 'hourglass.vault.hold';
const CLIENT_NAME = 'hourglass';

/**
 * TODO(desktop, human-gated): replace this placeholder with a real,
 * durable password-provenance strategy (see the open question above) before
 * this ships. Never hardcode a real secret.
 */
function getSnapshotPassword(): string {
  return 'hourglass-dev-placeholder-password';
}

export function createStrongholdSecretStore(): ISecretStore {
  return new StrongholdSecretStore({
    loadVault: async (): Promise<StrongholdVault> => {
      const dir = await appDataDir();
      const stronghold = await Stronghold.load(`${dir}/${VAULT_FILE}`, getSnapshotPassword());
      const client = await stronghold.loadClient(CLIENT_NAME).catch(() => stronghold.createClient(CLIENT_NAME));
      const rawStore = client.getStore();

      const store: StrongholdStore = {
        insert: (key, value) => rawStore.insert(key, value),
        get: async (key) => {
          const bytes = await rawStore.get(key);
          return bytes === null ? null : Array.from(bytes);
        },
        remove: async (key) => {
          await rawStore.remove(key);
        },
      };

      return { store, save: () => stronghold.save() };
    },
  });
}
