/**
 * Work-day and goal maths. Pure: takes `HH:mm` strings and an optional "now"
 * fraction so the UI can draw an expected-hours tick without knowing the clock.
 */

/** Minutes since midnight for an `HH:mm` string; NaN-safe (returns 0). */
export function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':');
  const hours = Number(h);
  const mins = Number(m);
  if (Number.isNaN(hours) || Number.isNaN(mins)) return 0;
  return hours * 60 + mins;
}

export const WeeklyGoalCalculator = {
  /** Length of a work day in hours, minus break. */
  workDayHours(start: string, end: string, breakMinutes: number): number {
    const span = hhmmToMinutes(end) - hhmmToMinutes(start) - Math.max(0, breakMinutes);
    return Math.max(0, span) / 60;
  },

  /**
   * Hours you'd be expected to have logged by `nowMinutes` (minutes since
   * midnight) if working steadily through the day — drives the tick marker.
   */
  expectedHoursSoFar(
    start: string,
    end: string,
    breakMinutes: number,
    nowMinutes: number,
  ): number {
    const startM = hhmmToMinutes(start);
    const endM = hhmmToMinutes(end);
    const full = this.workDayHours(start, end, breakMinutes);
    if (nowMinutes <= startM) return 0;
    if (nowMinutes >= endM) return full;
    const elapsed = nowMinutes - startM;
    const total = endM - startM;
    return total > 0 ? (elapsed / total) * full : 0;
  },

  /** Progress toward a goal as a 0..1 fraction (capped at 1 for bars). */
  progress(hours: number, goalHours: number): number {
    if (goalHours <= 0) return 0;
    return Math.min(1, Math.max(0, hours / goalHours));
  },

  /** Whether the goal has been met or exceeded. */
  isOver(hours: number, goalHours: number): boolean {
    return goalHours > 0 && hours > goalHours;
  },
} as const;
