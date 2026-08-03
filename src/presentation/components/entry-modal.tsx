import { useEffect, useState } from 'react';
import { format, parseISO } from 'date-fns';
import type { IsoDate } from '@domain/common/types';
import type { HarvestTimeEntry } from '@domain/harvest/harvest-types';
import type { TimeInterval } from '@domain/time/time-interval';
import { durationHours } from '@domain/time/time-interval';
import type { UpdateIntervalInput } from '@application/tracking-service';
import { HarvestPicker, resolveNames } from '@presentation/components/harvest-picker';
import { useHarvestEntries, useTrackingActions } from '@presentation/hooks/use-tracking';
import { useHarvestOptions } from '@presentation/hooks/use-templates';
import { formatHours, longDayLabel } from '@presentation/lib/format';

const inputCls =
  'w-full rounded-lg border border-hairline bg-canvas px-3 py-2 text-sm text-ink outline-none placeholder:text-muted focus:border-primary';

const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

/** "H:MM" (or a bare decimal) → decimal hours. */
function parseDuration(text: string): number {
  const clock = text.trim().match(/^(\d+):([0-5]?\d)$/);
  if (clock) return Number(clock[1]) + Number(clock[2]) / 60;
  const dec = Number(text);
  return Number.isFinite(dec) && dec > 0 ? dec : 0;
}
function formatDuration(hours: number): string {
  const total = Math.max(0, Math.round(hours * 60));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
function minutesOf(hhmm: string): number | null {
  const m = TIME_RE.exec(hhmm.trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
function hhmmFromMinutes(min: number): string {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
/** Local wall-clock time (HH:MM) of an ISO instant. */
function localTime(iso: string): string {
  return format(parseISO(iso), 'HH:mm');
}
/** ISO instant for a local HH:MM on `date` (no trailing Z ⇒ parsed as local). */
function isoOf(date: IsoDate, hhmm: string): string {
  return new Date(`${date}T${hhmm}:00`).toISOString();
}

export function EntryModal({
  mode,
  interval,
  harvestEntry,
  date,
  onClose,
}: {
  mode: 'new' | 'edit';
  interval?: TimeInterval;
  harvestEntry?: HarvestTimeEntry;
  date: IsoDate;
  onClose: () => void;
}) {
  const { data: options } = useHarvestOptions();
  const opts = options ?? [];
  const actions = useTrackingActions(date);
  const external = harvestEntry !== undefined && interval === undefined;

  const initialHours = interval
    ? durationHours(interval, interval.end ?? interval.start)
    : (harvestEntry?.hours ?? 0);

  const [projectId, setProjectId] = useState<number | undefined>(interval?.harvestProjectId ?? harvestEntry?.projectId);
  const [taskId, setTaskId] = useState<number | undefined>(interval?.harvestTaskId ?? harvestEntry?.taskId);
  const [notes, setNotes] = useState(interval?.notes ?? harvestEntry?.notes ?? '');
  // Times are optional "extras". Only a real, stopped interval seeds them.
  const [startTime, setStartTime] = useState(interval?.end ? localTime(interval.start) : '');
  const [endTime, setEndTime] = useState(interval?.end ? localTime(interval.end) : '');
  const [duration, setDuration] = useState(mode === 'edit' ? formatDuration(initialHours) : '0:00');
  const [seeded, setSeeded] = useState(mode === 'edit');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showLink, setShowLink] = useState(false);

  useEffect(() => {
    if (!seeded && opts.length > 0) {
      setProjectId(opts[0]!.id);
      setTaskId(opts[0]!.tasks[0]?.id);
      setSeeded(true);
    }
  }, [seeded, opts]);

  // ── keep start / end / duration consistent as the user types ──────────────
  const onStart = (v: string) => {
    setStartTime(v);
    const s = minutesOf(v);
    const e = minutesOf(endTime);
    if (s !== null && e !== null) setDuration(formatDuration(Math.max(0, e - s) / 60));
  };
  const onEnd = (v: string) => {
    setEndTime(v);
    const s = minutesOf(startTime);
    const e = minutesOf(v);
    if (s !== null && e !== null) setDuration(formatDuration(Math.max(0, e - s) / 60));
  };
  const onDuration = (v: string) => {
    setDuration(v);
    const mins = Math.round(parseDuration(v) * 60);
    const s = minutesOf(startTime);
    const e = minutesOf(endTime);
    if (s !== null) setEndTime(hhmmFromMinutes(s + mins));
    else if (e !== null) setStartTime(hhmmFromMinutes(e - mins));
  };

  /** Resolve the chosen times into { startIso?, endIso?, hours }. */
  const resolveTimes = () => {
    const s = minutesOf(startTime);
    const e = minutesOf(endTime);
    const h = parseDuration(duration);
    if (s !== null && e !== null) {
      const hours = Math.max(0, (e - s) / 60);
      return { startIso: isoOf(date, startTime), endIso: isoOf(date, endTime), hours };
    }
    if (s !== null && h > 0) {
      const startIso = isoOf(date, startTime);
      return { startIso, endIso: new Date(new Date(startIso).getTime() + h * 3_600_000).toISOString(), hours: h };
    }
    if (e !== null && h > 0) {
      const endIso = isoOf(date, endTime);
      return { startIso: new Date(new Date(endIso).getTime() - h * 3_600_000).toISOString(), endIso, hours: h };
    }
    return { startIso: undefined as string | undefined, endIso: undefined as string | undefined, hours: h };
  };

  const hours = parseDuration(duration);
  const noTimes = minutesOf(startTime) === null && minutesOf(endTime) === null;
  const isLive = mode === 'new' && hours === 0 && noTimes;
  const pending =
    actions.startManual.isPending ||
    actions.logManual.isPending ||
    actions.update.isPending ||
    actions.editExternal.isPending;

  const submit = () => {
    const names = resolveNames(opts, projectId, taskId);
    const base = { harvestProjectId: projectId, harvestTaskId: taskId, notes: notes.trim(), ...names };
    const { startIso, endIso, hours: h } = resolveTimes();

    if (mode === 'new') {
      if (isLive) {
        actions.startManual.mutate(base, { onSuccess: onClose });
      } else {
        actions.logManual.mutate({ ...base, hours: h, start: startIso, end: endIso }, { onSuccess: onClose });
      }
      return;
    }

    // edit: prefer explicit times; fall back to duration off the anchor start.
    let times: Pick<UpdateIntervalInput, 'start' | 'end'>;
    if (startIso && endIso) {
      times = { start: startIso, end: endIso };
    } else {
      const anchor = startIso ?? interval?.start ?? `${date}T00:00:00.000Z`;
      times = { start: anchor, end: new Date(new Date(anchor).getTime() + h * 3_600_000).toISOString() };
    }
    const patch: UpdateIntervalInput = { ...base, ...times };
    if (external && harvestEntry) {
      actions.editExternal.mutate({ entry: harvestEntry, patch }, { onSuccess: onClose });
    } else if (interval) {
      actions.update.mutate({ id: interval.id, patch }, { onSuccess: onClose });
    }
  };

  const remove = () => {
    if (external && harvestEntry) actions.deleteHarvestEntry.mutate(harvestEntry.id, { onSuccess: onClose });
    else if (interval) actions.remove.mutate(interval.id, { onSuccess: onClose });
  };

  const primaryLabel = mode === 'edit' ? 'Save changes' : isLive ? 'Start timer' : 'Add time entry';
  const title = mode === 'edit' ? (external ? 'Edit Harvest entry' : 'Edit time entry') : `New time entry for ${longDayLabel(date)}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl border border-hairline bg-surface p-5 shadow-[var(--shadow-card)]" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-4 text-center text-sm font-semibold text-ink">{title}</h3>

        <div className="flex flex-col gap-3">
          <div>
            <div className="mb-1 text-xs font-medium text-muted">Project / Task</div>
            <HarvestPicker options={opts} projectId={projectId} taskId={taskId} onChange={(p, t) => { setProjectId(p); setTaskId(t); }} allowNone />
          </div>

          <input className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes (optional)" />

          {/* Time — set any of: start+end, start+duration, end+duration, or just duration */}
          <div className="grid grid-cols-3 gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-muted">Start <span className="opacity-60">(opt)</span></span>
              <input className={inputCls} type="time" value={startTime} onChange={(e) => onStart(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-muted">End <span className="opacity-60">(opt)</span></span>
              <input className={inputCls} type="time" value={endTime} onChange={(e) => onEnd(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-muted">Duration</span>
              <input className={inputCls + ' text-right tabular'} value={duration} onChange={(e) => onDuration(e.target.value)} placeholder="0:00" aria-label="Duration (h:mm)" />
            </label>
          </div>

          {mode === 'new' && (
            <p className="text-[11px] text-muted">
              {isLive ? 'Leave everything blank to start a live timer.' : `Logs ${formatDuration(hours)} to Harvest immediately.`}
            </p>
          )}

          {mode === 'edit' && !external && interval && (
            <div>
              <button className="text-[11px] font-medium text-primary hover:underline" onClick={() => setShowLink((s) => !s)}>
                {interval.harvestTimeEntryId ? `Linked to Harvest #${interval.harvestTimeEntryId} · re-link` : 'Link to an existing Harvest entry'}
              </button>
              {showLink && <LinkPicker date={date} intervalId={interval.id} onLinked={() => setShowLink(false)} />}
            </div>
          )}
        </div>

        <div className="mt-5 flex items-center gap-2">
          <button onClick={submit} disabled={pending} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-on-primary hover:bg-primary-hover disabled:opacity-50">
            {pending ? 'Saving…' : primaryLabel}
          </button>
          <button onClick={onClose} className="rounded-lg border border-hairline px-4 py-2 text-sm font-medium text-muted hover:text-ink">Cancel</button>
          {mode === 'edit' && (
            <div className="ml-auto">
              {confirmDelete ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted">Delete?</span>
                  <button onClick={remove} className="rounded-lg bg-[color:var(--danger)] px-3 py-2 text-sm font-semibold text-white hover:opacity-90">Yes, delete</button>
                  <button onClick={() => setConfirmDelete(false)} className="rounded-lg border border-hairline px-3 py-2 text-sm text-muted hover:text-ink">No</button>
                </div>
              ) : (
                <button onClick={() => setConfirmDelete(true)} className="rounded-lg border border-hairline px-3 py-2 text-sm font-medium text-muted hover:text-danger">Delete</button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Pick one of the day's Harvest entries to link the current interval to. */
function LinkPicker({ date, intervalId, onLinked }: { date: IsoDate; intervalId: string; onLinked: () => void }) {
  const { data: entries } = useHarvestEntries(date, date);
  const actions = useTrackingActions(date);
  if (!entries?.length) return <p className="mt-2 text-[11px] text-muted">No Harvest entries for this day.</p>;
  return (
    <ul className="mt-2 flex max-h-40 flex-col gap-1 overflow-auto rounded-lg border border-hairline p-1">
      {entries.map((e) => (
        <li key={e.id}>
          <button
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-elevated"
            onClick={() => actions.linkHarvest.mutate({ intervalId, entry: e }, { onSuccess: onLinked })}
          >
            <span className="min-w-0 flex-1 truncate text-ink">{e.projectName} · {e.taskName}</span>
            <span className="tabular shrink-0 text-muted">{formatHours(e.hours)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
