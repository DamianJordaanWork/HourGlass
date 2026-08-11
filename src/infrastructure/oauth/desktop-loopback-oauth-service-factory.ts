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
// `DesktopLoopbackOAuthService` here. Until then this factory throws at call
// time rather than at import time, so typecheck stays green without an
// unconfirmed import.
import type { IHttpTransport, IOAuthService } from '@domain/ports';

export function createDesktopLoopbackOAuthService(_transport: IHttpTransport): IOAuthService {
  throw new Error('desktop loopback OAuth binding pending — see F17 open question');
}
