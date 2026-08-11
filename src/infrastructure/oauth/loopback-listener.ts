/**
 * A single loopback OAuth redirect session: a short-lived local HTTP server
 * bound to an ephemeral port on `127.0.0.1`, used as the `redirect_uri` for a
 * desktop-native authorization-code flow (no popup/postMessage available
 * outside a browser). Injected into `DesktopLoopbackOAuthService` so it can be
 * unit-tested with a fake in Node — the real listener (desktop-only, backed by
 * a pending Tauri plugin — see `desktop-loopback-oauth-service-factory.ts`) is
 * NOT run in this environment.
 */
export interface LoopbackSession {
  /** The dynamic `http://127.0.0.1:<port>/...` redirect URI registered for this session. */
  readonly redirectUri: string;
  /** Resolves with the full callback URL once the provider redirects back here. */
  waitForRedirect(): Promise<string>;
  /** Stops the local server, releasing the port. Safe to call after `waitForRedirect` resolves. */
  cancel(): Promise<void>;
}

export interface LoopbackListener {
  /** Binds an ephemeral local port and starts listening for the OAuth redirect. */
  start(): Promise<LoopbackSession>;
}

/** Opens a URL in the user's default browser (desktop has no same-origin popup to open into). */
export interface UrlOpener {
  open(url: string): Promise<void>;
}
