// desktop-only — not run in this environment; verified by typecheck; runtime pending a Tauri build.
//
// Keeps the `@tauri-apps/plugin-http` import isolated here so Node/Vitest never
// has to resolve/run it. `TauriHttpTransport` itself (constructor, mapping,
// error handling) is fully unit-tested with a fake `TauriFetch` — see
// `tauri-http-transport.test.ts` and ADR-027.
import { TauriHttpTransport } from '@infrastructure/http/tauri-http-transport';
import type { IHttpTransport } from '@domain/ports';

export function createTauriHttpTransport(): IHttpTransport {
  return new TauriHttpTransport({
    fetchImpl: async (url, init) => {
      const { fetch } = await import('@tauri-apps/plugin-http');
      return fetch(url, init);
    },
  });
}
