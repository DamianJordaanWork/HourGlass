/**
 * Pluggable encoding for the hg1 fenced-block body. The body is self-describing:
 * a scheme prefix of the form `<letter><digit>:` (e.g. `s1:`, `a1:`) identifies the
 * scheme; a body with no such prefix is `plain` (unprefixed base64url), which is
 * byte-for-byte identical to the original hg1 format for backward compatibility.
 * The base64url alphabet ([A-Za-z0-9_-]) never contains `:`, so detection is
 * unambiguous.
 */

export type Hg1Scheme = 'plain' | 'scramble' | 'aes';

export interface Hg1Codec {
  readonly scheme: Hg1Scheme;
  /** Encode a JSON string into a hg1 fenced-block body. */
  encode(json: string): string;
  /** Decode a hg1 fenced-block body back into a JSON string, or null if invalid. */
  decode(body: string): string | null;
}

/** Thrown when a requested `Hg1Scheme` has no available codec (e.g. `aes` is reserved but not built). */
export class Hg1CodecUnavailableError extends Error {
  constructor(scheme: Hg1Scheme) {
    super(`No hg1 codec is available for scheme "${scheme}".`);
    this.name = 'Hg1CodecUnavailableError';
  }
}
