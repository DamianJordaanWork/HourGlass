import type { Id, TrackingSource } from '@domain/common/types';
import type { Hg1Codec } from '@domain/harvest/hg1-codec';
import { codecForBody } from '@domain/harvest/hg1-codec-registry';
import { plainHg1Codec } from '@domain/harvest/plain-hg1-codec';

/**
 * The `hg1` reconciliation tag embedded a couple of blank lines below a Harvest
 * entry's note body, as a fenced ```hg1 block holding an encoded JSON payload.
 * Hidden on display, decoded for reconciliation, regenerated on write.
 *
 * Harvest is the source of truth, so we only store what Harvest can't natively
 * represent: the local `source` and, when present, the `templateId`. Everything
 * else — project, task, notes, hours, date, and the ADO work-item link (native
 * `external_reference`) — is already on the Harvest entry, and local intervals
 * reconcile by `harvestTimeEntryId`. Keeping the payload tiny keeps the note clean.
 *
 * The body's encoding is pluggable and self-describing: a `<letter><digit>:`
 * prefix (e.g. `s1:`) names the scheme; an unprefixed body is `plain` (raw
 * base64url), which is byte-for-byte identical to the original hg1 format for
 * backward compatibility. `extract` auto-detects the scheme per body via
 * `codecForBody`, so entries written under different schemes over time all
 * remain decodable.
 */

export interface Hg1Payload {
  readonly v: 1;
  readonly source: TrackingSource;
  readonly templateId?: Id;
}

const FENCE_OPEN = '```hg1';
const FENCE_CLOSE = '```';
// Matches the fenced block (and any leading blank lines) at/near the end of notes.
const BLOCK_RE = /\n*```hg1\s*\n([\s\S]*?)\n?```[ \t]*$/;

export const Hg1 = {
  encode(payload: Hg1Payload, codec: Hg1Codec = plainHg1Codec): string {
    return `${FENCE_OPEN}\n${codec.encode(JSON.stringify(payload))}\n${FENCE_CLOSE}`;
  },

  /** Strip any existing hg1 block from notes and return the clean user text. */
  strip(notes: string): string {
    return notes.replace(BLOCK_RE, '').replace(/\s+$/, '');
  },

  /** Attach (or replace) the hg1 block below the user's note body. */
  embed(notes: string, payload: Hg1Payload, codec: Hg1Codec = plainHg1Codec): string {
    const clean = this.strip(notes);
    const body = clean.length > 0 ? `${clean}\n\n\n` : '';
    return `${body}${this.encode(payload, codec)}`;
  },

  /** Decode the embedded payload, or null if absent/corrupt. */
  extract(notes: string): Hg1Payload | null {
    const m = BLOCK_RE.exec(notes);
    if (!m) return null;
    const body = m[1]!.trim();
    const json = codecForBody(body).decode(body);
    if (json === null) return null;
    try {
      const parsed = JSON.parse(json) as Hg1Payload;
      return parsed && parsed.v === 1 ? parsed : null;
    } catch {
      return null;
    }
  },
} as const;
