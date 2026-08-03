import type { IClock } from '@domain/common/clock';
import type { Id, IsoDate, IsoDateTime, TrackingSource } from '@domain/common/types';
import type {
  IAzureDevOpsClient,
  IHarvestClient,
  ISettingsRepository,
  ITimeIntervalRepository,
} from '@domain/ports';
import type { ExternalReference, HarvestTimeEntry } from '@domain/harvest/harvest-types';
import { durationHours, type TimeInterval, type WorkItemRef } from '@domain/time/time-interval';
import { Hg1, type Hg1Payload } from '@domain/harvest/hg1-metadata';

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
    const hours = round2(durationHours(merged, now));
    const synced = await this.pushToHarvest(merged, hours);
    await this.deps.intervals.upsert(synced);
    return synced;
  }

  /** Resume work on a stopped entry: start a fresh timer with the same mapping. */
  async restartInterval(id: Id, date?: IsoDate): Promise<TimeInterval> {
    const src = await this.deps.intervals.get(id);
    if (!src) throw new Error(`Interval not found: ${id}`);
    return this.startTracking({
      date: date ?? src.date,
      source: src.source,
      harvestProjectId: src.harvestProjectId,
      harvestTaskId: src.harvestTaskId,
      projectName: src.projectName,
      taskName: src.taskName,
      notes: src.notes,
      workItemRef: src.workItemRef,
      templateId: src.templateId,
    });
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
        await harvest.deleteTimeEntry(existing.harvestTimeEntryId);
      } catch (e) {
        this.warn(`Harvest delete failed: ${errMsg(e)}`);
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
    const notes = embedMetadata(interval);
    const externalReference = interval.workItemRef ? refFor(interval.workItemRef) : undefined;

    let harvestTimeEntryId = interval.harvestTimeEntryId;
    try {
      if (harvestTimeEntryId) {
        await harvest.updateTimeEntry(harvestTimeEntryId, { hours, notes, externalReference });
      } else {
        const entry = await harvest.createTimeEntry({
          projectId: interval.harvestProjectId,
          taskId: interval.harvestTaskId,
          spentDate: interval.date,
          hours,
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

/** Drop `undefined` fields so a patch never clobbers existing values. */
function definedOnly<T extends object>(patch: T): Partial<T> {
  return Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/**
 * Note body + a minimal hg1 tag. We only embed when there's something Harvest
 * can't represent (a templateId, or a non-Manual source); a plain manual entry
 * keeps clean notes. Always strips any stale block first.
 */
function embedMetadata(interval: TimeInterval): string {
  const worthEmbedding = interval.templateId !== undefined || interval.source !== 'Manual';
  if (!worthEmbedding) return Hg1.strip(interval.notes);
  const payload: Hg1Payload = { v: 1, source: interval.source, templateId: interval.templateId };
  return Hg1.embed(interval.notes, payload);
}

/** Harvest native external reference for an ADO work item (guid auto-learn is Phase 2). */
function refFor(ref: WorkItemRef): ExternalReference {
  const type = ref.workItemType.replace(/\s+/g, '');
  return {
    id: `AzureDevOps_${type}_${ref.workItemId}`,
    groupId: 'AzureDevOpsWorkItem',
    permalink: ref.url,
    service: 'dev.azure.com',
  };
}
