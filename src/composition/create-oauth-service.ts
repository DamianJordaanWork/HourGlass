import type { IHttpTransport, IOAuthService } from '@domain/ports';
import { isTauri } from '@infrastructure/http/http-transport';
import { WebRedirectOAuthService } from '@infrastructure/oauth/web-redirect-oauth-service';
import { createDesktopLoopbackOAuthService } from '@infrastructure/oauth/desktop-loopback-oauth-service-factory';

/**
 * Single platform switch for OAuth (mirrors `createRepositories` /
 * `createHttpTransport` / `createSecretStore`, see ADR-027). Desktop
 * (isTauri()): loopback listener + system browser (binding pending — see
 * `desktop-loopback-oauth-service-factory.ts`). Web/dev: popup +
 * `postMessage` via `WebRedirectOAuthService`.
 */
export function createOAuthService(transport: IHttpTransport): IOAuthService {
  if (isTauri()) return createDesktopLoopbackOAuthService(transport);
  return new WebRedirectOAuthService();
}
