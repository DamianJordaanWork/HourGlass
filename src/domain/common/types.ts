/** Shared primitive aliases for the domain. Kept structural (no branding) for simplicity. */

/** Local calendar date, `YYYY-MM-DD` (no timezone). */
export type IsoDate = string;

/** Instant in ISO-8601 with offset, e.g. `2026-08-03T09:15:00Z`. */
export type IsoDateTime = string;

/** Opaque local identifier (uuid) for rows we own. */
export type Id = string;

/** Harvest numeric ids. */
export type HarvestProjectId = number;
export type HarvestTaskId = number;

/** Where a tracked interval originated. */
export type TrackingSource = 'WorkItem' | 'Meeting' | 'QuickTemplate' | 'Manual';
