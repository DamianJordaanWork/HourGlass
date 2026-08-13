import type { WorkItemLink } from '@domain/time/time-interval';

/**
 * Splitting an interval's hours across the ADO tickets worked on during it
 * (ADR-029). A link may name its own hours; the rest share whatever is left.
 * Pure — the tracking service turns these into per-ticket CompletedWork deltas.
 */

export interface Allocation {
  readonly link: WorkItemLink;
  readonly hours: number;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Hours a link explicitly claims, ignoring nonsense values. */
const explicitHours = (link: WorkItemLink): number | undefined =>
  link.hours !== undefined && Number.isFinite(link.hours) && link.hours > 0 ? link.hours : undefined;

export function allocateHours(totalHours: number, links: readonly WorkItemLink[]): Allocation[] {
  if (links.length === 0) return [];
  const explicit = links.map(explicitHours);
  const claimed = explicit.reduce<number>((sum, h) => sum + (h ?? 0), 0);
  const autoCount = explicit.filter((h) => h === undefined).length;
  const remainder = Math.max(0, totalHours - claimed);

  if (autoCount === 0) return links.map((link, i) => ({ link, hours: round2(explicit[i] ?? 0) }));

  // Split the remainder evenly; the last auto link absorbs the rounding drift so
  // the allocations always add back up to the entry's real hours.
  const share = round2(remainder / autoCount);
  let autoSeen = 0;
  return links.map((link, i) => {
    const claim = explicit[i];
    if (claim !== undefined) return { link, hours: round2(claim) };
    autoSeen += 1;
    const hours = autoSeen === autoCount ? round2(remainder - share * (autoCount - 1)) : share;
    return { link, hours: Math.max(0, hours) };
  });
}

/**
 * A message for the entry editor when explicit hours can't reconcile with the
 * entry's duration. Returns undefined when the numbers work out.
 */
export function allocationWarning(totalHours: number, links: readonly WorkItemLink[]): string | undefined {
  if (links.length === 0) return undefined;
  const explicit = links.map(explicitHours);
  const claimed = round2(explicit.reduce<number>((sum, h) => sum + (h ?? 0), 0));
  const total = round2(totalHours);
  const hasAuto = explicit.some((h) => h === undefined);

  if (claimed > total + 0.01) {
    return `Tickets claim ${claimed}h but this entry is only ${total}h.`;
  }
  if (!hasAuto && claimed < total - 0.01) {
    return `Tickets account for ${claimed}h of ${total}h — ${round2(total - claimed)}h is unattributed.`;
  }
  return undefined;
}
