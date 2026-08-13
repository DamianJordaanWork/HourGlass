import type { WorkItem } from '@domain/work-items/work-item';
import type { WorkItemLink } from '@domain/time/time-interval';

/**
 * The one place a `WorkItem` becomes a persisted link. Carries the title so an
 * entry can show what it's linked to without another ADO round-trip.
 */
export function toWorkItemLink(item: WorkItem): WorkItemLink {
  return {
    connectionId: item.connectionId,
    workItemId: item.id,
    workItemType: item.workItemType,
    url: item.url,
    title: item.title,
  };
}
