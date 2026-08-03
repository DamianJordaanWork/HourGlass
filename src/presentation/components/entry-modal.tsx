import { useEffect, useState } from 'react';
import type { IsoDate } from '@domain/common/types';
import type { HarvestTimeEntry } from '@domain/harvest/harvest-types';
import type { TimeInterval } from '@domain/time/time-interval';
import { durationHours } from '@domain/time/time-interval';
import { HarvestPicker, resolveNames } from '@presentation/components/harvest-picker';
import { useHarvestEntries, useTrackingActions } from '@presentation/hooks/use-tracking';
import { useHarvestOptions } from '@presentation/hooks/use-templates';
import { formatHours, longDayLabel } from '@presentation/lib/format';

const inputCls =
  'w-full rounded-lg border border-hairline bg-canvas px-3 py-2 text-sm text-ink outline-none placeholder:text-muted focus:border-primary';

/** "H:MM" → decimal hours (also accepts a bare decimal like "1.5"). */
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

  const initialProject = interval?.harvestProjectId ?? harvestEntry?.projectId;
  const initialTask = interval?.harvestTaskId ?? harvestEntry?.taskId;
  const initialNotes = interval?.notes ?? harvestEntry?.notes ?? '';
  const initialHours = interval
    ? durationHours(interval, interval.end ?? interval.start)
    : (harvestEntry?.hours ?? 0);

  const [projectId, setProjectId] = useState<number | undefined>(initialProject);
  const [taskId, setTaskId] = useState<number | undefined>(initialTask);
  const [notes, setNotes] = useState(initialNotes);
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

  const hours = parseDuration(duration);
  const isLive = mode === 'new' && hours === 0;
  const pending =
    actions.startManual.isPending ||
    actions.logManual.isPending ||
    actions.update.isPending ||
    actions.editExternal.isPending;

  const submit = () => {
    const names = resolveNames(opts, projectId, taskId);
    const base = { harvestProjectId: projectId, harvestTaskId: taskId, notes: notes.trim(), ...names };
    if (mode === 'new') {
      if (isLive) actions.startManual.mutate(base, { onSuccess: onClose });
      else actions.logManual.mutate({ ...base, hours }, { onSuccess: onClose });
      return;
    }
    // edit: recompute end from the anchor start + duration.
    const anchor = interval?.start ?? `${date}T00:00:00.000Z`;
    const end = new Date(new Date(anchor).getTime() + hours * 3_600_000).toISOString();
    const patch = { ...base, end };
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

          <div className="flex gap-2">
            <input className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes (optional)" />
            <input className={inputCls + ' w-24 text-right tabular'} value={duration} onChange={(e) => setDuration(e.target.value)} placeholder="0:00" aria-label="Duration (h:mm)" />
          </div>

          {mode === 'new' && (
            <p className="text-[11px] text-muted">
              {isLive ? 'Leave the time at 0:00 to start a live timer.' : `Logs ${formatDuration(hours)} to Harvest immediately.`}
            </p>
          )}

          {/* Link a local entry to an existing Harvest entry */}
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
