// desktop-only — not run in this environment; verified by typecheck; runtime pending a Tauri build.
//
// OPEN QUESTION (human-gated): the desktop OAuth loopback plugin package is
// UNCONFIRMED at time of writing. `DesktopLoopbackOAuthService` + the
// `LoopbackListener`/`UrlOpener` seams are fully implemented and unit-tested
// with fakes (see `desktop-loopback-oauth-service.test.ts`), but this factory
// cannot yet wire a real `LoopbackListener` without guessing a package name —
// per instructions we do NOT install/import an unconfirmed dependency.
//
// TODO(desktop): once a loopback-capable plugin is confirmed (candidate:
// `tauri-plugin-oauth`, a community plugin that runs a local HTTP server and
// emits the redirect URL — NOT yet added to package.json), implement a real
// `LoopbackListener` over it (start a local server, resolve `waitForRedirect`
// from its callback event/promise, `cancel` to stop the server) plus a
// `UrlOpener` (e.g. `@tauri-apps/plugin-opener`'s `open`), and construct
// `DesktopLoopbackOAuthService` here with those real bindings in place of the
// pending ones below.
//
// IMPORTANT (see ADR-027 clarification): the composition root
// (`container.ts`) builds this factory's return value EAGERLY at container
// construction time (which itself runs at module import time, in
// `container-context.tsx`). A synchronous throw here previously aborted
// container construction entirely, blanking the whole desktop webview before
// React could ever mount — even for users who never touch calendar OAuth. So
// this factory must NEVER throw synchronously; it always returns a working
// `DesktopLoopbackOAuthService`, and the "binding pending" failure is deferred
// to when the service is actually invoked (i.e. `authorize()`, which calls
// `listener.start()` before anything else). `refresh()` does not use the
// listener/opener and is unaffected, but is not truly usable without a prior
// `authorize()` anyway.
import type { IHttpTransport, IOAuthService } from '@domain/ports';
import { DesktopLoopbackOAuthService } from '@infrastructure/oauth/desktop-loopback-oauth-service';
import type { LoopbackListener, UrlOpener } from '@infrastructure/oauth/loopback-listener';

const PENDING_ERROR_MESSAGE =
  'Desktop loopback OAuth is not yet wired — pending an OAuth loopback plugin (F17)';

/** Rejects only when `start()` is actually invoked — never at construction. */
const pendingLoopbackListener: LoopbackListener = {
  start(): Promise<never> {
    return Promise.reject(new Error(PENDING_ERROR_MESSAGE));
  },
};

/** Rejects only when `open()` is actually invoked — never at construction. */
const pendingUrlOpener: UrlOpener = {
  open(): Promise<never> {
    return Promise.reject(new Error(PENDING_ERROR_MESSAGE));
  },
};

export function createDesktopLoopbackOAuthService(transport: IHttpTransport): IOAuthService {
  return new DesktopLoopbackOAuthService({
    transport,
    listener: pendingLoopbackListener,
    opener: pendingUrlOpener,
  });
}
