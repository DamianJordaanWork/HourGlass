import { describe, expect, it } from 'vitest';
import type { WorkItem } from '@domain/work-items/work-item';
import { buildWorkItemTree } from '@domain/work-items/work-item-tree';
import { filterWorkItemTree, filterWorkItems, matchesWorkItem } from '@presentation/lib/work-item-search';

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
    url: '',
    ...over,
  };
}

describe('matchesWorkItem', () => {
  it('matches an empty query', () => {
    expect(matchesWorkItem(wi(1), '  ')).toBe(true);
  });

  it('matches on id, with or without the # prefix', () => {
    expect(matchesWorkItem(wi(4821), '4821')).toBe(true);
    expect(matchesWorkItem(wi(4821), '#4821')).toBe(true);
    expect(matchesWorkItem(wi(4821), '#999')).toBe(false);
  });

  it('matches title, type, state, project and tags case-insensitively', () => {
    const item = wi(1, { title: 'Fix Login', workItemType: 'Bug', state: 'New', project: 'LetsDrive', tags: ['Urgent'] });
    for (const q of ['login', 'bug', 'new', 'letsdrive', 'urgent']) {
      expect(matchesWorkItem(item, q)).toBe(true);
    }
    expect(matchesWorkItem(item, 'logout')).toBe(false);
  });
});

describe('filterWorkItemTree', () => {
  const tree = () =>
    buildWorkItemTree([
      wi(1, { workItemType: 'User Story', title: 'Onboarding' }),
      wi(2, { parentId: 1, title: 'Wire API' }),
      wi(3, { parentId: 1, title: 'Error states' }),
      wi(9, { title: 'Unrelated' }),
    ]);

  it('returns everything for an empty query', () => {
    expect(filterWorkItemTree(tree(), '').map((n) => n.item.id)).toEqual([1, 9]);
  });

  it('keeps the ancestor of a matching child', () => {
    const out = filterWorkItemTree(tree(), 'wire');
    expect(out.map((n) => n.item.id)).toEqual([1]);
    expect(out[0]?.children.map((c) => c.item.id)).toEqual([2]);
  });

  it('keeps a matching parent even when no child matches', () => {
    const out = filterWorkItemTree(tree(), 'onboarding');
    expect(out.map((n) => n.item.id)).toEqual([1]);
    expect(out[0]?.children).toHaveLength(0);
  });

  it('drops branches with no match anywhere', () => {
    expect(filterWorkItemTree(tree(), 'nothing here')).toEqual([]);
  });
});

describe('filterWorkItems', () => {
  it('filters a flat list', () => {
    expect(filterWorkItems([wi(1, { title: 'alpha' }), wi(2, { title: 'beta' })], 'alph').map((i) => i.id)).toEqual([1]);
  });
});
