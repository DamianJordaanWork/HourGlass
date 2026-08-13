import type { MatchContext } from '@domain/templates/mapping';

/** An Azure DevOps work item as Hourglass needs it (subset of the ADO fields). */
export interface WorkItem {
  readonly id: number;
  readonly title: string;
  readonly workItemType: string; // 'User Story' | 'Bug' | 'Task' | ...
  readonly state: string;
  readonly project: string;
  readonly iterationPath: string;
  readonly areaPath: string;
  readonly assignedTo?: string;
  readonly tags: readonly string[];
  /** `System.Parent` — the work item this one hangs off, when it has one. */
  readonly parentId?: number;
  /** Which configured ADO connection this came from. */
  readonly connectionId: string;
  readonly url: string;
}

/** Build the field→value context the TemplateMatcher evaluates against. */
export function buildWorkItemContext(item: WorkItem): MatchContext {
  return {
    id: String(item.id),
    title: item.title,
    workItemType: item.workItemType,
    state: item.state,
    project: item.project,
    iterationPath: item.iterationPath,
    areaPath: item.areaPath,
    assignedTo: item.assignedTo,
    tags: item.tags,
  };
}
