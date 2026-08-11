import { describe, it, expect } from 'vitest';
import { resolveRollup, sumSyncedHours } from './rollup';
import type { TimeInterval } from '@domain/time/time-interval';

function iv(partial: Partial<TimeInterval> & { id: string; start: string }): TimeInterval {
  return {
    date: '2026-08-03',
    notes: '',
    end: undefined,
    isManual: true,
    source: 'Manual',
    createdAt: partial.start,
    updatedAt: partial.start,
    ...partial,
  } as TimeInterval;
}

describe('resolveRollup', () => {
  it('solo/OFF unlinked interval → no rollup', () => {
    const a = iv({ id: 'a', start: '2026-08-03T09:00:00.000Z', harvestProjectId: 1, harvestTaskId: 2 });
    const result = resolveRollup({ interval: a, dayIntervals: [a], aggregate: false });
    expect(result).toEqual({ entryId: undefined, siblingHours: 0 });
  });

  it('OFF but self-linked → sums other sharers of the same harvestTimeEntryId', () => {
    const a = iv({
      id: 'a',
      start: '2026-08-03T09:00:00.000Z',
      harvestProjectId: 1,
      harvestTaskId: 2,
      harvestTimeEntryId: 500,
    });
    const b = iv({
      id: 'b',
      start: '2026-08-03T10:00:00.000Z',
      harvestProjectId: 1,
      harvestTaskId: 2,
      harvestTimeEntryId: 500,
      syncedHours: 1.5,
    });
    const c = iv({
      id: 'c',
      start: '2026-08-03T11:00:00.000Z',
      harvestProjectId: 1,
      harvestTaskId: 2,
      harvestTimeEntryId: 999, // different entry, must be excluded
      syncedHours: 100,
    });
    const result = resolveRollup({ interval: a, dayIntervals: [a, b, c], aggregate: false });
    expect(result).toEqual({ entryId: 500, siblingHours: 1.5 });
  });

  it('ON, first interval of the task/day → no existing entry to join', () => {
    const a = iv({ id: 'a', start: '2026-08-03T09:00:00.000Z', harvestProjectId: 1, harvestTaskId: 2 });
    const result = resolveRollup({ interval: a, dayIntervals: [a], aggregate: true });
    expect(result).toEqual({ entryId: undefined, siblingHours: 0 });
  });

  it('ON, one linked sibling on the same task/day → joins its entry and hours', () => {
    const a = iv({ id: 'a', start: '2026-08-03T11:00:00.000Z', harvestProjectId: 1, harvestTaskId: 2 });
    const b = iv({
      id: 'b',
      start: '2026-08-03T09:00:00.000Z',
      harvestProjectId: 1,
      harvestTaskId: 2,
      harvestTimeEntryId: 500,
      syncedHours: 0.75,
    });
    const result = resolveRollup({ interval: a, dayIntervals: [a, b], aggregate: true });
    expect(result).toEqual({ entryId: 500, siblingHours: 0.75 });
  });

  it('ON, re-stopping an already-linked interval excludes itself from the sibling sum', () => {
    const a = iv({
      id: 'a',
      start: '2026-08-03T09:00:00.000Z',
      harvestProjectId: 1,
      harvestTaskId: 2,
      harvestTimeEntryId: 500,
      syncedHours: 1,
    });
    const b = iv({
      id: 'b',
      start: '2026-08-03T10:00:00.000Z',
      harvestProjectId: 1,
      harvestTaskId: 2,
      harvestTimeEntryId: 500,
      syncedHours: 0.5,
    });
    const result = resolveRollup({ interval: a, dayIntervals: [a, b], aggregate: true });
    expect(result).toEqual({ entryId: 500, siblingHours: 0.5 });
  });

  it('ON, multiple candidate entries → picks the one whose earliest member started first', () => {
    const current = iv({ id: 'x', start: '2026-08-03T12:00:00.000Z', harvestProjectId: 1, harvestTaskId: 2 });
    const later = iv({
      id: 'later',
      start: '2026-08-03T11:00:00.000Z',
      harvestProjectId: 1,
      harvestTaskId: 2,
      harvestTimeEntryId: 700,
      syncedHours: 2,
    });
    const earlier = iv({
      id: 'earlier',
      start: '2026-08-03T09:00:00.000Z',
      harvestProjectId: 1,
      harvestTaskId: 2,
      harvestTimeEntryId: 500,
      syncedHours: 1,
    });
    const result = resolveRollup({
      interval: current,
      dayIntervals: [current, later, earlier],
      aggregate: true,
    });
    expect(result).toEqual({ entryId: 500, siblingHours: 1 });
  });

  it('ON, different task or date → no rollup', () => {
    const a = iv({ id: 'a', start: '2026-08-03T09:00:00.000Z', harvestProjectId: 1, harvestTaskId: 2 });
    const otherTask = iv({
      id: 'b',
      start: '2026-08-03T08:00:00.000Z',
      harvestProjectId: 1,
      harvestTaskId: 99,
      harvestTimeEntryId: 500,
      syncedHours: 1,
    });
    const result = resolveRollup({ interval: a, dayIntervals: [a, otherTask], aggregate: true });
    expect(result).toEqual({ entryId: undefined, siblingHours: 0 });
  });

  it('sumSyncedHours treats undefined as 0', () => {
    const a = iv({ id: 'a', start: '2026-08-03T09:00:00.000Z' });
    const b = iv({ id: 'b', start: '2026-08-03T09:00:00.000Z', syncedHours: 2 });
    expect(sumSyncedHours([a, b])).toBe(2);
    expect(sumSyncedHours([])).toBe(0);
  });
});
