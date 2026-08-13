import type { WorkItem } from '@domain/work-items/work-item';
import type { WorkItemNode } from '@domain/work-items/work-item-tree';

/**
 * Client-side ticket search, in the same spirit as `filterCommands`: cheap
 * case-insensitive substring matching over the fields you'd actually type.
 * `#123` and `123` both find ticket 123.
 */
export function matchesWorkItem(item: WorkItem, query: string): boolean {
  const q = query.trim().toLowerCase().replace(/^#/, '');
  if (q === '') return true;
  return (
    String(item.id).includes(q) ||
    item.title.toLowerCase().includes(q) ||
    item.workItemType.toLowerCase().includes(q) ||
    item.state.toLowerCase().includes(q) ||
    item.project.toLowerCase().includes(q) ||
    item.tags.some((t) => t.toLowerCase().includes(q))
  );
}

/**
 * Prune a tree to matching items, keeping the ancestors of any match so a
 * matched Task still reads under its User Story. An empty query is a no-op.
 */
export function filterWorkItemTree(nodes: readonly WorkItemNode[], query: string): WorkItemNode[] {
  if (query.trim() === '') return [...nodes];
  const prune = (node: WorkItemNode): WorkItemNode | null => {
    const children = node.children.map(prune).filter((n): n is WorkItemNode => n !== null);
    if (children.length === 0 && !matchesWorkItem(node.item, query)) return null;
    return { item: node.item, children };
  };
  return nodes.map(prune).filter((n): n is WorkItemNode => n !== null);
}

/** Flat variant for the picker, which shows one row per ticket. */
export function filterWorkItems(items: readonly WorkItem[], query: string): WorkItem[] {
  return items.filter((i) => matchesWorkItem(i, query));
}
