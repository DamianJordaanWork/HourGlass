import type { HttpRequest, HttpResponse, IHttpTransport } from '@domain/ports';
import type { TauriFetch } from '@infrastructure/http/tauri-http-driver';
import { HTTP_TIMEOUT_MS, withTimeout } from '@infrastructure/async/with-timeout';

/** Thrown when the injected `TauriFetch` binding itself fails (network/plugin error). */
export class HttpTransportError extends Error {
  constructor(message: string, override readonly cause?: unknown) {
    super(message);
    this.name = 'HttpTransportError';
  }
}

export interface TauriHttpTransportConfig {
  readonly fetchImpl: TauriFetch;
  /** Ceiling on a whole request→body round trip. Defaults to {@link HTTP_TIMEOUT_MS}. */
  readonly timeoutMs?: number;
}

/**
 * `IHttpTransport` backed by `@tauri-apps/plugin-http` (native HTTP via the
 * Tauri desktop shell — no browser CORS). The fetch binding is injected via
 * `fetchImpl` so this class is fully unit-testable with a fake in Node; only
 * `tauri-http-transport-factory.ts` (the real plugin import) is
 * desktop-only/not-run. See ADR-027.
 *
 * Unlike `FetchHttpTransport`, this transport applies NO dev-proxy host
 * rewrites — native requests bypass the browser's CORS entirely, so the
 * Vite proxy workaround isn't needed on desktop.
 */
export class TauriHttpTransport implements IHttpTransport {
  constructor(private readonly config: TauriHttpTransportConfig) {}

  async send(request: HttpRequest): Promise<HttpResponse> {
    const timeoutMs = this.config.timeoutMs ?? HTTP_TIMEOUT_MS;
    try {
      const res = await withTimeout(
        this.config.fetchImpl(request.url, {
          method: request.method,
          headers: request.headers as Record<string, string> | undefined,
          body: request.body,
          // Belt and braces: ask the plugin to bound the connect phase too, so
          // the Rust side gives up rather than leaving an IPC call outstanding.
          connectTimeout: timeoutMs,
        }),
        `HTTP ${request.method} ${request.url}`,
        timeoutMs,
      );

      // `text()` streams the body over repeated IPC reads, so it can stall just
      // like the request itself — it must be bounded and caught, not left bare.
      const body = await withTimeout(res.text(), `HTTP body ${request.url}`, timeoutMs);
      const headers: Record<string, string> = {};
      res.headers.forEach((value, key) => {
        headers[key] = value;
      });
      // Match FetchHttpTransport: non-2xx is returned as a normal response, not thrown.
      return { status: res.status, headers, body };
    } catch (e) {
      throw new HttpTransportError(e instanceof Error ? e.message : 'Tauri HTTP request failed', e);
    }
  }
}
