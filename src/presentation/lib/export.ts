import { durationHours, type TimeInterval } from '@domain/time/time-interval';

/**
 * Pure string builders for exporting timesheet data. No DOM/file I/O here —
 * see `download.ts` for the isolated side-effecting helper.
 *
 * CSV decisions (documented per ADR-025):
 * - Row terminator is `\r\n` (Excel-friendly).
 * - Every field is CSV-escaped: wrapped in double quotes, with internal
 *   double quotes doubled (RFC 4180 style), regardless of whether escaping
 *   is strictly necessary — simplest and safest.
 * - Running intervals (no `end`) have no injected clock in a pure function,
 *   so `end` and `hours` are left blank rather than computed against "now".
 */

const CSV_HEADERS = [
  'date',
  'project',
  'task',
  'start',
  'end',
  'hours',
  'source',
  'harvestTimeEntryId',
  'notes',
] as const;

function csvEscape(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function intervalToCsvRow(i: TimeInterval): string {
  const fields = [
    i.date,
    i.projectName ?? '',
    i.taskName ?? '',
    i.start,
    i.end ?? '',
    i.end ? durationHours(i, i.end).toFixed(2) : '',
    i.source,
    i.harvestTimeEntryId !== undefined ? String(i.harvestTimeEntryId) : '',
    i.notes,
  ];
  return fields.map(csvEscape).join(',');
}

/** Header row + one row per interval. Running intervals leave end/hours blank. */
export function intervalsToCsv(intervals: readonly TimeInterval[]): string {
  const rows = [CSV_HEADERS.join(','), ...intervals.map(intervalToCsvRow)];
  return rows.join('\r\n');
}

/** Pretty-printed JSON array of the intervals, unmodified. */
export function intervalsToJson(intervals: readonly TimeInterval[]): string {
  return JSON.stringify(intervals, null, 2);
}

/** A small analytics summary: total hours + per-project/task breakdown. */
export interface AnalyticsSummary {
  readonly totalHours: number;
  readonly breakdown: ReadonlyArray<{
    readonly projectName: string;
    readonly taskName: string;
    readonly hours: number;
  }>;
}

/**
 * Builds a small analytics summary (total + per-project/task breakdown) as
 * pretty-printed JSON. Running intervals contribute 0 hours here (pure fn,
 * no injected clock) — mirrors the CSV/JSON interval exports.
 */
export function analyticsSummaryToJson(intervals: readonly TimeInterval[]): string {
  const map = new Map<string, { projectName: string; taskName: string; hours: number }>();
  let totalHours = 0;
  for (const i of intervals) {
    if (!i.end) continue;
    const hours = durationHours(i, i.end);
    totalHours += hours;
    const key = `${i.projectName ?? ''}:${i.taskName ?? ''}`;
    const existing = map.get(key);
    if (existing) {
      existing.hours += hours;
    } else {
      map.set(key, { projectName: i.projectName ?? '', taskName: i.taskName ?? '', hours });
    }
  }
  const summary: AnalyticsSummary = {
    totalHours,
    breakdown: [...map.values()],
  };
  return JSON.stringify(summary, null, 2);
}
