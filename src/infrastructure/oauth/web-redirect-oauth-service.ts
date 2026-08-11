import type { IOAuthService, OAuthConfig, TokenSet } from '@domain/ports';
import { generatePkcePair, generateState } from './pkce';
import { toTokenSet, type TokenResponseDto } from './oauth-token';

interface OAuthCallbackMessage {
  readonly type: 'hourglass-oauth-callback';
  readonly state: string;
  readonly code?: string;
  readonly error?: string;
}

function isCallbackMessage(data: unknown): data is OAuthCallbackMessage {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { type?: unknown }).type === 'hourglass-oauth-callback'
  );
}

/**
 * Web-platform `IOAuthService`: opens the provider's authorize page in a popup,
 * waits for `oauth-callback.tsx` (rendered by the popup once redirected back to
 * this same origin) to `postMessage` the `code`, then exchanges it for tokens
 * directly against `config.tokenUrl` (no proxy — SPA-type app registrations send
 * permissive CORS headers on the token endpoint). Desktop later swaps in a Tauri
 * loopback-listener implementation behind the same {@link IOAuthService} port.
 */
export class WebRedirectOAuthService implements IOAuthService {
  async authorize(config: OAuthConfig): Promise<TokenSet> {
    const { verifier, challenge } = await generatePkcePair();
    const state = generateState();

    const params = new URLSearchParams({
      client_id: config.clientId,
      response_type: 'code',
      redirect_uri: config.redirectUri,
      scope: config.scopes.join(' '),
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      ...config.extraAuthParams,
    });

    const popup = window.open(`${config.authorizeUrl}?${params.toString()}`, 'hourglass-oauth', 'width=500,height=650');
    if (!popup) throw new Error('Popup blocked — allow popups for Hourglass to connect your calendar.');

    const code = await this.awaitCallback(state, popup);
    return this.exchangeCode(config, code, verifier);
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

  private awaitCallback(expectedState: string, popup: Window): Promise<string> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        window.removeEventListener('message', onMessage);
        clearInterval(closedCheck);
      };
      const onMessage = (event: MessageEvent) => {
        if (event.origin !== window.location.origin || !isCallbackMessage(event.data)) return;
        if (event.data.state !== expectedState) return;
        settled = true;
        cleanup();
        if (event.data.error) reject(new Error(event.data.error));
        else if (event.data.code) resolve(event.data.code);
        else reject(new Error('OAuth callback missing code'));
      };
      const closedCheck = setInterval(() => {
        if (popup.closed && !settled) {
          cleanup();
          reject(new Error('Sign-in window was closed before completing.'));
        }
      }, 500);
      window.addEventListener('message', onMessage);
    });
  }

  private async exchangeCode(config: OAuthConfig, code: string, verifier: string): Promise<TokenSet> {
    const body = new URLSearchParams({
      client_id: config.clientId,
      grant_type: 'authorization_code',
      code,
      redirect_uri: config.redirectUri,
      code_verifier: verifier,
    });
    return this.postToken(config.tokenUrl, body);
  }

  private async postToken(tokenUrl: string, body: URLSearchParams): Promise<TokenSet> {
    const res = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`OAuth token request failed (${res.status}): ${text}`);
    return toTokenSet(JSON.parse(text) as TokenResponseDto);
  }
}
