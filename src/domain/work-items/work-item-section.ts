import type { Id } from '@domain/common/types';
import { conditionsMatch, type MappingCondition } from '@domain/templates/mapping';
import { buildWorkItemContext, type WorkItem } from '@domain/work-items/work-item';
import { buildWorkItemTree, flattenTree, type WorkItemNode } from '@domain/work-items/work-item-tree';

/**
 * User-defined groupings for the work-item rail (ADR-030). A section reuses the
 * mapping engine's `MappingCondition` list verbatim — one filter model for the
 * whole app — and adds its own presentation ordering.
 */

export type SectionSortField = 'default' | 'id' | 'title' | 'workItemType' | 'state' | 'iterationPath';
export type SortDirection = 'asc' | 'desc';

export const SECTION_SORT_FIELDS: readonly SectionSortField[] = [
  'default',
  'id',
  'title',
  'workItemType',
  'state',
  'iterationPath',
];

export interface WorkItemSection {
  readonly id: Id;
  readonly label: string;
  /** ALL must match (logical AND). Empty ⇒ matches everything. */
  readonly conditions: readonly MappingCondition[];
  /** Lower first; the first matching section claims the item. */
  readonly sortOrder: number;
  readonly enabled: boolean;
  readonly defaultCollapsed: boolean;
  /** Nest children beneath their parent when that parent is in this section. */
  readonly nestUnderParent: boolean;
  /** Keep items sharing a parent contiguous, even when the parent was never fetched. */
  readonly groupByParent: boolean;
  readonly sortBy: SectionSortField;
  readonly sortDirection: SortDirection;
}

/** Ordering applied to the trailing "Other" bucket, and the seed for a new section. */
export type SectionOrdering = Pick<
  WorkItemSection,
  'nestUnderParent' | 'groupByParent' | 'sortBy' | 'sortDirection'
>;

export const DEFAULT_SECTION_ORDERING: SectionOrdering = {
  nestUnderParent: true,
  groupByParent: true,
  sortBy: 'default',
  sortDirection: 'asc',
};

export function newWorkItemSection(id: Id, sortOrder: number): WorkItemSection {
  return {
    id,
    label: 'New section',
    conditions: [],
    sortOrder,
    enabled: true,
    defaultCollapsed: false,
    ...DEFAULT_SECTION_ORDERING,
  };
}

/** A section (or the `null` catch-all) with the tree that landed in it. */
export interface SectionBucket {
  readonly section: WorkItemSection | null;
  readonly nodes: readonly WorkItemNode[];
}

/**
 * Assign every work item to a section and order each bucket.
 *
 * Matching is evaluated on the *root* of each tree, so a Task never gets torn
 * away from the User Story it hangs under; descendants follow their root. Items
 * matching nothing land in a trailing `section: null` bucket the UI renders as
 * "Other", so a ticket can never silently vanish.
 */
export function partitionIntoSections(
  items: readonly WorkItem[],
  sections: readonly WorkItemSection[],
): SectionBucket[] {
  const ordered = sections.filter((s) => s.enabled).slice().sort((a, b) => a.sortOrder - b.sortOrder);
  const roots = buildWorkItemTree(items);

  const claimed = new Map<Id, WorkItemNode[]>(ordered.map((s) => [s.id, []]));
  const other: WorkItemNode[] = [];

  for (const root of roots) {
    const context = buildWorkItemContext(root.item);
    const match = ordered.find((s) => conditionsMatch(s.conditions, context));
    if (match) claimed.get(match.id)?.push(root);
    else other.push(root);
  }

  const buckets: SectionBucket[] = ordered.map((section) => ({
    section,
    nodes: orderSectionNodes(claimed.get(section.id) ?? [], section),
  }));
  buckets.push({ section: null, nodes: orderSectionNodes(other, DEFAULT_SECTION_ORDERING) });
  return buckets;
}

/**
 * Sort, then optionally cluster by parent, then optionally flatten.
 *
 * The clustering step is what lets "all the user stories under Feature X" read
 * as a contiguous run without us ever fetching Feature X: any two roots sharing
 * a `parentId` (i.e. whose parent wasn't retrieved) are pulled together at the
 * position of the first of them.
 */
export function orderSectionNodes(
  nodes: readonly WorkItemNode[],
  ordering: SectionOrdering,
): readonly WorkItemNode[] {
  let result = sortNodes(nodes, ordering);
  if (ordering.groupByParent) result = clusterByParent(result);
  if (!ordering.nestUnderParent) {
    result = flattenTree(result).map((item) => ({ item, children: [] }));
  }
  return result;
}

function sortNodes(nodes: readonly WorkItemNode[], ordering: SectionOrdering): WorkItemNode[] {
  const sorted =
    ordering.sortBy === 'default'
      ? nodes.slice()
      : nodes.slice().sort((a, b) => compare(a.item, b.item, ordering));
  return sorted.map((n) => ({ item: n.item, children: sortNodes(n.children, ordering) }));
}

function compare(a: WorkItem, b: WorkItem, ordering: SectionOrdering): number {
  const dir = ordering.sortDirection === 'desc' ? -1 : 1;
  const field = ordering.sortBy;
  if (field === 'default') return 0;
  if (field === 'id') return (a.id - b.id) * dir;
  return a[field].toLowerCase().localeCompare(b[field].toLowerCase()) * dir;
}

function clusterByParent(nodes: readonly WorkItemNode[]): WorkItemNode[] {
  const out: WorkItemNode[] = [];
  const anchorIndex = new Map<number, number>();
  for (const node of nodes) {
    const parentId = node.item.parentId;
    if (parentId === undefined) {
      out.push(node);
      continue;
    }
    const anchor = anchorIndex.get(parentId);
    if (anchor === undefined) {
      anchorIndex.set(parentId, out.length);
      out.push(node);
      continue;
    }
    // Insert directly after the running end of this parent's cluster and shift
    // every later anchor along so subsequent clusters stay where they were.
    let insertAt = anchor + 1;
    while (insertAt < out.length && out[insertAt]?.item.parentId === parentId) insertAt += 1;
    out.splice(insertAt, 0, node);
    for (const [key, index] of anchorIndex) {
      if (key !== parentId && index >= insertAt) anchorIndex.set(key, index + 1);
    }
  }
  return out;
}
