import { describe, expect, it } from 'vitest';
import type { WorkItem } from '@domain/work-items/work-item';
import { buildWorkItemTree, countNodes, flattenTree } from '@domain/work-items/work-item-tree';

function wi(id: number, over: Partial<WorkItem> = {}): WorkItem {
  return {
    id,
    title: `Item ${id}`,
    workItemType: 'Task',
    state: 'Active',
    project: 'Demo',
    iterationPath: 'Demo\\Sprint 1',
    areaPath: 'Demo',
    tags: [],
    connectionId: 'c1',
    url: `https://example/${id}`,
    ...over,
  };
}

describe('buildWorkItemTree', () => {
  it('nests children under a parent that is present', () => {
    const tree = buildWorkItemTree([wi(1, { workItemType: 'User Story' }), wi(2, { parentId: 1 }), wi(3, { parentId: 1 })]);
    expect(tree).toHaveLength(1);
    expect(tree[0]?.item.id).toBe(1);
    expect(tree[0]?.children.map((c) => c.item.id)).toEqual([2, 3]);
  });

  it('treats an item whose parent was never fetched as a root', () => {
    const tree = buildWorkItemTree([wi(2, { parentId: 99 }), wi(3, { parentId: 99 })]);
    expect(tree.map((n) => n.item.id)).toEqual([2, 3]);
  });

  it('preserves incoming order among siblings and roots', () => {
    const tree = buildWorkItemTree([wi(5), wi(1), wi(3)]);
    expect(tree.map((n) => n.item.id)).toEqual([5, 1, 3]);
  });

  it('collapses duplicate ids onto the first occurrence', () => {
    const tree = buildWorkItemTree([wi(1, { title: 'first' }), wi(1, { title: 'second' })]);
    expect(tree).toHaveLength(1);
    expect(tree[0]?.item.title).toBe('first');
  });

  it('degrades a parent cycle to roots instead of looping', () => {
    const tree = buildWorkItemTree([wi(1, { parentId: 2 }), wi(2, { parentId: 1 })]);
    expect(tree.map((n) => n.item.id).sort()).toEqual([1, 2]);
  });

  it('ignores an item that claims itself as parent', () => {
    const tree = buildWorkItemTree([wi(1, { parentId: 1 })]);
    expect(tree).toHaveLength(1);
    expect(tree[0]?.children).toHaveLength(0);
  });

  it('nests three levels deep', () => {
    const tree = buildWorkItemTree([
      wi(1, { workItemType: 'Feature' }),
      wi(2, { workItemType: 'User Story', parentId: 1 }),
      wi(3, { parentId: 2 }),
    ]);
    expect(tree[0]?.children[0]?.children[0]?.item.id).toBe(3);
    expect(countNodes(tree)).toBe(3);
  });
});

describe('flattenTree', () => {
  it('emits parents immediately before their descendants', () => {
    const tree = buildWorkItemTree([wi(1), wi(2, { parentId: 1 }), wi(9)]);
    expect(flattenTree(tree).map((i) => i.id)).toEqual([1, 2, 9]);
  });
});
