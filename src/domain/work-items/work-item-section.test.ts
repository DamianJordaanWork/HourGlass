import { describe, expect, it } from 'vitest';
import type { WorkItem } from '@domain/work-items/work-item';
import {
  DEFAULT_SECTION_ORDERING,
  orderSectionNodes,
  partitionIntoSections,
  type WorkItemSection,
} from '@domain/work-items/work-item-section';
import { buildWorkItemTree } from '@domain/work-items/work-item-tree';

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

function section(over: Partial<WorkItemSection> = {}): WorkItemSection {
  return {
    id: 's1',
    label: 'Section',
    conditions: [],
    sortOrder: 0,
    enabled: true,
    defaultCollapsed: false,
    ...DEFAULT_SECTION_ORDERING,
    ...over,
  };
}

describe('partitionIntoSections', () => {
  it('claims items with the first matching section, by sortOrder', () => {
    const bugs = section({ id: 'bugs', sortOrder: 1, conditions: [{ field: 'workItemType', operator: 'equals', value: 'Bug' }] });
    const all = section({ id: 'all', sortOrder: 2, conditions: [] });
    const buckets = partitionIntoSections([wi(1, { workItemType: 'Bug' }), wi(2)], [all, bugs]);
    // `bugs` has the lower sortOrder so it wins despite being listed second.
    expect(buckets[0]?.section?.id).toBe('bugs');
    expect(buckets[0]?.nodes.map((n) => n.item.id)).toEqual([1]);
    expect(buckets[1]?.nodes.map((n) => n.item.id)).toEqual([2]);
  });

  it('puts unmatched items in a trailing null bucket', () => {
    const bugs = section({ conditions: [{ field: 'workItemType', operator: 'equals', value: 'Bug' }] });
    const buckets = partitionIntoSections([wi(1), wi(2, { workItemType: 'Bug' })], [bugs]);
    const other = buckets[buckets.length - 1];
    expect(other?.section).toBeNull();
    expect(other?.nodes.map((n) => n.item.id)).toEqual([1]);
  });

  it('skips disabled sections', () => {
    const off = section({ enabled: false, conditions: [] });
    const buckets = partitionIntoSections([wi(1)], [off]);
    expect(buckets).toHaveLength(1);
    expect(buckets[0]?.section).toBeNull();
  });

  it('matches on the root, so children follow their parent regardless of type', () => {
    const stories = section({ conditions: [{ field: 'workItemType', operator: 'equals', value: 'User Story' }] });
    const buckets = partitionIntoSections(
      [wi(1, { workItemType: 'User Story' }), wi(2, { workItemType: 'Task', parentId: 1 })],
      [stories],
    );
    expect(buckets[0]?.nodes[0]?.children.map((c) => c.item.id)).toEqual([2]);
    expect(buckets[1]?.nodes).toHaveLength(0);
  });
});

describe('orderSectionNodes', () => {
  const nodes = (items: WorkItem[]) => buildWorkItemTree(items);

  it('preserves incoming order for sortBy default', () => {
    const out = orderSectionNodes(nodes([wi(3), wi(1), wi(2)]), { ...DEFAULT_SECTION_ORDERING, groupByParent: false });
    expect(out.map((n) => n.item.id)).toEqual([3, 1, 2]);
  });

  it('sorts numerically by id, both directions', () => {
    const input = nodes([wi(3), wi(1), wi(20)]);
    const asc = orderSectionNodes(input, { ...DEFAULT_SECTION_ORDERING, groupByParent: false, sortBy: 'id' });
    expect(asc.map((n) => n.item.id)).toEqual([1, 3, 20]);
    const desc = orderSectionNodes(input, {
      ...DEFAULT_SECTION_ORDERING,
      groupByParent: false,
      sortBy: 'id',
      sortDirection: 'desc',
    });
    expect(desc.map((n) => n.item.id)).toEqual([20, 3, 1]);
  });

  it('sorts case-insensitively by title', () => {
    const out = orderSectionNodes(
      nodes([wi(1, { title: 'beta' }), wi(2, { title: 'Alpha' })]),
      { ...DEFAULT_SECTION_ORDERING, groupByParent: false, sortBy: 'title' },
    );
    expect(out.map((n) => n.item.title)).toEqual(['Alpha', 'beta']);
  });

  it('sorts children with the same comparator', () => {
    const out = orderSectionNodes(
      nodes([wi(1), wi(9, { parentId: 1 }), wi(4, { parentId: 1 })]),
      { ...DEFAULT_SECTION_ORDERING, groupByParent: false, sortBy: 'id' },
    );
    expect(out[0]?.children.map((c) => c.item.id)).toEqual([4, 9]);
  });

  it('clusters items whose parent was never fetched', () => {
    // Two stories under feature 100, one under 200, interleaved on arrival.
    const out = orderSectionNodes(
      nodes([wi(1, { parentId: 100 }), wi(2, { parentId: 200 }), wi(3, { parentId: 100 }), wi(4, { parentId: 200 })]),
      { ...DEFAULT_SECTION_ORDERING, groupByParent: true },
    );
    expect(out.map((n) => n.item.id)).toEqual([1, 3, 2, 4]);
  });

  it('leaves parentless items where the sort put them', () => {
    const out = orderSectionNodes(
      nodes([wi(1, { parentId: 100 }), wi(2), wi(3, { parentId: 100 })]),
      { ...DEFAULT_SECTION_ORDERING, groupByParent: true },
    );
    expect(out.map((n) => n.item.id)).toEqual([1, 3, 2]);
  });

  it('flattens when nesting is off', () => {
    const out = orderSectionNodes(
      nodes([wi(1), wi(2, { parentId: 1 })]),
      { ...DEFAULT_SECTION_ORDERING, nestUnderParent: false },
    );
    expect(out.map((n) => n.item.id)).toEqual([1, 2]);
    expect(out.every((n) => n.children.length === 0)).toBe(true);
  });
});
