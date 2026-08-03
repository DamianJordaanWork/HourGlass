import { useEffect, useState } from 'react';
import type { IsoDate } from '@domain/common/types';
import type { TimeInterval } from '@domain/time/time-interval';
import { durationHours } from '@domain/time/time-interval';
import { HarvestPicker, resolveNames } from '@presentation/components/harvest-picker';
import { useTrackingActions } from '@presentation/hooks/use-tracking';
import { useHarvestOptions } from '@presentation/hooks/use-templates';
import { longDayLabel } from '@presentation/lib/format';

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
  date,
  onClose,
}: {
  mode: 'new' | 'edit';
  interval?: TimeInterval;
  date: IsoDate;
  onClose: () => void;
}) {
  const { data: options } = useHarvestOptions();
  const opts = options ?? [];
  const actions = useTrackingActions(date);

  const [projectId, setProjectId] = useState<number | undefined>(interval?.harvestProjectId);
  const [taskId, setTaskId] = useState<number | undefined>(interval?.harvestTaskId);
  const [notes, setNotes] = useState(interval?.notes ?? '');
  const [duration, setDuration] = useState(interval ? formatDuration(durationHours(interval, interval.end ?? interval.start)) : '0:00');
  const [seeded, setSeeded] = useState(mode === 'edit');

  // For a new entry, default to the first project once options load.
  useEffect(() => {
    if (!seeded && opts.length > 0) {
      setProjectId(opts[0]!.id);
      setTaskId(opts[0]!.tasks[0]?.id);
      setSeeded(true);
    }
  }, [seeded, opts]);

  const hours = parseDuration(duration);
  const isLive = mode === 'new' && hours === 0;
  const pending = actions.startManual.isPending || actions.logManual.isPending || actions.update.isPending;

  const submit = () => {
    const names = resolveNames(opts, projectId, taskId);
    const base = { harvestProjectId: projectId, harvestTaskId: taskId, notes: notes.trim(), ...names };
    if (mode === 'edit' && interval) {
      const end = new Date(new Date(interval.start).getTime() + hours * 3_600_000).toISOString();
      actions.update.mutate({ id: interval.id, patch: { ...base, end } }, { onSuccess: onClose });
    } else if (isLive) {
      actions.startManual.mutate(base, { onSuccess: onClose });
    } else {
      actions.logManual.mutate({ ...base, hours }, { onSuccess: onClose });
    }
  };

  const primaryLabel = mode === 'edit' ? 'Save changes' : isLive ? 'Start timer' : 'Add time entry';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-xl border border-hairline bg-surface p-5 shadow-[var(--shadow-card)]"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-4 text-center text-sm font-semibold text-ink">
          {mode === 'edit' ? 'Edit time entry' : `New time entry for ${longDayLabel(date)}`}
        </h3>

        <div className="flex flex-col gap-3">
          <div>
            <div className="mb-1 text-xs font-medium text-muted">Project / Task</div>
            <HarvestPicker
              options={opts}
              projectId={projectId}
              taskId={taskId}
              onChange={(p, t) => {
                setProjectId(p);
                setTaskId(t);
              }}
              allowNone
            />
          </div>

          <div className="flex gap-2">
            <input
              className={inputCls}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Notes (optional)"
            />
            <input
              className={inputCls + ' w-24 text-right tabular'}
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              placeholder="0:00"
              aria-label="Duration (h:mm)"
            />
          </div>

          {mode === 'new' && (
            <p className="text-[11px] text-muted">
              {isLive ? 'Leave the time at 0:00 to start a live timer.' : `Logs ${formatDuration(hours)} to Harvest immediately.`}
            </p>
          )}
        </div>

        <div className="mt-5 flex items-center gap-2">
          <button
            onClick={submit}
            disabled={pending}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-on-primary hover:bg-primary-hover disabled:opacity-50"
          >
            {pending ? 'Saving…' : primaryLabel}
          </button>
          <button onClick={onClose} className="rounded-lg border border-hairline px-4 py-2 text-sm font-medium text-muted hover:text-ink">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
