import { describe, expect, it } from 'vitest';
import type { OAuthConfig } from '@domain/ports';
import { FakeTransport } from '@test/fake-transport';
import { createDesktopLoopbackOAuthService } from '@infrastructure/oauth/desktop-loopback-oauth-service-factory';

const CONFIG: OAuthConfig = {
  provider: 'Google',
  clientId: 'client-1',
  scopes: ['calendar.readonly'],
  authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token',
  redirectUri: 'https://ignored.example/callback',
};

describe('createDesktopLoopbackOAuthService', () => {
  it('never throws synchronously at construction (container must build cleanly on desktop)', () => {
    expect(() => createDesktopLoopbackOAuthService(new FakeTransport())).not.toThrow();
  });

  it('only rejects with the pending-binding error once authorize() is actually invoked', async () => {
    const service = createDesktopLoopbackOAuthService(new FakeTransport());

    await expect(service.authorize(CONFIG)).rejects.toThrow(
      'Desktop loopback OAuth is not yet wired — pending an OAuth loopback plugin (F17)',
    );
  });
});
