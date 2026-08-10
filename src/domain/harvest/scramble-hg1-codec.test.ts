import { describe, it, expect } from 'vitest';
import { scrambleHg1Codec } from '@domain/harvest/scramble-hg1-codec';

describe('scrambleHg1Codec', () => {
  it('round-trips a JSON payload', () => {
    const json = JSON.stringify({ v: 1, source: 'Manual' });
    const encoded = scrambleHg1Codec.encode(json);
    expect(scrambleHg1Codec.decode(encoded)).toBe(json);
  });

  it('round-trips unicode content', () => {
    const json = JSON.stringify({ v: 1, note: '日本語 emoji 🎉 café' });
    const encoded = scrambleHg1Codec.encode(json);
    expect(scrambleHg1Codec.decode(encoded)).toBe(json);
  });

  it('round-trips an empty string', () => {
    const encoded = scrambleHg1Codec.encode('');
    expect(scrambleHg1Codec.decode(encoded)).toBe('');
  });

  it('returns null for garbage input (no scheme prefix)', () => {
    expect(scrambleHg1Codec.decode('!!!not-scrambled!!!')).toBeNull();
  });

  it('returns null for a plain (unprefixed) body', () => {
    expect(scrambleHg1Codec.decode('eyJ2IjoxfQ')).toBeNull();
  });

  it('has the "scramble" scheme tag and prefixes encoded bodies with s1:', () => {
    expect(scrambleHg1Codec.scheme).toBe('scramble');
    expect(scrambleHg1Codec.encode('{"v":1}')).toMatch(/^s1:/);
  });

  it('is deterministic', () => {
    const json = JSON.stringify({ v: 1, source: 'WorkItem', templateId: 'tpl-1' });
    expect(scrambleHg1Codec.encode(json)).toBe(scrambleHg1Codec.encode(json));
  });

  it('produces output that differs from the plain encoding', () => {
    const json = JSON.stringify({ v: 1, source: 'WorkItem' });
    const scrambled = scrambleHg1Codec.encode(json);
    // Not a base64url string of the raw JSON — it's prefixed and obfuscated.
    expect(scrambled).not.toBe(Buffer.from(json, 'utf-8').toString('base64url'));
  });
});
