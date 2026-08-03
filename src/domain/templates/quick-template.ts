import type { HarvestProjectId, HarvestTaskId, Id } from '@domain/common/types';

/**
 * A standalone one-click launcher (e.g. "PR Reviews") with a preset Harvest
 * project/task and default notes. Optionally backed by an ADO saved query.
 */
export interface QuickTemplate {
  readonly id: Id;
  readonly label: string;
  readonly icon?: string;
  readonly color?: string;
  readonly harvestProjectId?: HarvestProjectId;
  readonly harvestTaskId?: HarvestTaskId;
  readonly defaultNotes?: string;
  readonly adoQuery?: string;
  readonly sortOrder: number;
  readonly enabled: boolean;
}
