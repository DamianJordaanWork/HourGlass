/**
 * Minimal structural seam over `@tauri-apps/plugin-stronghold`'s `Store` +
 * `Stronghold` classes — lets `StrongholdSecretStore` be unit-tested with a
 * fake in-memory vault in Node, with no Tauri runtime involved. The real
 * `Store` (see `node_modules/@tauri-apps/plugin-stronghold/dist-js/index.d.ts`)
 * returns `Uint8Array | null` from `get`; the factory converts that to
 * `number[] | null` to keep this seam free of typed-array quirks in tests.
 */
export interface StrongholdStore {
  insert(key: string, value: number[]): Promise<void>;
  get(key: string): Promise<number[] | null>;
  remove(key: string): Promise<void>;
}

export interface StrongholdVault {
  readonly store: StrongholdStore;
  /** Persists the stronghold state to its on-disk snapshot. */
  save(): Promise<void>;
}
