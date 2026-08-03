import type { Id, TrackingSource } from '@domain/common/types';

/**
 * The `hg1` reconciliation tag embedded a couple of blank lines below a Harvest
 * entry's note body, as a fenced ```hg1 block holding base64url JSON. Hidden on
 * display, decoded for reconciliation, regenerated on write.
 *
 * Harvest is the source of truth, so we only store what Harvest can't natively
 * represent: the local `source` and, when present, the `templateId`. Everything
 * else — project, task, notes, hours, date, and the ADO work-item link (native
 * `external_reference`) — is already on the Harvest entry, and local intervals
 * reconcile by `harvestTimeEntryId`. Keeping the payload tiny keeps the note clean.
 *
 * Encoding is pluggable (plain base64url by default; scramble/encrypt later).
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

function toBase64Url(json: string): string {
  // btoa handles Latin-1; encode UTF-8 first for safety.
  const b64 = btoa(unescape(encodeURIComponent(json)));
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): string {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  return decodeURIComponent(escape(atob(b64)));
}

export const Hg1 = {
  encode(payload: Hg1Payload): string {
    return `${FENCE_OPEN}\n${toBase64Url(JSON.stringify(payload))}\n${FENCE_CLOSE}`;
  },

  /** Strip any existing hg1 block from notes and return the clean user text. */
  strip(notes: string): string {
    return notes.replace(BLOCK_RE, '').replace(/\s+$/, '');
  },

  /** Attach (or replace) the hg1 block below the user's note body. */
  embed(notes: string, payload: Hg1Payload): string {
    const clean = this.strip(notes);
    const body = clean.length > 0 ? `${clean}\n\n\n` : '';
    return `${body}${this.encode(payload)}`;
  },

  /** Decode the embedded payload, or null if absent/corrupt. */
  extract(notes: string): Hg1Payload | null {
    const m = BLOCK_RE.exec(notes);
    if (!m) return null;
    try {
      const parsed = JSON.parse(fromBase64Url(m[1]!.trim())) as Hg1Payload;
      return parsed && parsed.v === 1 ? parsed : null;
    } catch {
      return null;
    }
  },
} as const;
