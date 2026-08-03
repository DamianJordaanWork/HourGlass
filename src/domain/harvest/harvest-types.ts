import type { HarvestProjectId, HarvestTaskId, IsoDate } from '@domain/common/types';

export interface HarvestTask {
  readonly id: HarvestTaskId;
  readonly name: string;
}

export interface HarvestProject {
  readonly id: HarvestProjectId;
  readonly name: string;
  readonly code?: string;
  readonly clientName?: string;
  readonly tasks: readonly HarvestTask[];
}

/** Harvest's native external reference — how logged time links back into ADO's widget. */
export interface ExternalReference {
  /** Composite id, e.g. `AzureDevOps_{connectionGuid}_{workItemType}_{numericId}`. */
  readonly id: string;
  readonly groupId: string; // 'AzureDevOpsWorkItem'
  readonly permalink: string;
  readonly service: string; // 'dev.azure.com'
}

export interface HarvestTimeEntry {
  readonly id: number;
  readonly spentDate: IsoDate;
  readonly hours: number;
  readonly notes: string;
  readonly projectId: HarvestProjectId;
  readonly projectName: string;
  readonly taskId: HarvestTaskId;
  readonly taskName: string;
  readonly isRunning: boolean;
  readonly externalReference?: ExternalReference;
}

export interface CreateTimeEntry {
  readonly projectId: HarvestProjectId;
  readonly taskId: HarvestTaskId;
  readonly spentDate: IsoDate;
  /** Omit to start a Harvest-side running timer; include to log a fixed duration. */
  readonly hours?: number;
  readonly notes?: string;
  readonly externalReference?: ExternalReference;
}

export interface UpdateTimeEntry {
  readonly hours?: number;
  readonly notes?: string;
  readonly projectId?: HarvestProjectId;
  readonly taskId?: HarvestTaskId;
  readonly externalReference?: ExternalReference;
}
