import { describe, it, expect } from 'vitest';
import { useWorkItemFilter } from './work-item-filter';

describe('useWorkItemFilter', () => {
  it('setFilter sets both filterId and wiql', () => {
    useWorkItemFilter.getState().setFilter({ id: 'tpl-1', wiql: "SELECT [System.Id] FROM WorkItems WHERE [System.State] = 'Active'" });
    expect(useWorkItemFilter.getState().filterId).toBe('tpl-1');
    expect(useWorkItemFilter.getState().wiql).toBe("SELECT [System.Id] FROM WorkItems WHERE [System.State] = 'Active'");
  });

  it('setFilter(null) resets filterId and wiql to null', () => {
    useWorkItemFilter.getState().setFilter({ id: 'tpl-1', wiql: 'SELECT [System.Id] FROM WorkItems' });
    useWorkItemFilter.getState().setFilter(null);
    expect(useWorkItemFilter.getState().filterId).toBeNull();
    expect(useWorkItemFilter.getState().wiql).toBeNull();
  });
});
