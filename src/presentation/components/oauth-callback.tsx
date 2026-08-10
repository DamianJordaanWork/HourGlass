import { useEffect } from 'react';

/**
 * Rendered instead of the normal shell when this tab was opened as the OAuth
 * popup's redirect target (`?oauth=callback&code=...&state=...`). Hands the
 * result back to the opener via `postMessage` and closes itself — the opener's
 * `WebRedirectOAuthService.authorize()` is awaiting exactly this message.
 */
export function OAuthCallback() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const state = params.get('state') ?? '';
    const code = params.get('code') ?? undefined;
    const error = params.get('error_description') ?? params.get('error') ?? undefined;
    window.opener?.postMessage({ type: 'hourglass-oauth-callback', state, code, error }, window.location.origin);
    window.close();
  }, []);

  return (
    <div className="flex h-full items-center justify-center bg-canvas text-sm text-muted">
      Completing sign-in…
    </div>
  );
}

/** True when the current location is the OAuth popup's redirect target. */
export function isOAuthCallback(): boolean {
  return new URLSearchParams(window.location.search).get('oauth') === 'callback';
}
