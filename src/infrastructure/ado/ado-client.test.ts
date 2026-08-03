import { describe, it, expect } from 'vitest';
import { AzureDevOpsClient, type AdoConnectionConfig } from './ado-client';
import { FakeTransport } from '@test/fake-transport';

const conn: AdoConnectionConfig = { orgUrl: 'https://dev.azure.com/agile-bridge', pat: 'PAT123' };
const resolver = async () => conn;

describe('AzureDevOpsClient', () => {
  it('runs WIQL then batch-fetches and maps work items', async () => {
    const http = new FakeTransport()
      .on('POST', '/_apis/wit/wiql', { workItems: [{ id: 4821 }] })
      .on('GET', '/_apis/wit/workitems?ids=', {
        value: [
          {
            id: 4821,
            fields: {
              'System.Title': 'Fix login',
              'System.WorkItemType': 'User Story',
              'System.State': 'Active',
              'System.TeamProject': 'LetsDrive',
              'System.IterationPath': 'LetsDrive\\Sprint 12',
              'System.AreaPath': 'LetsDrive\\Web',
              'System.AssignedTo': { displayName: 'Damian Jordaan' },
              'System.Tags': 'frontend; urgent',
            },
          },
        ],
      });

    const items = await new AzureDevOpsClient(http, resolver).listAssignedWorkItems('c1');
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: 4821,
      title: 'Fix login',
      workItemType: 'User Story',
      project: 'LetsDrive',
      assignedTo: 'Damian Jordaan',
    });
    expect(items[0]!.tags).toEqual(['frontend', 'urgent']);
    expect(items[0]!.url).toContain('/_workitems/edit/4821');

    // Basic auth from PAT
    expect(http.requestMatching('wiql').headers?.['Authorization']).toBe(`Basic ${btoa(':PAT123')}`);
    // assigned-to-me + open-state filter present in the query
    const wiqlBody = JSON.parse(http.requestMatching('wiql').body!);
    expect(wiqlBody.query).toContain('@Me');
    expect(wiqlBody.query).toContain("<> 'Closed'");
  });

  it('returns [] when WIQL yields no ids (no batch call)', async () => {
    const http = new FakeTransport().on('POST', '/_apis/wit/wiql', { workItems: [] });
    const items = await new AzureDevOpsClient(http, resolver).listAssignedWorkItems('c1');
    expect(items).toEqual([]);
    expect(http.requests.every((r) => !r.url.includes('ids='))).toBe(true);
  });

  it('delta-syncs CompletedWork (read then json-patch add)', async () => {
    const http = new FakeTransport()
      .on('GET', 'fields=Microsoft.VSTS.Scheduling.CompletedWork', {
        id: 4821,
        fields: { 'Microsoft.VSTS.Scheduling.CompletedWork': 3 },
      })
      .on('PATCH', '/_apis/wit/workitems/4821', { id: 4821, fields: {} });

    await new AzureDevOpsClient(http, resolver).syncCompletedWork('c1', 4821, 1.5);
    const req = http.lastRequest();
    expect(req.method).toBe('PATCH');
    expect(req.headers?.['Content-Type']).toBe('application/json-patch+json');
    const ops = JSON.parse(req.body!);
    expect(ops[0]).toMatchObject({ op: 'add', path: '/fields/Microsoft.VSTS.Scheduling.CompletedWork', value: 4.5 });
  });

  it('does nothing when delta is zero', async () => {
    const http = new FakeTransport();
    await new AzureDevOpsClient(http, resolver).syncCompletedWork('c1', 4821, 0);
    expect(http.requests).toHaveLength(0);
  });
});
