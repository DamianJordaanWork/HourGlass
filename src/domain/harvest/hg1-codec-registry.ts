import { Hg1CodecUnavailableError, type Hg1Codec, type Hg1Scheme } from '@domain/harvest/hg1-codec';
import { plainHg1Codec } from '@domain/harvest/plain-hg1-codec';
import { scrambleHg1Codec } from '@domain/harvest/scramble-hg1-codec';

/** Scheme-prefix regex per hg1-codec.ts: a single lowercase letter + a digit + `:`. */
const SCHEME_PREFIX_RE = /^([a-z])(\d):/;

/** Resolve the codec for an explicitly chosen scheme (e.g. from Settings). */
export function codecFor(scheme: Hg1Scheme): Hg1Codec {
  switch (scheme) {
    case 'plain':
      return plainHg1Codec;
    case 'scramble':
      return scrambleHg1Codec;
    case 'aes':
      throw new Hg1CodecUnavailableError(scheme);
  }
}

/**
 * Detect the codec from a hg1 body's own prefix, defaulting to `plain` when no
 * scheme prefix is present (the base64url alphabet never contains `:`, so this
 * is unambiguous).
 */
export function codecForBody(body: string): Hg1Codec {
  const m = SCHEME_PREFIX_RE.exec(body);
  if (!m) return plainHg1Codec;
  if (m[1] === 's') return scrambleHg1Codec;
  // Unknown/reserved prefixes (e.g. future `a1:`) fall back to plain, which will
  // simply fail to decode the body — extract() surfaces that as null.
  return plainHg1Codec;
}
