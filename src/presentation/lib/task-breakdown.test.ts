import { describe, expect, it } from 'vitest';
import type { TimeInterval } from '@domain/time/time-interval';
import { buildTaskBreakdown } from './task-breakdown';

function interval(p: Partial<TimeInterval> & { start: string; end?: string }): TimeInterval {
  return {
    id: p.id ?? 'i',
    date: p.date ?? '2026-08-11',
    harvestProjectId: p.harvestProjectId,
    harvestTaskId: p.harvestTaskId,
    projectName: p.projectName,
    taskName: p.taskName,
    notes: p.notes ?? '',
    start: p.start,
    end: p.end,
    isManual: p.isManual ?? false,
    source: p.source ?? 'Manual',
    createdAt: p.start,
    updatedAt: p.start,
  };
}

const NOW = '2026-08-11T20:00:00Z';

describe('buildTaskBreakdown', () => {
  it('groups and sums hours by project/task', () => {
    const rows = buildTaskBreakdown(
      [
        interval({ start: '2026-08-11T09:00:00Z', end: '2026-08-11T10:00:00Z', harvestProjectId: 1, harvestTaskId: 2, projectName: 'A', taskName: 'Dev' }),
        interval({ start: '2026-08-11T10:30:00Z', end: '2026-08-11T11:00:00Z', harvestProjectId: 1, harvestTaskId: 2, projectName: 'A', taskName: 'Dev' }),
      ],
      NOW,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.hours).toBeCloseTo(1.5, 5);
  });

  it('sorts rows by hours descending', () => {
    const rows = buildTaskBreakdown(
      [
        interval({ start: '2026-08-11T09:00:00Z', end: '2026-08-11T09:15:00Z', harvestProjectId: 1, harvestTaskId: 2, projectName: 'A', taskName: 'Dev' }),
        interval({ start: '2026-08-11T10:00:00Z', end: '2026-08-11T12:00:00Z', harvestProjectId: 3, harvestTaskId: 4, projectName: 'B', taskName: 'QA' }),
      ],
      NOW,
    );
    expect(rows.map((r) => r.key)).toEqual(['3:4', '1:2']);
  });

  it('builds a "project · task" label', () => {
    const rows = buildTaskBreakdown(
      [interval({ start: '2026-08-11T09:00:00Z', end: '2026-08-11T10:00:00Z', harvestProjectId: 1, harvestTaskId: 2, projectName: 'A', taskName: 'Dev' })],
      NOW,
    );
    expect(rows[0]!.label).toBe('A · Dev');
  });

  it('falls back to "Unmapped" when there is no project name', () => {
    const rows = buildTaskBreakdown(
      [interval({ start: '2026-08-11T09:00:00Z', end: '2026-08-11T10:00:00Z' })],
      NOW,
    );
    expect(rows[0]!.label).toBe('Unmapped');
  });

  it('propagates isRunning when any interval in the group is running', () => {
    const rows = buildTaskBreakdown(
      [
        interval({ start: '2026-08-11T09:00:00Z', end: '2026-08-11T10:00:00Z', harvestProjectId: 1, harvestTaskId: 2, projectName: 'A' }),
        interval({ start: '2026-08-11T11:00:00Z', harvestProjectId: 1, harvestTaskId: 2, projectName: 'A' }),
      ],
      NOW,
    );
    expect(rows[0]!.isRunning).toBe(true);
  });

  it('measures a running interval to nowIso', () => {
    const rows = buildTaskBreakdown(
      [interval({ start: '2026-08-11T19:00:00Z', harvestProjectId: 1, harvestTaskId: 2, projectName: 'A' })],
      NOW,
    );
    expect(rows[0]!.hours).toBeCloseTo(1, 5);
  });

  it('returns an empty array for no intervals', () => {
    expect(buildTaskBreakdown([], NOW)).toEqual([]);
  });
});
