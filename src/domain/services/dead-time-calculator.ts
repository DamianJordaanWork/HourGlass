import type { IsoDateTime } from '@domain/common/types';
import type { TimeInterval } from '@domain/time/time-interval';

export interface Gap {
  readonly start: IsoDateTime;
  readonly end: IsoDateTime;
  readonly minutes: number;
}

export interface DayProductivity {
  readonly gaps: readonly Gap[];
  readonly workMinutes: number;
  readonly deadMinutes: number;
  readonly workDayMinutes: number;
  readonly productivity: number; // 0..1 (work / work-day span)
  readonly contextSwitches: number;
  readonly intervalCount: number;
  readonly avgSessionMinutes: number;
  readonly longestGapMinutes: number;
}

const ms = (iso: IsoDateTime): number => new Date(iso).getTime();
const toMin = (n: number): number => Math.round(n / 60000);

/**
 * Dead-time / productivity within a work-day window. `windowEnd` is the effective
 * cutoff — pass "now" for the current day so open time at the end isn't counted
 * as dead. Ported from HarvestTracker's ReportService.
 */
export const DeadTimeCalculator = {
  compute(
    intervals: readonly TimeInterval[],
    windowStart: IsoDateTime,
    windowEnd: IsoDateTime,
    minGapMinutes: number,
  ): DayProductivity {
    const startMs = ms(windowStart);
    const endMs = ms(windowEnd);
    const span = Math.max(0, endMs - startMs);

    // Clamp intervals to the window, drop zero/negative, sort by start.
    const clamped = intervals
      .map((i) => ({
        start: Math.max(startMs, ms(i.start)),
        end: Math.min(endMs, ms(i.end ?? windowEnd)),
      }))
      .filter((s) => s.end > s.start)
      .sort((a, b) => a.start - b.start);

    // Merge overlaps so worked time isn't double-counted.
    const merged: { start: number; end: number }[] = [];
    for (const s of clamped) {
      const last = merged[merged.length - 1];
      if (last && s.start <= last.end) last.end = Math.max(last.end, s.end);
      else merged.push({ ...s });
    }

    const workMs = merged.reduce((sum, m) => sum + (m.end - m.start), 0);

    // Gaps: start→first, between, last→end.
    const gaps: Gap[] = [];
    let cursor = startMs;
    for (const m of merged) {
      if (m.start > cursor) gaps.push(gap(cursor, m.start));
      cursor = Math.max(cursor, m.end);
    }
    if (cursor < endMs) gaps.push(gap(cursor, endMs));

    const significant = gaps.filter((g) => g.minutes >= minGapMinutes);
    const intervalCount = clamped.length;
    const longest = significant.reduce((max, g) => Math.max(max, g.minutes), 0);

    return {
      gaps: significant,
      workMinutes: toMin(workMs),
      deadMinutes: toMin(span - workMs),
      workDayMinutes: toMin(span),
      productivity: span > 0 ? workMs / span : 0,
      contextSwitches: Math.max(0, intervalCount - 1),
      intervalCount,
      avgSessionMinutes: intervalCount > 0 ? toMin(workMs / intervalCount) : 0,
      longestGapMinutes: longest,
    };
  },
} as const;

function gap(startMs: number, endMs: number): Gap {
  return {
    start: new Date(startMs).toISOString(),
    end: new Date(endMs).toISOString(),
    minutes: toMin(endMs - startMs),
  };
}
