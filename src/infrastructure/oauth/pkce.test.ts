import { describe, it, expect } from 'vitest';
import { generatePkcePair, generateState } from './pkce';

describe('pkce', () => {
  it('generates a verifier and an S256 challenge derived from it', async () => {
    const { verifier, challenge } = await generatePkcePair();
    expect(verifier.length).toBeGreaterThan(20);
    expect(challenge.length).toBeGreaterThan(20);
    expect(challenge).not.toContain('+');
    expect(challenge).not.toContain('/');
    expect(challenge).not.toContain('=');

    // Recomputing the challenge from the same verifier must match (round-trip).
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    const bytes = new Uint8Array(digest);
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    const expected = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(challenge).toBe(expected);
  });

  it('generates distinct pairs and states on each call', async () => {
    const a = await generatePkcePair();
    const b = await generatePkcePair();
    expect(a.verifier).not.toBe(b.verifier);
    expect(generateState()).not.toBe(generateState());
  });
});
