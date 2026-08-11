import type { IHttpTransport, IOAuthService, OAuthConfig, TokenSet } from '@domain/ports';
import { generatePkcePair, generateState } from './pkce';
import { toTokenSet, type TokenResponseDto } from './oauth-token';
import type { LoopbackListener, UrlOpener } from './loopback-listener';

/** Typed error for the desktop loopback OAuth flow (authorize + token exchange). */
export class OAuthError extends Error {
  constructor(message: string, override readonly cause?: unknown) {
    super(message);
    this.name = 'OAuthError';
  }
}

export interface DesktopLoopbackOAuthServiceConfig {
  readonly transport: IHttpTransport;
  readonly listener: LoopbackListener;
  readonly opener: UrlOpener;
}

/**
 * Desktop-platform `IOAuthService`: starts a local loopback HTTP listener on
 * an ephemeral port, opens the provider's authorize page in the system
 * browser (via `UrlOpener`) with `redirect_uri` overridden to the loopback
 * session's dynamic URI, waits for the redirect back to localhost, then
 * exchanges the code for tokens via the injected `IHttpTransport` (native
 * Tauri HTTP — no browser CORS involved). Mirrors `WebRedirectOAuthService`'s
 * PKCE + token-exchange shape but swaps popup/postMessage for a loopback
 * listener + opener, and `fetch` for `IHttpTransport`. See ADR-027.
 */
export class DesktopLoopbackOAuthService implements IOAuthService {
  constructor(private readonly config: DesktopLoopbackOAuthServiceConfig) {}

  async authorize(config: OAuthConfig): Promise<TokenSet> {
    const { verifier, challenge } = await generatePkcePair();
    const state = generateState();
    const session = await this.config.listener.start();

    const params = new URLSearchParams({
      client_id: config.clientId,
      response_type: 'code',
      redirect_uri: session.redirectUri,
      scope: config.scopes.join(' '),
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      ...config.extraAuthParams,
    });

    await this.config.opener.open(`${config.authorizeUrl}?${params.toString()}`);

    const redirectUrl = await session.waitForRedirect();
    const url = new URL(redirectUrl);
    const errorParam = url.searchParams.get('error');
    const returnedState = url.searchParams.get('state');
    const code = url.searchParams.get('code');

    if (errorParam) {
      await session.cancel();
      throw new OAuthError(`OAuth authorize failed: ${errorParam}`);
    }
    if (returnedState !== state) {
      await session.cancel();
      throw new OAuthError('OAuth state mismatch');
    }
    await session.cancel();
    if (!code) throw new OAuthError('OAuth callback missing code');

    return this.exchangeCode(config, code, verifier, session.redirectUri);
  }

  async refresh(config: OAuthConfig, refreshToken: string): Promise<TokenSet> {
    const body = new URLSearchParams({
      client_id: config.clientId,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      scope: config.scopes.join(' '),
    });
    return this.postToken(config.tokenUrl, body);
  }

  private async exchangeCode(config: OAuthConfig, code: string, verifier: string, redirectUri: string): Promise<TokenSet> {
    const body = new URLSearchParams({
      client_id: config.clientId,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    });
    return this.postToken(config.tokenUrl, body);
  }

  private async postToken(tokenUrl: string, body: URLSearchParams): Promise<TokenSet> {
    const res = await this.config.transport.send({
      method: 'POST',
      url: tokenUrl,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (res.status < 200 || res.status >= 300) {
      throw new OAuthError(`OAuth token request failed (${res.status}): ${res.body}`);
    }
    return toTokenSet(JSON.parse(res.body) as TokenResponseDto);
  }
}
