import { useQuery } from '@tanstack/react-query';
import { durationHours } from '@domain/time/time-interval';
import { DeadTimeCalculator } from '@domain/services/dead-time-calculator';
import { WeeklyGoalCalculator } from '@domain/services/weekly-goal-calculator';
import { useContainer } from '@presentation/container-context';
import { useSelectedDay } from '@presentation/state/selected-day';
import { useDayIntervals, useNow } from '@presentation/hooks/use-tracking';
import { useSettings } from '@presentation/hooks/use-settings';
import { dayWindow } from '@presentation/lib/work-window';
import { formatHours, longDayLabel, weekDays } from '@presentation/lib/format';

export function InsightsPane() {
  const { date } = useSelectedDay();
  const container = useContainer();
  const { data: settings } = useSettings();
  const { data: intervals } = useDayIntervals(date);
  const now = useNow(true);

  const days = weekDays(date);
  const week = useQuery({
    queryKey: ['week', days[0], days[6]],
    queryFn: () => container.repos.intervals.listByRange(days[0]!, days[6]!),
  });

  if (!settings) return null;
  const nowDate = new Date(now);
  const { windowStart, windowEnd } = dayWindow(date, settings.workDayStart, settings.workDayEnd, nowDate);
  const report = DeadTimeCalculator.compute(intervals ?? [], windowStart, windowEnd, settings.minDeadTimeMinutes);

  const weekHours = (week.data ?? []).reduce((s, i) => s + durationHours(i, nowDate.toISOString()), 0);
  const weekProgress = WeeklyGoalCalculator.progress(weekHours, settings.weeklyGoalHours);
  const overGoal = WeeklyGoalCalculator.isOver(weekHours, settings.weeklyGoalHours);

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-5 flex items-end justify-between">
        <h2 className="text-lg font-semibold">Insights</h2>
        <span className="text-sm text-muted">{longDayLabel(date)}</span>
      </div>

      {/* weekly goal ring */}
      <div className="mb-5 flex items-center gap-4 rounded-lg border border-hairline bg-surface p-4">
        <Ring fraction={weekProgress} over={overGoal} />
        <div>
          <div className="text-sm text-muted">This week</div>
          <div className="tabular text-xl font-semibold">
            {formatHours(weekHours)} <span className="text-sm font-normal text-muted">/ {settings.weeklyGoalHours}h goal</span>
          </div>
          {overGoal && <div className="text-xs font-medium text-warning">Over goal</div>}
        </div>
      </div>

      {/* day stat tiles */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Worked" value={formatHours(report.workMinutes / 60)} tone="accent" />
        <Stat label="Productivity" value={`${Math.round(report.productivity * 100)}%`} />
        <Stat label="Dead time" value={formatHours(report.deadMinutes / 60)} />
        <Stat label="Context switches" value={String(report.contextSwitches)} />
      </div>

      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-muted">Gaps ({'>'}={settings.minDeadTimeMinutes}m)</h3>
        <span className="text-xs text-muted">Longest {formatHours(report.longestGapMinutes / 60)}</span>
      </div>
      {report.gaps.length === 0 ? (
        <div className="rounded-lg border border-dashed border-hairline bg-surface p-6 text-center text-sm text-muted">
          No significant gaps — nicely focused.
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {report.gaps.map((g, i) => (
            <div key={i} className="flex items-center gap-3 rounded-lg border border-hairline bg-surface px-3 py-2">
              <span className="h-2 w-2 rounded-full bg-warning/70" />
              <span className="tabular text-sm text-ink">{formatHours(g.minutes / 60)}</span>
              <span className="tabular ml-auto text-xs text-muted">
                {g.start.slice(11, 16)}–{g.end.slice(11, 16)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'accent' }) {
  return (
    <div className="rounded-lg border border-hairline bg-surface p-3">
      <div className="text-xs text-muted">{label}</div>
      <div className={'tabular mt-0.5 text-xl font-semibold ' + (tone === 'accent' ? 'text-accent-strong' : 'text-ink')}>
        {value}
      </div>
    </div>
  );
}

function Ring({ fraction, over }: { fraction: number; over: boolean }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  const color = over ? 'var(--warning)' : 'var(--accent)';
  return (
    <svg width="64" height="64" viewBox="0 0 64 64" className="shrink-0">
      <circle cx="32" cy="32" r={r} fill="none" stroke="var(--surface-2)" strokeWidth="7" />
      <circle
        cx="32" cy="32" r={r} fill="none" stroke={color} strokeWidth="7" strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={c * (1 - Math.min(1, fraction))}
        transform="rotate(-90 32 32)"
      />
      <text x="32" y="36" textAnchor="middle" className="fill-ink text-[13px] font-semibold">
        {Math.round(fraction * 100)}%
      </text>
    </svg>
  );
}
