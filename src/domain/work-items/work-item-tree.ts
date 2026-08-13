import type { WorkItem } from '@domain/work-items/work-item';

/**
 * Parent/child structure over a flat work-item list. Pure: whatever the fetch
 * layer managed to retrieve is all we nest — an item whose parent isn't in the
 * set is simply a root (see ADR-030; we deliberately don't chase ancestors
 * beyond one Task→Story hop).
 */
export interface WorkItemNode {
  readonly item: WorkItem;
  readonly children: readonly WorkItemNode[];
}

/**
 * Build the forest. Siblings keep their incoming order; duplicates (the same id
 * returned by two queries) are collapsed onto the first occurrence, and a
 * parent cycle degrades to roots rather than looping forever.
 */
export function buildWorkItemTree(items: readonly WorkItem[]): WorkItemNode[] {
  const unique: WorkItem[] = [];
  const byId = new Map<number, WorkItem>();
  for (const item of items) {
    if (byId.has(item.id)) continue;
    byId.set(item.id, item);
    unique.push(item);
  }

  const childrenOf = new Map<number, WorkItem[]>();
  const roots: WorkItem[] = [];
  for (const item of unique) {
    const parentId = item.parentId;
    if (parentId === undefined || parentId === item.id || !byId.has(parentId) || isCyclic(item, byId)) {
      roots.push(item);
      continue;
    }
    const siblings = childrenOf.get(parentId);
    if (siblings) siblings.push(item);
    else childrenOf.set(parentId, [item]);
  }

  const toNode = (item: WorkItem): WorkItemNode => ({
    item,
    children: (childrenOf.get(item.id) ?? []).map(toNode),
  });
  return roots.map(toNode);
}

/** Depth-first flatten — parents immediately followed by their descendants. */
export function flattenTree(nodes: readonly WorkItemNode[]): WorkItem[] {
  const out: WorkItem[] = [];
  const walk = (list: readonly WorkItemNode[]): void => {
    for (const node of list) {
      out.push(node.item);
      walk(node.children);
    }
  };
  walk(nodes);
  return out;
}

/** Count items in a subtree (used for the collapsed-section badge). */
export function countNodes(nodes: readonly WorkItemNode[]): number {
  return nodes.reduce((sum, n) => sum + 1 + countNodes(n.children), 0);
}

/** Walk up the parent chain; true if we come back around to where we started. */
function isCyclic(item: WorkItem, byId: ReadonlyMap<number, WorkItem>): boolean {
  const seen = new Set<number>([item.id]);
  let cursor = item.parentId !== undefined ? byId.get(item.parentId) : undefined;
  while (cursor) {
    if (seen.has(cursor.id)) return true;
    seen.add(cursor.id);
    cursor = cursor.parentId !== undefined ? byId.get(cursor.parentId) : undefined;
  }
  return false;
}
