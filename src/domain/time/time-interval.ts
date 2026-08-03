import type {
  HarvestProjectId,
  HarvestTaskId,
  Id,
  IsoDate,
  IsoDateTime,
  TrackingSource,
} from '@domain/common/types';

/** Link back to the originating ADO work item. */
export interface WorkItemRef {
  readonly connectionId: string;
  readonly workItemId: number;
  readonly workItemType: string;
  readonly url: string;
}

/**
 * The granular unit of tracking: one start/stop session or one manual entry.
 * Each Start creates a new interval; by default it maps to its own Harvest entry.
 */
export interface TimeInterval {
  readonly id: Id;
  readonly date: IsoDate;
  readonly harvestProjectId?: HarvestProjectId;
  readonly harvestTaskId?: HarvestTaskId;
  readonly projectName?: string;
  readonly taskName?: string;
  readonly notes: string;
  readonly start: IsoDateTime;
  /** undefined ⇒ still running. */
  readonly end?: IsoDateTime;
  readonly isManual: boolean;
  readonly harvestTimeEntryId?: number;
  /** Hours last pushed to Harvest — lets edits sync an accurate ADO delta. */
  readonly syncedHours?: number;
  readonly source: TrackingSource;
  readonly workItemRef?: WorkItemRef;
  readonly templateId?: Id;
  readonly createdAt: IsoDateTime;
  readonly updatedAt: IsoDateTime;
}

export const isRunning = (i: TimeInterval): boolean => i.end === undefined;

/** Elapsed hours; for a running interval, measured against `nowIso`. */
export function durationHours(i: TimeInterval, nowIso: IsoDateTime): number {
  const endMs = new Date(i.end ?? nowIso).getTime();
  const ms = endMs - new Date(i.start).getTime();
  return Math.max(0, ms / 3_600_000);
}
