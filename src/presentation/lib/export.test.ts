import { describe, expect, it } from 'vitest';
import type { TimeInterval } from '@domain/time/time-interval';
import { analyticsSummaryToJson, intervalsToCsv, intervalsToJson } from './export';

function interval(p: Partial<TimeInterval> & { start: string; end?: string }): TimeInterval {
  return {
    id: p.id ?? 'i1',
    date: p.date ?? '2026-08-11',
    harvestProjectId: p.harvestProjectId,
    harvestTaskId: p.harvestTaskId,
    projectName: p.projectName,
    taskName: p.taskName,
    notes: p.notes ?? '',
    start: p.start,
    end: p.end,
    isManual: p.isManual ?? false,
    harvestTimeEntryId: p.harvestTimeEntryId,
    source: p.source ?? 'Manual',
    createdAt: p.start,
    updatedAt: p.start,
  };
}

describe('intervalsToCsv', () => {
  it('emits the header row with the expected column order', () => {
    const csv = intervalsToCsv([]);
    expect(csv).toBe('date,project,task,start,end,hours,source,harvestTimeEntryId,notes');
  });

  it('maps a normal row correctly', () => {
    const csv = intervalsToCsv([
      interval({
        date: '2026-08-11',
        projectName: 'Acme',
        taskName: 'Dev',
        start: '2026-08-11T09:00:00Z',
        end: '2026-08-11T10:30:00Z',
        source: 'Manual',
        harvestTimeEntryId: 42,
        notes: 'Standup',
      }),
    ]);
    const rows = csv.split('\r\n');
    expect(rows).toHaveLength(2);
    expect(rows[1]).toBe(
      '"2026-08-11","Acme","Dev","2026-08-11T09:00:00Z","2026-08-11T10:30:00Z","1.50","Manual","42","Standup"',
    );
  });

  it('escapes notes containing a comma, a double quote, and a newline', () => {
    const csv = intervalsToCsv([
      interval({
        start: '2026-08-11T09:00:00Z',
        end: '2026-08-11T10:00:00Z',
        notes: 'Hello, "world"\nnext line',
      }),
    ]);
    const rows = csv.split('\r\n');
    // notes is the last field; verify it's properly escaped.
    expect(rows[1]).toContain('"Hello, ""world""\nnext line"');
  });

  it('leaves end and hours blank for a running interval', () => {
    const csv = intervalsToCsv([
      interval({ start: '2026-08-11T09:00:00Z', projectName: 'Acme', taskName: 'Dev' }),
    ]);
    const rows = csv.split('\r\n');
    const fields = rows[1]!.split(',');
    // date,project,task,start,end,hours,source,harvestTimeEntryId,notes
    expect(fields[4]).toBe('""'); // end
    expect(fields[5]).toBe('""'); // hours
  });

  it('produces only the header for an empty array', () => {
    expect(intervalsToCsv([])).toBe('date,project,task,start,end,hours,source,harvestTimeEntryId,notes');
  });

  it('formats hours to 2dp', () => {
    const csv = intervalsToCsv([
      interval({ start: '2026-08-11T09:00:00Z', end: '2026-08-11T09:20:00Z' }),
    ]);
    const rows = csv.split('\r\n');
    const fields = rows[1]!.split(',');
    expect(fields[5]).toBe('"0.33"');
  });
});

describe('intervalsToJson', () => {
  it('pretty-prints an empty array as []', () => {
    expect(intervalsToJson([])).toBe('[]');
  });

  it('serializes intervals with 2-space indentation', () => {
    const json = intervalsToJson([
      interval({ start: '2026-08-11T09:00:00Z', end: '2026-08-11T10:00:00Z', projectName: 'Acme' }),
    ]);
    const parsed = JSON.parse(json) as TimeInterval[];
    expect(parsed).toHaveLength(1);
    expect(parsed[0]!.projectName).toBe('Acme');
    expect(json).toContain('\n  {');
  });
});

describe('analyticsSummaryToJson', () => {
  it('returns zero total for an empty array', () => {
    const summary = JSON.parse(analyticsSummaryToJson([])) as { totalHours: number; breakdown: unknown[] };
    expect(summary.totalHours).toBe(0);
    expect(summary.breakdown).toEqual([]);
  });

  it('sums hours per project/task and skips running intervals', () => {
    const summary = JSON.parse(
      analyticsSummaryToJson([
        interval({ start: '2026-08-11T09:00:00Z', end: '2026-08-11T10:00:00Z', projectName: 'Acme', taskName: 'Dev' }),
        interval({ start: '2026-08-11T10:00:00Z', end: '2026-08-11T10:30:00Z', projectName: 'Acme', taskName: 'Dev' }),
        interval({ start: '2026-08-11T11:00:00Z', projectName: 'Acme', taskName: 'Dev' }),
      ]),
    ) as { totalHours: number; breakdown: Array<{ projectName: string; taskName: string; hours: number }> };
    expect(summary.totalHours).toBeCloseTo(1.5, 5);
    expect(summary.breakdown).toHaveLength(1);
    expect(summary.breakdown[0]!.hours).toBeCloseTo(1.5, 5);
  });
});
