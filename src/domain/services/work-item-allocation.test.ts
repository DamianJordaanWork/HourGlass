import { describe, expect, it } from 'vitest';
import type { WorkItemLink } from '@domain/time/time-interval';
import { allocateHours, allocationWarning } from '@domain/services/work-item-allocation';

const link = (workItemId: number, hours?: number): WorkItemLink => ({
  connectionId: 'c1',
  workItemId,
  workItemType: 'Task',
  url: `https://example/${workItemId}`,
  hours,
});

describe('allocateHours', () => {
  it('gives a single auto link the whole entry', () => {
    expect(allocateHours(2.5, [link(1)]).map((a) => a.hours)).toEqual([2.5]);
  });

  it('splits evenly across auto links', () => {
    expect(allocateHours(3, [link(1), link(2), link(3)]).map((a) => a.hours)).toEqual([1, 1, 1]);
  });

  it('honours explicit hours and shares the remainder', () => {
    expect(allocateHours(4, [link(1, 1), link(2), link(3)]).map((a) => a.hours)).toEqual([1, 1.5, 1.5]);
  });

  it('absorbs rounding drift in the last auto link so the total is exact', () => {
    const out = allocateHours(1, [link(1), link(2), link(3)]);
    expect(out.map((a) => a.hours)).toEqual([0.33, 0.33, 0.34]);
    expect(out.reduce((s, a) => s + a.hours, 0)).toBeCloseTo(1, 5);
  });

  it('never allocates negative hours when explicit claims exceed the total', () => {
    const out = allocateHours(1, [link(1, 3), link(2)]);
    expect(out.map((a) => a.hours)).toEqual([3, 0]);
  });

  it('leaves all-explicit allocations alone even when they undershoot', () => {
    expect(allocateHours(5, [link(1, 1), link(2, 2)]).map((a) => a.hours)).toEqual([1, 2]);
  });

  it('treats zero and negative explicit hours as auto', () => {
    expect(allocateHours(2, [link(1, 0), link(2, -1)]).map((a) => a.hours)).toEqual([1, 1]);
  });

  it('returns nothing for no links', () => {
    expect(allocateHours(3, [])).toEqual([]);
  });
});

describe('allocationWarning', () => {
  it('is silent when the numbers work out', () => {
    expect(allocationWarning(3, [link(1, 1), link(2)])).toBeUndefined();
    expect(allocationWarning(3, [link(1, 1), link(2, 2)])).toBeUndefined();
    expect(allocationWarning(3, [])).toBeUndefined();
  });

  it('flags over-claiming', () => {
    expect(allocationWarning(2, [link(1, 3)])).toMatch(/only 2h/);
  });

  it('flags unattributed hours only when every link is explicit', () => {
    expect(allocationWarning(4, [link(1, 1), link(2, 1)])).toMatch(/2h is unattributed/);
    expect(allocationWarning(4, [link(1, 1), link(2)])).toBeUndefined();
  });
});
