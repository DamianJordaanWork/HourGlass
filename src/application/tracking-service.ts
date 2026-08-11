import type { IClock } from '@domain/common/clock';
import type { Id, IsoDate, IsoDateTime, TrackingSource } from '@domain/common/types';
import type {
  IAzureDevOpsClient,
  IHarvestClient,
  ISettingsRepository,
  ITimeIntervalRepository,
} from '@domain/ports';
import type { HarvestTimeEntry } from '@domain/harvest/harvest-types';
import { buildAdoExternalReference } from '@domain/harvest/ado-external-ref';
import { durationHours, type TimeInterval, type WorkItemRef } from '@domain/time/time-interval';
import { Hg1, type Hg1Payload } from '@domain/harvest/hg1-metadata';
import { codecFor } from '@domain/harvest/hg1-codec-registry';
import type { Hg1Scheme } from '@domain/harvest/hg1-codec';
import { UnmappedEntryError } from '@domain/errors';
import { resolveRollup, sumSyncedHours } from '@domain/services/rollup';

export interface StartInput {
  readonly date: IsoDate;
  readonly source: TrackingSource;
  readonly harvestProjectId?: number;
  readonly harvestTaskId?: number;
  readonly projectName?: string;
  readonly taskName?: string;
  readonly notes?: string;
  readonly workItemRef?: WorkItemRef;
  readonly templateId?: Id;
}

export interface ManualInput extends StartInput {
  /** Either an explicit duration… */
  readonly hours?: number;
  /** …or an explicit start/end (ISO). */
  readonly start?: IsoDateTime;
  readonly end?: IsoDateTime;
}

/** Editable fields of an existing interval. */
export interface UpdateIntervalInput {
  readonly harvestProjectId?: number;
  readonly harvestTaskId?: number;
  readonly projectName?: string;
  readonly taskName?: string;
  readonly notes?: string;
  readonly start?: IsoDateTime;
  readonly end?: IsoDateTime;
}

/** Non-fatal sync problems are surfaced but never block local persistence. */
export type SyncWarning = (message: string) => void;

/**
 * The core tracking use cases. SQLite/local is the source of truth; every
 * Harvest/ADO call is best-effort (failures warn, never throw). Each Start
 * creates a NEW interval → its own Harvest entry (no roll-up).
 */
export class TrackingService {
  constructor(
    private readonly deps: {
      intervals: ITimeIntervalRepository;
      settings: ISettingsRepository;
      clock: IClock;
      newId: () => Id;
      /**
       * Live client providers. Resolve to `undefined` when unconfigured (demo
       * mode) so sync is skipped silently; the composition root can swap the
       * underlying client at runtime without rebuilding this service.
       */
      harvest?: () => IHarvestClient | undefined;
      ado?: () => IAzureDevOpsClient | undefined;
      /** Resolves a learned Harvest⇄ADO connection GUID, if any (ADR-021). */
      adoGuid?: (connectionId: string) => Promise<string | undefined>;
      warn?: SyncWarning;
    },
  ) {}

  listDay(date: IsoDate): Promise<TimeInterval[]> {
    return this.deps.intervals.listByDate(date);
  }

  getRunning(): Promise<TimeInterval | null> {
    return this.deps.intervals.getRunning();
  }

  /** Start a live timer for `date` (the selected day). Auto-stops any running one. */
  async startTracking(input: StartInput): Promise<TimeInterval> {
    requireMapping(input.harvestProjectId, input.harvestTaskId);
    const settings = await this.deps.settings.get();
    if (settings.autoStopOnSwitch) {
      const running = await this.deps.intervals.getRunning();
      if (running) await this.stopTracking(running.id);
    }
    const now = this.deps.clock.nowIso();
    const interval: TimeInterval = {
      id: this.deps.newId(),
      date: input.date,
      harvestProjectId: input.harvestProjectId,
      harvestTaskId: input.harvestTaskId,
      projectName: input.projectName,
      taskName: input.taskName,
      notes: input.notes ?? '',
      start: now,
      end: undefined,
      isManual: false,
      source: input.source,
      workItemRef: input.workItemRef,
      templateId: input.templateId,
      createdAt: now,
      updatedAt: now,
    };
    await this.deps.intervals.upsert(interval);
    return interval;
  }

  /** Stop a running interval: compute hours and push to Harvest + ADO (best-effort). */
  async stopTracking(intervalId: Id): Promise<TimeInterval> {
    const current = await this.deps.intervals.get(intervalId);
    if (!current) throw new Error(`Interval not found: ${intervalId}`);
    if (current.end !== undefined) return current;

    const now = this.deps.clock.nowIso();
    const ended: TimeInterval = { ...current, end: now, updatedAt: now };
    const hours = round2(durationHours(ended, now));
    const synced = await this.pushToHarvest(ended, hours);
    await this.deps.intervals.upsert(synced);
    return synced;
  }

  /** Log a completed entry directly (meeting log / manual add). */
  async logManualTime(input: ManualInput): Promise<TimeInterval> {
    requireMapping(input.harvestProjectId, input.harvestTaskId);
    const now = this.deps.clock.nowIso();
    const start = input.start ?? now;
    const end =
      input.end ??
      (input.hours !== undefined
        ? new Date(new Date(start).getTime() + input.hours * 3_600_000).toISOString()
        : now);
    const interval: TimeInterval = {
      id: this.deps.newId(),
      date: input.date,
      harvestProjectId: input.harvestProjectId,
      harvestTaskId: input.harvestTaskId,
      projectName: input.projectName,
      taskName: input.taskName,
      notes: input.notes ?? '',
      start,
      end,
      isManual: true,
      source: input.source,
      workItemRef: input.workItemRef,
      templateId: input.templateId,
      createdAt: now,
      updatedAt: now,
    };
    const hours = round2(input.hours ?? durationHours(interval, now));
    const synced = await this.pushToHarvest(interval, hours);
    await this.deps.intervals.upsert(synced);
    return synced;
  }

  /** Edit an existing entry (project/task/notes/times) and re-sync best-effort. */
  async updateInterval(id: Id, patch: UpdateIntervalInput): Promise<TimeInterval> {
    const current = await this.deps.intervals.get(id);
    if (!current) throw new Error(`Interval not found: ${id}`);
    const now = this.deps.clock.nowIso();
    const merged: TimeInterval = {
      ...current,
      ...definedOnly(patch),
      isManual: true,
      updatedAt: now,
    };
    requireMapping(merged.harvestProjectId, merged.harvestTaskId);
    const hours = round2(durationHours(merged, now));
    const synced = await this.pushToHarvest(merged, hours);
    await this.deps.intervals.upsert(synced);
    return synced;
  }

  /**
   * Continue a stopped entry: reopen the SAME interval so time keeps accruing on
   * the same Harvest entry (not a new one). The start is shifted back by the time
   * already logged, so the running clock resumes from the accumulated total and,
   * on the next stop, the linked Harvest entry is updated with the new total.
   */
  async continueInterval(id: Id): Promise<TimeInterval> {
    const settings = await this.deps.settings.get();
    if (settings.autoStopOnSwitch) {
      const running = await this.deps.intervals.getRunning();
      if (running && running.id !== id) await this.stopTracking(running.id);
    }
    const current = await this.deps.intervals.get(id);
    if (!current) throw new Error(`Interval not found: ${id}`);
    if (current.end === undefined) return current; // already running
    const nowMs = new Date(this.deps.clock.nowIso()).getTime();
    const priorMs = Math.max(0, new Date(current.end).getTime() - new Date(current.start).getTime());
    const nowIso = this.deps.clock.nowIso();
    const reopened: TimeInterval = {
      ...current,
      start: new Date(nowMs - priorMs).toISOString(),
      end: undefined,
      updatedAt: nowIso,
    };
    await this.deps.intervals.upsert(reopened);
    return reopened;
  }

  /**
   * Adopt an existing Harvest entry into a local interval (Harvest is the source
   * of truth). Idempotent — returns the existing linked interval if present. No
   * Harvest write. Times are synthetic (Harvest duration entries carry no
   * start/end) but the hours are exact.
   */
  async importHarvestEntry(entry: HarvestTimeEntry): Promise<TimeInterval> {
    const existing = (await this.deps.intervals.listByDate(entry.spentDate)).find(
      (i) => i.harvestTimeEntryId === entry.id,
    );
    if (existing) return existing;
    const now = this.deps.clock.nowIso();
    const start = `${entry.spentDate}T00:00:00.000Z`;
    const end = new Date(new Date(start).getTime() + entry.hours * 3_600_000).toISOString();
    const interval: TimeInterval = {
      id: this.deps.newId(),
      date: entry.spentDate,
      harvestProjectId: entry.projectId,
      harvestTaskId: entry.taskId,
      projectName: entry.projectName,
      taskName: entry.taskName,
      notes: Hg1.strip(entry.notes),
      start,
      end,
      isManual: true,
      harvestTimeEntryId: entry.id,
      syncedHours: entry.hours,
      source: 'Manual',
      createdAt: now,
      updatedAt: now,
    };
    await this.deps.intervals.upsert(interval);
    return interval;
  }

  /** Link a local interval to an existing Harvest entry so future syncs update it. */
  async linkToHarvestEntry(intervalId: Id, harvestEntryId: number, entryHours: number): Promise<TimeInterval> {
    const current = await this.deps.intervals.get(intervalId);
    if (!current) throw new Error(`Interval not found: ${intervalId}`);
    const now = this.deps.clock.nowIso();
    const linked: TimeInterval = {
      ...current,
      harvestTimeEntryId: harvestEntryId,
      syncedHours: entryHours,
      updatedAt: now,
    };
    await this.deps.intervals.upsert(linked);
    return linked;
  }

  async deleteInterval(id: Id): Promise<void> {
    const existing = await this.deps.intervals.get(id);
    await this.deps.intervals.delete(id);
    const harvest = this.deps.harvest?.();
    if (existing?.harvestTimeEntryId && harvest) {
      try {
        const remaining = (await this.deps.intervals.listByDate(existing.date)).filter(
          (i) => i.harvestTimeEntryId === existing.harvestTimeEntryId,
        );
        if (remaining.length === 0) {
          await harvest.deleteTimeEntry(existing.harvestTimeEntryId);
        } else {
          await harvest.updateTimeEntry(existing.harvestTimeEntryId, {
            hours: round2(sumSyncedHours(remaining)),
          });
        }
      } catch (e) {
        this.warn(`Harvest delete failed: ${errMsg(e)}`);
      }
    }
    const ado = this.deps.ado?.();
    if (ado && existing?.workItemRef && existing.syncedHours) {
      try {
        await ado.syncCompletedWork(
          existing.workItemRef.connectionId,
          existing.workItemRef.workItemId,
          round2(-existing.syncedHours),
        );
      } catch (e) {
        this.warn(`ADO CompletedWork sync failed: ${errMsg(e)}`);
      }
    }
  }

  // ── best-effort remote sync ─────────────────────────────────────────────
  private async pushToHarvest(interval: TimeInterval, hours: number): Promise<TimeInterval> {
    const harvest = this.deps.harvest?.();
    const ado = this.deps.ado?.();
    if (!harvest || interval.harvestProjectId === undefined || interval.harvestTaskId === undefined) {
      return interval;
    }
    // Never push 0 hours: Harvest treats an entry with no time as a *running*
    // timer, which would collide with our local timing (a dual timer). Sub-minute
    // stops just stay local until they accrue real time.
    if (round2(hours) <= 0) {
      return interval;
    }
    const { embedMetadata: embed, hg1Scheme, aggregateSameTaskPerDay } = await this.deps.settings.get();
    const notes = embedMetadata(interval, embed, hg1Scheme);
    const guid = interval.workItemRef ? await this.deps.adoGuid?.(interval.workItemRef.connectionId) : undefined;
    const externalReference = interval.workItemRef
      ? buildAdoExternalReference(interval.workItemRef, guid)
      : undefined;

    const dayIntervals = await this.deps.intervals.listByDate(interval.date);
    const { entryId, siblingHours } = resolveRollup({
      interval,
      dayIntervals,
      aggregate: aggregateSameTaskPerDay,
    });
    const absoluteHours = round2(siblingHours + hours);

    let harvestTimeEntryId = interval.harvestTimeEntryId;
    try {
      if (entryId !== undefined) {
        await harvest.updateTimeEntry(entryId, { hours: absoluteHours, notes, externalReference });
        harvestTimeEntryId = entryId;
      } else {
        const entry = await harvest.createTimeEntry({
          projectId: interval.harvestProjectId,
          taskId: interval.harvestTaskId,
          spentDate: interval.date,
          hours: absoluteHours,
          notes,
          externalReference,
        });
        harvestTimeEntryId = entry.id;
      }
    } catch (e) {
      this.warn(`Harvest sync failed (kept locally): ${errMsg(e)}`);
    }

    if (ado && interval.workItemRef) {
      // Sync only the change since the last push so edits don't double-count.
      const delta = round2(hours - (interval.syncedHours ?? 0));
      if (delta !== 0) {
        try {
          await ado.syncCompletedWork(interval.workItemRef.connectionId, interval.workItemRef.workItemId, delta);
        } catch (e) {
          this.warn(`ADO CompletedWork sync failed: ${errMsg(e)}`);
        }
      }
    }

    return { ...interval, harvestTimeEntryId, syncedHours: hours };
  }

  private warn(message: string): void {
    this.deps.warn?.(message);
  }
}

const round2 = (n: number): number => Math.round(n * 100) / 100;
const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Harvest is the source of truth (ADR-009) — refuse to persist an unlinked entry. */
function requireMapping(projectId?: number, taskId?: number): void {
  if (projectId === undefined || taskId === undefined) throw new UnmappedEntryError();
}

/** Drop `undefined` fields so a patch never clobbers existing values. */
function definedOnly<T extends object>(patch: T): Partial<T> {
  return Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/**
 * Note body + a minimal hg1 tag. Only embedded when the user opts in (`enabled`)
 * AND there's something Harvest can't represent (a templateId, or a non-Manual
 * source). Always strips any stale block first, so turning the setting off (or
 * editing) cleans the note.
 */
function embedMetadata(interval: TimeInterval, enabled: boolean, scheme: Hg1Scheme): string {
  const worthEmbedding = enabled && (interval.templateId !== undefined || interval.source !== 'Manual');
  if (!worthEmbedding) return Hg1.strip(interval.notes);
  const payload: Hg1Payload = { v: 1, source: interval.source, templateId: interval.templateId };
  return Hg1.embed(interval.notes, payload, codecFor(scheme));
}
