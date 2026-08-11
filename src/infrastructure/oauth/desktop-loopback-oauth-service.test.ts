import { describe, expect, it } from 'vitest';
import type { OAuthConfig } from '@domain/ports';
import { FakeTransport } from '@test/fake-transport';
import { DesktopLoopbackOAuthService, OAuthError } from '@infrastructure/oauth/desktop-loopback-oauth-service';
import type { LoopbackListener, LoopbackSession, UrlOpener } from '@infrastructure/oauth/loopback-listener';

const CONFIG: OAuthConfig = {
  provider: 'Google',
  clientId: 'client-1',
  scopes: ['calendar.readonly'],
  authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token',
  redirectUri: 'https://ignored.example/callback',
};

function fakeListener(redirectUri: string, resolveWith: () => Promise<string>): LoopbackListener {
  return {
    start: async (): Promise<LoopbackSession> => ({
      redirectUri,
      waitForRedirect: resolveWith,
      cancel: async () => {
        // no-op
      },
    }),
  };
}

function fakeOpener(): { opener: UrlOpener; openedUrls: string[] } {
  const openedUrls: string[] = [];
  const opener: UrlOpener = {
    open: async (url) => {
      openedUrls.push(url);
    },
  };
  return { opener, openedUrls };
}

describe('DesktopLoopbackOAuthService', () => {
  it('authorize: builds the authorize URL with the loopback redirect_uri + PKCE + state, opens it, exchanges the code, returns mapped TokenSet', async () => {
    const redirectUri = 'http://127.0.0.1:54321/callback';
    let capturedState = '';
    const listener = fakeListener(redirectUri, async () => `${redirectUri}?code=abc123&state=${capturedState}`);
    const { opener, openedUrls } = fakeOpener();
    const transport = new FakeTransport().on('POST', 'oauth2.googleapis.com/token', {
      access_token: 'at-1',
      refresh_token: 'rt-1',
      expires_in: 3600,
      scope: 'calendar.readonly',
    });

    const service = new DesktopLoopbackOAuthService({ transport, listener, opener });

    // Intercept the state from the opened URL before resolving the redirect.
    const originalOpen = opener.open.bind(opener);
    opener.open = async (url) => {
      capturedState = new URL(url).searchParams.get('state') ?? '';
      await originalOpen(url);
    };

    const tokens = await service.authorize(CONFIG);

    expect(openedUrls).toHaveLength(1);
    const authorizeUrl = new URL(openedUrls[0]);
    expect(authorizeUrl.origin + authorizeUrl.pathname).toBe(CONFIG.authorizeUrl);
    expect(authorizeUrl.searchParams.get('redirect_uri')).toBe(redirectUri);
    expect(authorizeUrl.searchParams.get('client_id')).toBe('client-1');
    expect(authorizeUrl.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authorizeUrl.searchParams.get('code_challenge')).toBeTruthy();
    expect(authorizeUrl.searchParams.get('state')).toBeTruthy();

    const tokenReq = transport.lastRequest();
    expect(tokenReq.method).toBe('POST');
    expect(tokenReq.url).toBe(CONFIG.tokenUrl);
    const tokenBody = new URLSearchParams(tokenReq.body);
    expect(tokenBody.get('grant_type')).toBe('authorization_code');
    expect(tokenBody.get('code')).toBe('abc123');
    expect(tokenBody.get('redirect_uri')).toBe(redirectUri);
    expect(tokenBody.get('code_verifier')).toBeTruthy();

    expect(tokens).toEqual({
      accessToken: 'at-1',
      refreshToken: 'rt-1',
      expiresAt: expect.any(Number),
      scope: 'calendar.readonly',
    });
  });

  it('rejects on state mismatch', async () => {
    const redirectUri = 'http://127.0.0.1:54321/callback';
    const listener = fakeListener(redirectUri, async () => `${redirectUri}?code=abc123&state=wrong-state`);
    const { opener } = fakeOpener();
    const transport = new FakeTransport();
    const service = new DesktopLoopbackOAuthService({ transport, listener, opener });

    await expect(service.authorize(CONFIG)).rejects.toBeInstanceOf(OAuthError);
    await expect(service.authorize(CONFIG)).rejects.toThrow('OAuth state mismatch');
  });

  it('rejects when the redirect carries an error param', async () => {
    const redirectUri = 'http://127.0.0.1:54321/callback';
    const listener = fakeListener(redirectUri, async () => `${redirectUri}?error=access_denied&state=anything`);
    const { opener } = fakeOpener();
    const transport = new FakeTransport();
    const service = new DesktopLoopbackOAuthService({ transport, listener, opener });

    await expect(service.authorize(CONFIG)).rejects.toBeInstanceOf(OAuthError);
    await expect(service.authorize(CONFIG)).rejects.toThrow('access_denied');
  });

  it('rejects with the response body on a non-2xx token exchange', async () => {
    const redirectUri = 'http://127.0.0.1:54321/callback';
    let capturedState = '';
    const listener = fakeListener(redirectUri, async () => `${redirectUri}?code=abc123&state=${capturedState}`);
    const { opener } = fakeOpener();
    opener.open = async (url) => {
      capturedState = new URL(url).searchParams.get('state') ?? '';
    };
    const transport = new FakeTransport().on('POST', 'oauth2.googleapis.com/token', { error: 'invalid_grant' }, 400);
    const service = new DesktopLoopbackOAuthService({ transport, listener, opener });

    await expect(service.authorize(CONFIG)).rejects.toBeInstanceOf(OAuthError);
    await expect(service.authorize(CONFIG)).rejects.toThrow(/400/);
  });

  it('refresh: posts the refresh_token grant and returns a mapped TokenSet', async () => {
    const transport = new FakeTransport().on('POST', 'oauth2.googleapis.com/token', {
      access_token: 'at-2',
      expires_in: 1800,
    });
    const listener = fakeListener('http://127.0.0.1:1/callback', async () => 'unused');
    const { opener } = fakeOpener();
    const service = new DesktopLoopbackOAuthService({ transport, listener, opener });

    const tokens = await service.refresh(CONFIG, 'rt-old');

    const req = transport.lastRequest();
    const body = new URLSearchParams(req.body);
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('refresh_token')).toBe('rt-old');
    expect(tokens.accessToken).toBe('at-2');
  });
});
