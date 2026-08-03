import type { IsoDateTime } from '@domain/common/types';
import { durationHours, type TimeInterval } from '@domain/time/time-interval';

/** A group of intervals that share a Harvest project/task on a given day. */
export interface EntryGroup {
  readonly key: string;
  readonly harvestProjectId?: number;
  readonly harvestTaskId?: number;
  readonly projectName?: string;
  readonly taskName?: string;
  readonly hours: number;
  readonly isRunning: boolean;
  readonly intervals: readonly TimeInterval[];
}

const groupKey = (i: TimeInterval): string =>
  `${i.harvestProjectId ?? 'none'}:${i.harvestTaskId ?? 'none'}`;

export const IntervalAggregator = {
  /** Total hours across intervals (running ones measured to `nowIso`). */
  totalHours(intervals: readonly TimeInterval[], nowIso: IsoDateTime): number {
    return intervals.reduce((sum, i) => sum + durationHours(i, nowIso), 0);
  },

  /**
   * Group intervals by project+task for display. Preserves first-seen order;
   * each group's hours is the sum of its intervals.
   */
  groupByProjectTask(intervals: readonly TimeInterval[], nowIso: IsoDateTime): EntryGroup[] {
    const order: string[] = [];
    const map = new Map<string, TimeInterval[]>();
    for (const i of intervals) {
      const key = groupKey(i);
      if (!map.has(key)) {
        map.set(key, []);
        order.push(key);
      }
      map.get(key)!.push(i);
    }
    return order.map((key) => {
      const items = map.get(key)!;
      const head = items[0]!;
      return {
        key,
        harvestProjectId: head.harvestProjectId,
        harvestTaskId: head.harvestTaskId,
        projectName: head.projectName,
        taskName: head.taskName,
        hours: items.reduce((s, i) => s + durationHours(i, nowIso), 0),
        isRunning: items.some((i) => i.end === undefined),
        intervals: items,
      };
    });
  },
} as const;
