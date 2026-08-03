import { describe, it, expect } from 'vitest';
import { HarvestClient } from './harvest-client';
import { FakeTransport } from '@test/fake-transport';

const config = { accountId: '123', token: 'tok', userAgent: 'Hourglass' };

describe('HarvestClient', () => {
  it('sends auth headers and maps project assignments', async () => {
    const http = new FakeTransport().on('GET', '/users/me/project_assignments', {
      project_assignments: [
        {
          project: { id: 1, name: 'LetsDrive', code: 'LD' },
          client: { name: 'Acme' },
          task_assignments: [{ task: { id: 10, name: 'Development' } }, { task: { id: 11, name: 'Meetings' } }],
        },
      ],
    });
    const client = new HarvestClient(http, config);
    const projects = await client.getProjectAssignments();

    expect(projects).toHaveLength(1);
    expect(projects[0]).toMatchObject({ id: 1, name: 'LetsDrive', code: 'LD', clientName: 'Acme' });
    expect(projects[0]!.tasks).toEqual([
      { id: 10, name: 'Development' },
      { id: 11, name: 'Meetings' },
    ]);
    const req = http.lastRequest();
    expect(req.headers?.['Authorization']).toBe('Bearer tok');
    expect(req.headers?.['Harvest-Account-Id']).toBe('123');
  });

  it('maps time entries incl. external reference and is_running', async () => {
    const http = new FakeTransport().on('GET', '/time_entries?from=', {
      time_entries: [
        {
          id: 55,
          spent_date: '2026-08-03',
          hours: 1.5,
          notes: 'work',
          project: { id: 1, name: 'LetsDrive' },
          task: { id: 10, name: 'Development' },
          is_running: true,
          external_reference: {
            id: 'AzureDevOps_guid_UserStory_4821',
            group_id: 'AzureDevOpsWorkItem',
            permalink: 'https://dev.azure.com/x/_workitems/edit/4821',
            service: 'dev.azure.com',
          },
        },
      ],
    });
    const entries = await new HarvestClient(http, config).getTimeEntries('2026-08-01', '2026-08-07');
    expect(entries[0]).toMatchObject({ id: 55, hours: 1.5, isRunning: true, projectName: 'LetsDrive' });
    expect(entries[0]!.externalReference?.groupId).toBe('AzureDevOpsWorkItem');
  });

  it('creates a fixed-duration entry with snake_case body + external reference', async () => {
    const http = new FakeTransport().on('POST', '/time_entries', {
      id: 99,
      spent_date: '2026-08-03',
      hours: 2,
      notes: 'done',
      project: { id: 1, name: 'LetsDrive' },
      task: { id: 10, name: 'Development' },
      is_running: false,
      external_reference: null,
    });
    const client = new HarvestClient(http, config);
    const created = await client.createTimeEntry({
      projectId: 1,
      taskId: 10,
      spentDate: '2026-08-03',
      hours: 2,
      notes: 'done',
      externalReference: {
        id: 'AzureDevOps_guid_Bug_7',
        groupId: 'AzureDevOpsWorkItem',
        permalink: 'https://dev.azure.com/x/_workitems/edit/7',
        service: 'dev.azure.com',
      },
    });
    expect(created.id).toBe(99);
    const body = JSON.parse(http.lastRequest().body!);
    expect(body).toMatchObject({ project_id: 1, task_id: 10, spent_date: '2026-08-03', hours: 2 });
    expect(body.external_reference).toMatchObject({ id: 'AzureDevOps_guid_Bug_7', group_id: 'AzureDevOpsWorkItem' });
  });

  it('omits hours to start a running timer', async () => {
    const http = new FakeTransport().on('POST', '/time_entries', {
      id: 1, spent_date: '2026-08-03', hours: 0, notes: '', project: { id: 1, name: 'P' }, task: { id: 2, name: 'T' }, is_running: true, external_reference: null,
    });
    await new HarvestClient(http, config).createTimeEntry({ projectId: 1, taskId: 2, spentDate: '2026-08-03' });
    const body = JSON.parse(http.lastRequest().body!);
    expect('hours' in body).toBe(false);
  });

  it('throws on non-2xx', async () => {
    const http = new FakeTransport().on('DELETE', '/time_entries/5', '{"error":"nope"}', 422);
    await expect(new HarvestClient(http, config).deleteTimeEntry(5)).rejects.toThrow(/422/);
  });
});
