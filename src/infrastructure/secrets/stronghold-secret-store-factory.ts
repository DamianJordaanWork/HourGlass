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
import { appDataDir, join } from '@tauri-apps/api/path';
import { Stronghold } from '@tauri-apps/plugin-stronghold';
import type { ISecretStore } from '@domain/ports';
import { StrongholdSecretStore } from '@infrastructure/secrets/stronghold-secret-store';
import type { StrongholdStore, StrongholdVault } from '@infrastructure/secrets/stronghold-vault';
import { TimeoutError, withTimeout } from '@infrastructure/async/with-timeout';

const VAULT_FILE = 'hourglass.vault.hold';
const CLIENT_NAME = 'hourglass';
/** Per-IPC-call ceiling; the store's own budget covers the whole load. */
const STEP_TIMEOUT_MS = 8_000;

/**
 * TODO(desktop, human-gated): replace this placeholder with a real,
 * durable password-provenance strategy (see the open question above) before
 * this ships. Never hardcode a real secret.
 */
function getSnapshotPassword(): string {
  return 'hourglass-dev-placeholder-password';
}

/**
 * Loading the vault is five separate IPC round trips, any one of which can
 * stall. Label and time each so a hang names the exact failing call instead of
 * a generic "vault load" (ADR-032) — the log line is what makes the difference
 * between guessing and knowing.
 */
async function step<T>(label: string, work: () => Promise<T>): Promise<T> {
  const startedAt = Date.now();
  try {
    const result = await withTimeout(work(), `Stronghold ${label}`, STEP_TIMEOUT_MS);
    console.info(`[stronghold] ${label} ok in ${Date.now() - startedAt}ms`);
    return result;
  } catch (e) {
    console.error(`[stronghold] ${label} FAILED after ${Date.now() - startedAt}ms`, e);
    throw e;
  }
}

export function createStrongholdSecretStore(): ISecretStore {
  return new StrongholdSecretStore({
    loadVault: async (): Promise<StrongholdVault> => {
      // `join` rather than string concatenation: on Windows `appDataDir()`
      // returns backslashes, so `${dir}/${VAULT_FILE}` yields a mixed-separator
      // path that the Rust side may fail to create — and a failed snapshot
      // write inside the plugin's mutex-guarded command poisons that mutex,
      // after which every stronghold call hangs forever (ADR-032).
      const dir = await step('appDataDir', () => appDataDir());
      const vaultPath = await step('join', () => join(dir, VAULT_FILE));
      console.info(`[stronghold] vault path: ${vaultPath}`);

      // `initialize` derives the key and, if a snapshot already exists, reads
      // it. A snapshot left truncated by an interrupted write makes
      // iota_stronghold's reader spin forever rather than return an error —
      // reproduced in isolation: a corrupt file hung indefinitely where a fresh
      // path completed in ~80ms (ADR-032). Nothing app-side can recover from
      // that, so name the file and the remedy instead of just timing out.
      const stronghold = await step('Stronghold.load (initialize)', () =>
        Stronghold.load(vaultPath, getSnapshotPassword()),
      ).catch((e: unknown) => {
        if (e instanceof TimeoutError) {
          throw new Error(
            `The Stronghold vault at ${vaultPath} could not be opened and did not fail cleanly — the snapshot is most likely corrupt (an interrupted write leaves the reader spinning forever). Move that file and any "${VAULT_FILE}.<hex>" siblings out of the way and restart; a fresh vault will be created and you'll need to re-enter your Harvest/ADO tokens.`,
            { cause: e },
          );
        }
        throw e;
      });

      const client = await step('loadClient/createClient', async () => {
        try {
          return await stronghold.loadClient(CLIENT_NAME);
        } catch {
          // First run: no client in the snapshot yet.
          return await stronghold.createClient(CLIENT_NAME);
        }
      });
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
