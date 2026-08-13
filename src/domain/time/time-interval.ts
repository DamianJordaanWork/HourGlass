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
 * One of possibly several ADO tickets worked on during an interval (ADR-029).
 * The first link is the *primary*: it owns the Harvest `external_reference`,
 * which Harvest only lets us set once.
 */
export interface WorkItemLink extends WorkItemRef {
  /** Cached title so the UI can render a link without refetching from ADO. */
  readonly title?: string;
  /** Explicit hours attributed to this ticket; undefined ⇒ share the remainder. */
  readonly hours?: number;
  /** Hours last pushed to THIS ticket's ADO CompletedWork. */
  readonly syncedHours?: number;
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
  /** The primary ticket — always mirrors `workItemLinks[0]`. Kept for the Harvest
   *  external reference and for intervals written before multi-ticket support. */
  readonly workItemRef?: WorkItemRef;
  /** Every ticket worked on during this interval, primary first. */
  readonly workItemLinks?: readonly WorkItemLink[];
  readonly templateId?: Id;
  readonly createdAt: IsoDateTime;
  readonly updatedAt: IsoDateTime;
}

export const isRunning = (i: TimeInterval): boolean => i.end === undefined;

/** Narrow a link back to the bare ref shape Harvest/ADO helpers expect. */
export function toWorkItemRef(link: WorkItemRef): WorkItemRef {
  return {
    connectionId: link.connectionId,
    workItemId: link.workItemId,
    workItemType: link.workItemType,
    url: link.url,
  };
}

/**
 * Every ticket on an interval, tolerating both shapes: pre-multi-ticket rows
 * only ever carry `workItemRef`.
 */
export function workItemLinksOf(i: Pick<TimeInterval, 'workItemRef' | 'workItemLinks'>): readonly WorkItemLink[] {
  if (i.workItemLinks?.length) return i.workItemLinks;
  return i.workItemRef ? [i.workItemRef] : [];
}

/**
 * Keep `workItemRef` and `workItemLinks` consistent on write: the primary is
 * always the head of the list, and an empty list clears both.
 */
export function normalizeWorkItemLinks<T extends Pick<TimeInterval, 'workItemRef' | 'workItemLinks'>>(
  interval: T,
): T {
  const links = workItemLinksOf(interval);
  const head = links[0];
  return {
    ...interval,
    workItemLinks: links.length > 0 ? links : undefined,
    workItemRef: head ? toWorkItemRef(head) : undefined,
  };
}

/** Elapsed hours; for a running interval, measured against `nowIso`. */
export function durationHours(i: TimeInterval, nowIso: IsoDateTime): number {
  const endMs = new Date(i.end ?? nowIso).getTime();
  const ms = endMs - new Date(i.start).getTime();
  return Math.max(0, ms / 3_600_000);
}
