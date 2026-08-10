import type { Hg1Codec } from '@domain/harvest/hg1-codec';

/** Encode a JSON string as unprefixed base64url (UTF-8 safe). */
export function toBase64Url(json: string): string {
  // btoa handles Latin-1; encode UTF-8 first for safety.
  const b64 = btoa(unescape(encodeURIComponent(json)));
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Decode an unprefixed base64url string back into a UTF-8 JSON string. */
export function fromBase64Url(s: string): string {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  return decodeURIComponent(escape(atob(b64)));
}

/**
 * The default hg1 codec: unprefixed base64url. Byte-for-byte identical to the
 * original (pre-pluggable) hg1 format, so existing tags remain decodable.
 */
export const plainHg1Codec: Hg1Codec = {
  scheme: 'plain',

  encode(json: string): string {
    return toBase64Url(json);
  },

  decode(body: string): string | null {
    try {
      return fromBase64Url(body);
    } catch {
      return null;
    }
  },
};
