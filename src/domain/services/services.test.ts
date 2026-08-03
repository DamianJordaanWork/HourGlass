import { describe, it, expect } from 'vitest';
import { IntervalAggregator } from './interval-aggregator';
import { DeadTimeCalculator } from './dead-time-calculator';
import { WeeklyGoalCalculator } from './weekly-goal-calculator';
import { Hg1, type Hg1Payload } from '@domain/harvest/hg1-metadata';
import type { TimeInterval } from '@domain/time/time-interval';

function interval(p: Partial<TimeInterval> & { start: string; end?: string }): TimeInterval {
  return {
    id: p.id ?? 'i',
    date: p.date ?? '2026-08-03',
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

const NOW = '2026-08-03T20:00:00Z';

describe('IntervalAggregator', () => {
  const items = [
    interval({ start: '2026-08-03T09:00:00Z', end: '2026-08-03T10:00:00Z', harvestProjectId: 1, harvestTaskId: 2, projectName: 'A' }),
    interval({ start: '2026-08-03T10:30:00Z', end: '2026-08-03T11:00:00Z', harvestProjectId: 1, harvestTaskId: 2, projectName: 'A' }),
    interval({ start: '2026-08-03T11:00:00Z', end: '2026-08-03T11:15:00Z', harvestProjectId: 3, harvestTaskId: 4, projectName: 'B' }),
  ];

  it('sums total hours', () => {
    expect(IntervalAggregator.totalHours(items, NOW)).toBeCloseTo(1.75, 5);
  });

  it('groups by project+task preserving order', () => {
    const groups = IntervalAggregator.groupByProjectTask(items, NOW);
    expect(groups.map((g) => g.key)).toEqual(['1:2', '3:4']);
    expect(groups[0]!.hours).toBeCloseTo(1.5, 5);
    expect(groups[1]!.hours).toBeCloseTo(0.25, 5);
  });

  it('measures a running interval against now', () => {
    const running = [interval({ start: '2026-08-03T19:00:00Z' })]; // no end
    expect(IntervalAggregator.totalHours(running, NOW)).toBeCloseTo(1, 5);
    expect(IntervalAggregator.groupByProjectTask(running, NOW)[0]!.isRunning).toBe(true);
  });
});

describe('DeadTimeCalculator', () => {
  it('computes gaps and productivity over a full work day', () => {
    const items = [
      interval({ start: '2026-08-03T09:00:00Z', end: '2026-08-03T10:00:00Z' }),
      interval({ start: '2026-08-03T10:30:00Z', end: '2026-08-03T12:00:00Z' }),
    ];
    const r = DeadTimeCalculator.compute(items, '2026-08-03T08:00:00Z', '2026-08-03T17:00:00Z', 15);
    expect(r.workMinutes).toBe(150);
    expect(r.workDayMinutes).toBe(540);
    expect(r.deadMinutes).toBe(390);
    expect(r.productivity).toBeCloseTo(150 / 540, 4);
    expect(r.contextSwitches).toBe(1);
    expect(r.gaps.map((g) => g.minutes)).toEqual([60, 30, 300]);
    expect(r.longestGapMinutes).toBe(300);
  });

  it('uses the window end as the cutoff (today)', () => {
    const items = [interval({ start: '2026-08-03T09:00:00Z', end: '2026-08-03T10:00:00Z' })];
    const r = DeadTimeCalculator.compute(items, '2026-08-03T08:00:00Z', '2026-08-03T12:00:00Z', 15);
    expect(r.workDayMinutes).toBe(240);
    expect(r.productivity).toBeCloseTo(0.25, 4);
  });

  it('merges overlapping intervals so work is not double-counted', () => {
    const items = [
      interval({ start: '2026-08-03T09:00:00Z', end: '2026-08-03T10:00:00Z' }),
      interval({ start: '2026-08-03T09:30:00Z', end: '2026-08-03T10:30:00Z' }),
    ];
    const r = DeadTimeCalculator.compute(items, '2026-08-03T09:00:00Z', '2026-08-03T11:00:00Z', 5);
    expect(r.workMinutes).toBe(90);
  });
});

describe('WeeklyGoalCalculator', () => {
  it('computes work-day hours minus break', () => {
    expect(WeeklyGoalCalculator.workDayHours('08:00', '17:00', 60)).toBe(8);
  });
  it('computes expected hours so far', () => {
    expect(WeeklyGoalCalculator.expectedHoursSoFar('08:00', '17:00', 60, 12 * 60 + 30)).toBeCloseTo(4, 5);
    expect(WeeklyGoalCalculator.expectedHoursSoFar('08:00', '17:00', 60, 7 * 60)).toBe(0);
    expect(WeeklyGoalCalculator.expectedHoursSoFar('08:00', '17:00', 60, 18 * 60)).toBe(8);
  });
  it('computes progress and over-goal', () => {
    expect(WeeklyGoalCalculator.progress(4, 8)).toBe(0.5);
    expect(WeeklyGoalCalculator.progress(10, 8)).toBe(1);
    expect(WeeklyGoalCalculator.isOver(9, 8)).toBe(true);
  });
});

describe('Hg1 metadata codec', () => {
  const payload: Hg1Payload = {
    v: 1,
    source: 'WorkItem',
    templateId: 'tpl-9',
  };

  it('round-trips through embed/extract and hides from the note body', () => {
    const notes = 'Investigating the login bug';
    const embedded = Hg1.embed(notes, payload);
    expect(embedded).toContain('```hg1');
    expect(Hg1.strip(embedded)).toBe(notes);
    expect(Hg1.extract(embedded)).toEqual(payload);
  });

  it('replaces an existing block instead of stacking', () => {
    const once = Hg1.embed('note', payload);
    const twice = Hg1.embed(once, { ...payload, source: 'Meeting' });
    expect((twice.match(/```hg1/g) ?? []).length).toBe(1);
    expect(Hg1.extract(twice)?.source).toBe('Meeting');
  });

  it('returns null when absent or corrupt', () => {
    expect(Hg1.extract('just notes')).toBeNull();
    expect(Hg1.extract('```hg1\n!!!notbase64!!!\n```')).toBeNull();
  });

  it('handles empty user notes', () => {
    const embedded = Hg1.embed('', payload);
    expect(Hg1.strip(embedded)).toBe('');
    expect(Hg1.extract(embedded)).toEqual(payload);
  });
});
