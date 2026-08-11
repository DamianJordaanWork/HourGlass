import type { IsoDateTime } from '@domain/common/types';
import type { TimeInterval } from '@domain/time/time-interval';
import { IntervalAggregator } from '@domain/services/interval-aggregator';

export interface TaskBreakdownRow {
  readonly key: string;
  readonly harvestProjectId?: number;
  readonly label: string;
  readonly hours: number;
  readonly isRunning: boolean;
}

/** Per-project/task hours breakdown for the day, sorted by hours descending. */
export function buildTaskBreakdown(
  intervals: readonly TimeInterval[],
  nowIso: IsoDateTime,
): TaskBreakdownRow[] {
  const groups = IntervalAggregator.groupByProjectTask(intervals, nowIso);
  return groups
    .map((g) => ({
      key: g.key,
      harvestProjectId: g.harvestProjectId,
      label: g.projectName ? `${g.projectName} · ${g.taskName ?? ''}` : 'Unmapped',
      hours: g.hours,
      isRunning: g.isRunning,
    }))
    .sort((a, b) => b.hours - a.hours);
}
