import type { Hg1Codec } from '@domain/harvest/hg1-codec';

const PREFIX = 's1:';

// Fixed, keyless rotating XOR mask. Not cryptographic — just enough to keep the
// tag from being trivially eyeballed while remaining deterministic and reversible
// without any stored secret.
const MASK = [0x5a, 0x3c, 0x91, 0x67, 0xe2, 0x0d, 0xb8, 0x4f];

function xor(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i += 1) {
    out[i] = bytes[i]! ^ MASK[i % MASK.length]!;
  }
  return out;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/**
 * Reversible, keyless obfuscation: UTF-8 bytes XOR'd against a fixed rotating
 * mask, then base64url-encoded, prefixed with `s1:`. Deterministic and pure —
 * no stored secret, so it's obfuscation (not real encryption); `aes` is the
 * scheme reserved for that.
 */
export const scrambleHg1Codec: Hg1Codec = {
  scheme: 'scramble',

  encode(json: string): string {
    const bytes = new TextEncoder().encode(json);
    return `${PREFIX}${bytesToBase64Url(xor(bytes))}`;
  },

  decode(body: string): string | null {
    if (!body.startsWith(PREFIX)) return null;
    try {
      const bytes = xor(base64UrlToBytes(body.slice(PREFIX.length)));
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      return null;
    }
  },
};
