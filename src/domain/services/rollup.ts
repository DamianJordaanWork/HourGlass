import type { TimeInterval } from '@domain/time/time-interval';

/** Which existing Harvest entry (if any) an interval's hours should roll into. */
export interface RollupDecision {
  readonly entryId?: number;
  readonly siblingHours: number;
}

/** Sum of `syncedHours` across intervals, treating an undefined value as 0. */
export function sumSyncedHours(intervals: readonly TimeInterval[]): number {
  return intervals.reduce((sum, i) => sum + (i.syncedHours ?? 0), 0);
}

/**
 * Decide which Harvest entry (if any) an interval's push should roll into, and
 * how many "sibling" hours are already accounted for on that entry (excluding
 * the interval itself).
 *
 * - If the interval is already linked to a Harvest entry, roll into that same
 *   entry — sum the `syncedHours` of every OTHER interval on the same day that
 *   shares that `harvestTimeEntryId`.
 * - Otherwise, when `aggregate` is on, look for an existing entry for the same
 *   (project, task) on the same day among the day's intervals and adopt the
 *   earliest-started one's Harvest entry.
 * - Otherwise (aggregate off, or nothing to join), there's no roll-up: a fresh
 *   Harvest entry will be created with just this interval's own hours.
 */
export function resolveRollup(params: {
  interval: TimeInterval;
  dayIntervals: readonly TimeInterval[];
  aggregate: boolean;
}): RollupDecision {
  const { interval, dayIntervals, aggregate } = params;

  if (interval.harvestTimeEntryId !== undefined) {
    const entryId = interval.harvestTimeEntryId;
    const siblings = dayIntervals.filter(
      (i) => i.id !== interval.id && i.harvestTimeEntryId === entryId,
    );
    return { entryId, siblingHours: sumSyncedHours(siblings) };
  }

  if (aggregate) {
    const candidates = dayIntervals.filter(
      (i) =>
        i.id !== interval.id &&
        i.harvestProjectId === interval.harvestProjectId &&
        i.harvestTaskId === interval.harvestTaskId &&
        i.harvestTimeEntryId !== undefined,
    );
    if (candidates.length > 0) {
      const groups = new Map<number, TimeInterval[]>();
      for (const c of candidates) {
        const id = c.harvestTimeEntryId!;
        if (!groups.has(id)) groups.set(id, []);
        groups.get(id)!.push(c);
      }
      let bestId: number | undefined;
      let bestStart: string | undefined;
      for (const [id, members] of groups) {
        const earliest = members.reduce((a, b) => (a.start < b.start ? a : b));
        if (bestStart === undefined || earliest.start < bestStart) {
          bestStart = earliest.start;
          bestId = id;
        }
      }
      if (bestId !== undefined) {
        return { entryId: bestId, siblingHours: sumSyncedHours(groups.get(bestId)!) };
      }
    }
  }

  return { entryId: undefined, siblingHours: 0 };
}
