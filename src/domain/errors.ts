/**
 * Thrown when an operation would create or save a time entry without a Harvest
 * project + task link. Harvest is the source of truth (ADR-009) — every
 * persisted entry must be linkable to a real Harvest project/task.
 */
export class UnmappedEntryError extends Error {
  constructor(message = 'A Harvest project and task are required before this entry can be saved.') {
    super(message);
    this.name = 'UnmappedEntryError';
  }
}
