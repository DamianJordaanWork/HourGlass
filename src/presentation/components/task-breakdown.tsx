import type { TimeInterval } from '@domain/time/time-interval';
import { buildTaskBreakdown } from '@presentation/lib/task-breakdown';
import { projectColor } from '@presentation/lib/project-color';
import { formatHours } from '@presentation/lib/format';

interface TaskBreakdownProps {
  readonly intervals: readonly TimeInterval[];
  readonly nowIso: string;
}

/** Per-task hours breakdown for the day, driven by `IntervalAggregator.groupByProjectTask`. */
export function TaskBreakdown({ intervals, nowIso }: TaskBreakdownProps) {
  const rows = buildTaskBreakdown(intervals, nowIso);
  if (rows.length === 0) return null;

  return (
    <div className="flex flex-col gap-1.5">
      {rows.map((row) => (
        <div key={row.key} className="flex items-center gap-2 rounded-lg border border-hairline bg-surface px-3 py-2">
          <span className="h-6 w-1.5 rounded-full" style={{ backgroundColor: projectColor(row.harvestProjectId) }} />
          <span className="truncate text-sm text-ink">{row.label}</span>
          {row.isRunning && <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-accent" />}
          <span className="tabular ml-auto text-sm font-semibold text-ink">{formatHours(row.hours)}</span>
        </div>
      ))}
    </div>
  );
}
