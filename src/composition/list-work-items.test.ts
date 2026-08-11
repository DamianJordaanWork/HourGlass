import { describe, it, expect, vi } from 'vitest';
import { fanOutWorkItems } from './list-work-items';
import type { IAzureDevOpsClient } from '@domain/ports';
import type { AdoConnection } from '@domain/connections/connection';
import type { WorkItem } from '@domain/work-items/work-item';

const demoWorkItems: WorkItem[] = [
  { id: 1, title: 'Demo item', workItemType: 'Task', state: 'Active', project: 'Demo', iterationPath: '', areaPath: '', tags: [], connectionId: 'demo', url: '' },
];

function connection(id: string, iterationPath?: string): AdoConnection {
  return { id, label: id, orgUrl: 'https://dev.azure.com/x', iterationPath, enabled: true };
}

function workItem(id: number, connectionId: string): WorkItem {
  return { id, title: `WI ${id}`, workItemType: 'Task', state: 'Active', project: 'P', iterationPath: '', areaPath: '', tags: [], connectionId, url: '' };
}

describe('fanOutWorkItems', () => {
  it('demo mode returns demoWorkItems, ignoring wiql', async () => {
    const listEnabledAdoConnections = vi.fn();
    const items = await fanOutWorkItems({
      ado: undefined,
      listEnabledAdoConnections,
      demoWorkItems,
      wiql: "SELECT [System.Id] FROM WorkItems WHERE [System.State] = 'Active'",
    });
    expect(items).toEqual(demoWorkItems);
    expect(listEnabledAdoConnections).not.toHaveBeenCalled();
  });

  it('without wiql, calls listAssignedWorkItems per connection with its iterationPath (unchanged)', async () => {
    const listAssignedWorkItems = vi.fn(async (id: string) => [workItem(1, id)]);
    const ado: IAzureDevOpsClient = {
      listAssignedWorkItems,
      queryWorkItems: vi.fn(),
      getWorkItem: vi.fn(),
      syncCompletedWork: vi.fn(),
    };
    const conns = [connection('c1', 'Proj\\Sprint 1')];
    const items = await fanOutWorkItems({
      ado,
      listEnabledAdoConnections: async () => conns,
      demoWorkItems,
    });
    expect(listAssignedWorkItems).toHaveBeenCalledWith('c1', { iterationPath: 'Proj\\Sprint 1' });
    expect(items).toEqual([workItem(1, 'c1')]);
  });

  it('with wiql, calls queryWorkItems per enabled connection and flat-maps two connections', async () => {
    const queryWorkItems = vi.fn(async (id: string) => [workItem(id === 'c1' ? 1 : 2, id)]);
    const ado: IAzureDevOpsClient = {
      listAssignedWorkItems: vi.fn(),
      queryWorkItems,
      getWorkItem: vi.fn(),
      syncCompletedWork: vi.fn(),
    };
    const conns = [connection('c1'), connection('c2')];
    const wiql = "SELECT [System.Id] FROM WorkItems WHERE [System.State] = 'Active'";
    const items = await fanOutWorkItems({
      ado,
      listEnabledAdoConnections: async () => conns,
      demoWorkItems,
      wiql,
    });
    expect(queryWorkItems).toHaveBeenCalledWith('c1', wiql);
    expect(queryWorkItems).toHaveBeenCalledWith('c2', wiql);
    expect(items).toEqual([workItem(1, 'c1'), workItem(2, 'c2')]);
  });

  it('swallows a throwing connection and still returns the other', async () => {
    const queryWorkItems = vi.fn(async (id: string) => {
      if (id === 'bad') throw new Error('boom');
      return [workItem(9, id)];
    });
    const ado: IAzureDevOpsClient = {
      listAssignedWorkItems: vi.fn(),
      queryWorkItems,
      getWorkItem: vi.fn(),
      syncCompletedWork: vi.fn(),
    };
    const conns = [connection('bad'), connection('good')];
    const warn = vi.fn();
    const items = await fanOutWorkItems({
      ado,
      listEnabledAdoConnections: async () => conns,
      demoWorkItems,
      wiql: 'SELECT [System.Id] FROM WorkItems',
      warn,
    });
    expect(items).toEqual([workItem(9, 'good')]);
    expect(warn).toHaveBeenCalledWith('[ado] listWorkItems failed', 'bad', expect.any(Error));
  });
});
