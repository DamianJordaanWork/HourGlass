import type { HttpRequest, HttpResponse, IHttpTransport } from '@domain/ports';

/** True when running inside the Tauri desktop shell (vs a plain browser). */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** Rewrites an absolute-URL host prefix to a local path (for the dev proxy). */
export interface HostRewrite {
  readonly from: string;
  readonly to: string;
}

/**
 * Browser `fetch`-based transport. Works as-is inside the Tauri webview.
 *
 * CORS CAVEAT: Harvest and Azure DevOps do not send permissive CORS headers, so
 * direct browser calls fail in a plain web build. In `vite dev` we rewrite the
 * known hosts to Vite proxy prefixes (see `vite.config.ts`), which forwards the
 * request server-side (no CORS). On desktop this is replaced by a Tauri HTTP
 * transport (native request) once `@tauri-apps/plugin-http` is wired.
 */
export class FetchHttpTransport implements IHttpTransport {
  constructor(private readonly rewrites: readonly HostRewrite[] = []) {}

  async send(request: HttpRequest): Promise<HttpResponse> {
    const res = await fetch(this.rewriteUrl(request.url), {
      method: request.method,
      headers: request.headers as Record<string, string> | undefined,
      body: request.body,
    });
    const body = await res.text();
    const headers: Record<string, string> = {};
    res.headers.forEach((value, key) => {
      headers[key] = value;
    });
    return { status: res.status, headers, body };
  }

  private rewriteUrl(url: string): string {
    for (const r of this.rewrites) {
      if (url.startsWith(r.from)) return r.to + url.slice(r.from.length);
    }
    return url;
  }
}

/** Known hosts → Vite proxy prefixes. Must match `server.proxy` in vite.config.ts. */
const DEV_PROXY_REWRITES: readonly HostRewrite[] = [
  { from: 'https://api.harvestapp.com', to: '/__harvest' },
  { from: 'https://dev.azure.com', to: '/__ado' },
  { from: 'https://graph.microsoft.com', to: '/__graph' },
  { from: 'https://www.googleapis.com', to: '/__gcal' },
];

/**
 * Pick the transport for the current platform. In the browser dev server we
 * route known hosts through the Vite proxy to sidestep CORS; inside Tauri (and
 * in a future native transport) requests go direct.
 */
export function createHttpTransport(): IHttpTransport {
  // TODO(desktop): return a Tauri HTTP plugin transport when isTauri().
  const useDevProxy = !isTauri() && import.meta.env.DEV;
  return new FetchHttpTransport(useDevProxy ? DEV_PROXY_REWRITES : []);
}
