import { describe, expect, it } from 'vitest';
import { SecretStoreError, StrongholdSecretStore } from '@infrastructure/secrets/stronghold-secret-store';
import type { StrongholdVault } from '@infrastructure/secrets/stronghold-vault';

function createFakeVault(): StrongholdVault {
  const data = new Map<string, number[]>();
  return {
    store: {
      insert: async (key, value) => {
        data.set(key, value);
      },
      get: async (key) => data.get(key) ?? null,
      remove: async (key) => {
        data.delete(key);
      },
    },
    save: async () => {
      // no-op
    },
  };
}

describe('StrongholdSecretStore', () => {
  it('round-trips a value, including multi-byte UTF-8', async () => {
    let loadCount = 0;
    const vault = createFakeVault();
    const store = new StrongholdSecretStore({
      loadVault: async () => {
        loadCount += 1;
        return vault;
      },
    });

    await store.set('harvest.token', 'héllo wörld 日本語');
    const value = await store.get('harvest.token');

    expect(value).toBe('héllo wörld 日本語');
    expect(loadCount).toBe(1);
  });

  it('returns null for a missing key', async () => {
    const vault = createFakeVault();
    const store = new StrongholdSecretStore({ loadVault: async () => vault });

    expect(await store.get('missing')).toBeNull();
  });

  it('delete removes the key', async () => {
    const vault = createFakeVault();
    const store = new StrongholdSecretStore({ loadVault: async () => vault });

    await store.set('k', 'v');
    await store.delete('k');

    expect(await store.get('k')).toBeNull();
  });

  it('calls vault.save() after set and after delete', async () => {
    let saveCalls = 0;
    const data = new Map<string, number[]>();
    const vault: StrongholdVault = {
      store: {
        insert: async (key, value) => {
          data.set(key, value);
        },
        get: async (key) => data.get(key) ?? null,
        remove: async (key) => {
          data.delete(key);
        },
      },
      save: async () => {
        saveCalls += 1;
      },
    };
    const store = new StrongholdSecretStore({ loadVault: async () => vault });

    await store.set('k', 'v');
    expect(saveCalls).toBe(1);

    await store.delete('k');
    expect(saveCalls).toBe(2);
  });

  it('memoizes loadVault across multiple calls', async () => {
    let loadCount = 0;
    const vault = createFakeVault();
    const store = new StrongholdSecretStore({
      loadVault: async () => {
        loadCount += 1;
        return vault;
      },
    });

    await store.set('a', '1');
    await store.get('a');
    await store.delete('a');

    expect(loadCount).toBe(1);
  });

  it('wraps a throwing vault loader in SecretStoreError', async () => {
    const store = new StrongholdSecretStore({
      loadVault: async () => {
        throw new Error('vault locked');
      },
    });

    await expect(store.get('k')).rejects.toBeInstanceOf(SecretStoreError);
    await expect(store.get('k')).rejects.toThrow('vault locked');
  });

  it('wraps a throwing store operation in SecretStoreError', async () => {
    const vault: StrongholdVault = {
      store: {
        insert: async () => {
          throw new Error('insert failed');
        },
        get: async () => null,
        remove: async () => {
          // no-op
        },
      },
      save: async () => {
        // no-op
      },
    };
    const store = new StrongholdSecretStore({ loadVault: async () => vault });

    await expect(store.set('k', 'v')).rejects.toBeInstanceOf(SecretStoreError);
  });
});
