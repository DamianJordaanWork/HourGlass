import type { IsoDate, IsoDateTime } from '@domain/common/types';

/**
 * Build the work-day window for a date. For a day in progress, the end is
 * clamped to `now` so open time at the end of today isn't counted as dead.
 */
export function dayWindow(
  date: IsoDate,
  startHHmm: string,
  endHHmm: string,
  now: Date,
): { windowStart: IsoDateTime; windowEnd: IsoDateTime } {
  const startMs = new Date(`${date}T${startHHmm}:00`).getTime();
  const workEndMs = new Date(`${date}T${endHHmm}:00`).getTime();
  const nowMs = now.getTime();
  // Effective end = now, clamped to [workday start, workday end]. Past days →
  // full workday; future/pre-start → zero span (no phantom dead time); today
  // mid-day → now.
  const endMs = Math.min(workEndMs, Math.max(nowMs, startMs));
  return {
    windowStart: new Date(startMs).toISOString(),
    windowEnd: new Date(endMs).toISOString(),
  };
}
