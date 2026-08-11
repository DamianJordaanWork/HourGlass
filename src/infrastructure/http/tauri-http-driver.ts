/**
 * Minimal structural seam over `@tauri-apps/plugin-http`'s `fetch` — lets
 * `TauriHttpTransport` be unit-tested with a fake fetch in Node, with no Tauri
 * runtime involved. The real `fetch`/`Response` (see
 * `node_modules/@tauri-apps/plugin-http/dist-js/index.d.ts`) is structurally
 * assignable to this narrower shape (we only read `.status`, `.text()`, and
 * iterate `.headers`).
 */
export interface TauriFetchInit {
  readonly method: string;
  readonly headers?: Record<string, string>;
  readonly body?: string;
  readonly connectTimeout?: number;
}

export interface TauriFetchResponse {
  readonly status: number;
  text(): Promise<string>;
  readonly headers: {
    forEach(cb: (value: string, key: string) => void): void;
  };
}

export type TauriFetch = (url: string, init: TauriFetchInit) => Promise<TauriFetchResponse>;
