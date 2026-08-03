import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { parseISO } from 'date-fns';
import type { IsoDate } from '@domain/common/types';
import type { HarvestTimeEntry } from '@domain/harvest/harvest-types';
import { durationHours, type TimeInterval } from '@domain/time/time-interval';
import { useContainer } from '@presentation/container-context';
import { useSelectedDay } from '@presentation/state/selected-day';
import {
  useDayIntervals,
  useHarvestEntries,
  useNow,
  useRunning,
  useTrackingActions,
} from '@presentation/hooks/use-tracking';
import { EntryModal } from '@presentation/components/entry-modal';
import {
  dayLabelShort,
  dayNumber,
  formatClock,
  formatHours,
  formatTimeRange,
  longDayLabel,
  toIsoDate,
  weekDays,
} from '@presentation/lib/format';
import { projectColor } from '@presentation/lib/project-color';

const todayIso = () => toIsoDate(new Date());

export function DaySelector() {
  const { date, setDate, shiftWeek, goToday } = useSelectedDay();
  const container = useContainer();
  const days = weekDays(date);
  const now = useNow(true);

  const week = useQuery({
    queryKey: ['week', days[0], days[6]],
    queryFn: () => container.repos.intervals.listByRange(days[0]!, days[6]!),
  });
  const { data: weekHarvest } = useHarvestEntries(days[0]!, days[6]!);

  const totals = new Map<IsoDate, number>();
  const syncedIds = new Set<number>();
  for (const iv of week.data ?? []) {
    if (iv.harvestTimeEntryId) syncedIds.add(iv.harvestTimeEntryId);
    totals.set(iv.date, (totals.get(iv.date) ?? 0) + durationHours(iv, new Date(now).toISOString()));
  }
  // Add Harvest-only entries (logged elsewhere) so day chips match Harvest.
  for (const e of weekHarvest ?? []) {
    if (syncedIds.has(e.id)) continue;
    totals.set(e.spentDate, (totals.get(e.spentDate) ?? 0) + e.hours);
  }

  return (
    <div className="mb-5">
      <div className="mb-2 flex items-center gap-2">
        <button onClick={() => shiftWeek(-1)} className="rounded-md px-2 py-1 text-muted hover:bg-elevated hover:text-ink" aria-label="Previous week">‹</button>
        <button onClick={() => shiftWeek(1)} className="rounded-md px-2 py-1 text-muted hover:bg-elevated hover:text-ink" aria-label="Next week">›</button>
        <button onClick={goToday} className="ml-1 rounded-md border border-hairline px-2.5 py-1 text-xs font-medium text-muted hover:text-ink">Today</button>
        <span className="ml-auto text-sm font-medium text-muted">{longDayLabel(date)}</span>
      </div>
      <div className="grid grid-cols-7 gap-1.5">
        {days.map((d) => {
          const selected = d === date;
          const isToday = d === todayIso();
          const total = totals.get(d) ?? 0;
          return (
            <button
              key={d}
              onClick={() => setDate(d)}
              className={
                'flex flex-col items-center rounded-lg border px-1 py-2 transition-colors ' +
                (selected
                  ? 'border-primary bg-primary-soft'
                  : 'border-hairline bg-surface hover:bg-elevated')
              }
            >
              <span className={'text-[11px] font-medium ' + (selected ? 'text-primary-soft-text' : 'text-muted')}>{dayLabelShort(d)}</span>
              <span className={'text-base font-semibold ' + (isToday && !selected ? 'text-primary' : 'text-ink')}>{dayNumber(d)}</span>
              <span className="tabular mt-0.5 text-[10px] text-muted">{total > 0 ? formatHours(total) : '·'}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function RunningTimerBanner() {
  const { data: running } = useRunning();
  const now = useNow(!!running);
  const { date } = useSelectedDay();
  const actions = useTrackingActions(date);
  if (!running) {
    return (
      <div className="mb-4 flex items-center gap-2.5 rounded-lg border border-hairline bg-surface px-4 py-2.5">
        <span className="h-2 w-2 rounded-full bg-muted/50" />
        <span className="text-sm text-muted">No timer running — start one from the panel on the right.</span>
      </div>
    );
  }
  const seconds = (now - parseISO(running.start).getTime()) / 1000;
  return (
    <div className="mb-4 flex items-center gap-2.5 rounded-lg border border-accent bg-accent-soft px-4 py-2.5">
      <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-accent" />
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold text-accent-strong">
          {running.projectName ? `${running.projectName} · ${running.taskName ?? ''}` : 'Tracking'}
        </div>
        <div className="truncate text-xs text-accent-strong/80">{running.notes || '—'}</div>
      </div>
      <span className="tabular ml-auto text-lg font-semibold text-accent-strong">{formatClock(seconds)}</span>
      <button
        onClick={() => actions.stop.mutate(running.id)}
        className="rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90"
      >
        Stop
      </button>
    </div>
  );
}

type ModalState =
  | { mode: 'new' }
  | { mode: 'edit'; interval: TimeInterval }
  | { mode: 'edit-harvest'; entry: HarvestTimeEntry }
  | null;

export function TimesheetPane() {
  const { date } = useSelectedDay();
  const { data: intervals } = useDayIntervals(date);
  const { data: harvestEntries } = useHarvestEntries(date, date);
  const now = useNow(true);
  const nowIso = new Date(now).toISOString();
  const [modal, setModal] = useState<ModalState>(null);

  const sorted = [...(intervals ?? [])].sort((a, b) => b.start.localeCompare(a.start));
  const syncedIds = new Set(sorted.map((i) => i.harvestTimeEntryId).filter((v): v is number => v !== undefined));
  // Harvest entries with no local counterpart — logged elsewhere, shown read-only.
  const external = (harvestEntries ?? []).filter((e) => !syncedIds.has(e.id));
  const dayTotal =
    sorted.reduce((s, i) => s + durationHours(i, nowIso), 0) + external.reduce((s, e) => s + e.hours, 0);

  return (
    <div className="mx-auto max-w-3xl">
      <DaySelector />
      <RunningTimerBanner />
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-muted">Entries</h2>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setModal({ mode: 'new' })}
            className="rounded-md border border-hairline px-2.5 py-1 text-xs font-medium text-muted hover:text-ink"
          >
            + Add entry
          </button>
          <span className="tabular text-sm font-semibold text-ink">{formatHours(dayTotal)}</span>
        </div>
      </div>
      {sorted.length === 0 && external.length === 0 ? (
        <div className="rounded-lg border border-dashed border-hairline bg-surface p-8 text-center text-sm text-muted">
          Nothing tracked for this day yet.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {sorted.map((iv) => (
            <EntryCard key={iv.id} interval={iv} nowIso={nowIso} date={date} onEdit={() => setModal({ mode: 'edit', interval: iv })} />
          ))}
          {external.map((e) => (
            <ExternalEntryCard key={`h-${e.id}`} entry={e} date={date} onEdit={() => setModal({ mode: 'edit-harvest', entry: e })} />
          ))}
        </div>
      )}

      {modal && (
        <EntryModal
          mode={modal.mode === 'new' ? 'new' : 'edit'}
          interval={modal.mode === 'edit' ? modal.interval : undefined}
          harvestEntry={modal.mode === 'edit-harvest' ? modal.entry : undefined}
          date={date}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}

function EntryCard({
  interval,
  nowIso,
  date,
  onEdit,
}: {
  interval: TimeInterval;
  nowIso: string;
  date: IsoDate;
  onEdit: () => void;
}) {
  const actions = useTrackingActions(date);
  const running = interval.end === undefined;
  const hours = durationHours(interval, nowIso);
  return (
    <div className="flex items-center gap-3 rounded-lg border border-hairline bg-surface p-3">
      <span className="h-9 w-1.5 rounded-full" style={{ backgroundColor: projectColor(interval.harvestProjectId) }} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-ink">
          {interval.projectName ? `${interval.projectName} · ${interval.taskName ?? ''}` : 'Unmapped'}
        </div>
        <div className="truncate text-xs text-muted">
          {interval.notes || '—'} <span className="tabular">· {formatTimeRange(interval.start, interval.end)}</span>
        </div>
      </div>
      <span className={'tabular text-sm font-semibold ' + (running ? 'text-accent-strong' : 'text-ink')}>
        {formatHours(hours)}
      </span>
      {running ? (
        <button onClick={() => actions.stop.mutate(interval.id)} className="rounded-md bg-accent px-2.5 py-1 text-xs font-semibold text-white hover:opacity-90">Stop</button>
      ) : (
        <>
          <button onClick={() => actions.restart.mutate(interval.id)} className="rounded-md border border-hairline px-2.5 py-1 text-xs font-medium text-muted hover:text-ink" title="Resume this entry as a new timer">Restart</button>
          <button onClick={onEdit} className="rounded-md border border-hairline px-2.5 py-1 text-xs font-medium text-muted hover:text-ink">Edit</button>
        </>
      )}
    </div>
  );
}

/** A Harvest entry with no local interval (logged directly in Harvest). Fully actionable. */
function ExternalEntryCard({ entry, date, onEdit }: { entry: HarvestTimeEntry; date: IsoDate; onEdit: () => void }) {
  const actions = useTrackingActions(date);
  return (
    <div className="flex items-center gap-3 rounded-lg border border-dashed border-hairline bg-surface p-3">
      <span className="h-9 w-1.5 rounded-full" style={{ backgroundColor: projectColor(entry.projectId) }} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-ink">
          {entry.projectName} · {entry.taskName}
        </div>
        <div className="truncate text-xs text-muted">{entry.notes || '—'}</div>
      </div>
      <span className="rounded bg-elevated px-1.5 py-0.5 text-[10px] font-medium text-muted">Harvest</span>
      <span className="tabular text-sm font-semibold text-ink">{formatHours(entry.hours)}</span>
      <button onClick={() => actions.startFromEntry.mutate(entry)} className="rounded-md bg-primary px-2.5 py-1 text-xs font-semibold text-on-primary hover:bg-primary-hover" title="Start a timer for this project/task">Start</button>
      <button onClick={onEdit} className="rounded-md border border-hairline px-2.5 py-1 text-xs font-medium text-muted hover:text-ink">Edit</button>
    </div>
  );
}
