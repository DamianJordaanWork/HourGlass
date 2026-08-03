import { describe, it, expect, beforeEach } from 'vitest';
import { TrackingService } from './tracking-service';
import { createLocalRepositories } from '@infrastructure/persistence/local-repositories';
import { MemoryStorage } from '@infrastructure/persistence/local-store';
import type { IClock } from '@domain/common/clock';
import type { IHarvestClient } from '@domain/ports';
import type { CreateTimeEntry, HarvestTimeEntry, UpdateTimeEntry } from '@domain/harvest/harvest-types';

class FakeClock implements IClock {
  constructor(private t: number) {}
  advance(ms: number) {
    this.t += ms;
  }
  now() {
    return new Date(this.t);
  }
  nowIso() {
    return new Date(this.t).toISOString();
  }
  today() {
    return this.nowIso().slice(0, 10);
  }
}

class FakeHarvest implements IHarvestClient {
  created: CreateTimeEntry[] = [];
  updated: { id: number; patch: UpdateTimeEntry }[] = [];
  private seq = 1000;
  async getProjectAssignments() {
    return [];
  }
  async getTimeEntries() {
    return [];
  }
  async createTimeEntry(e: CreateTimeEntry): Promise<HarvestTimeEntry> {
    this.created.push(e);
    return {
      id: this.seq++,
      spentDate: e.spentDate,
      hours: e.hours ?? 0,
      notes: e.notes ?? '',
      projectId: e.projectId,
      projectName: 'P',
      taskId: e.taskId,
      taskName: 'T',
      isRunning: e.hours === undefined,
      externalReference: e.externalReference,
    };
  }
  async updateTimeEntry(id: number, patch: UpdateTimeEntry): Promise<HarvestTimeEntry> {
    this.updated.push({ id, patch });
    return { id, spentDate: '', hours: patch.hours ?? 0, notes: patch.notes ?? '', projectId: 0, projectName: '', taskId: 0, taskName: '', isRunning: false };
  }
  async deleteTimeEntry() {}
  async stopTimer(id: number): Promise<HarvestTimeEntry> {
    return { id, spentDate: '', hours: 0, notes: '', projectId: 0, projectName: '', taskId: 0, taskName: '', isRunning: false };
  }
  async restartTimer(id: number): Promise<HarvestTimeEntry> {
    return this.stopTimer(id);
  }
}

function makeService(clock: FakeClock, harvest?: FakeHarvest) {
  const repos = createLocalRepositories(new MemoryStorage());
  let n = 0;
  const ado = { calls: [] as { id: string; wi: number; delta: number }[], async listAssignedWorkItems() { return []; }, async getWorkItem() { throw new Error('n/a'); }, async syncCompletedWork(id: string, wi: number, delta: number) { this.calls.push({ id, wi, delta }); } };
  const service = new TrackingService({
    intervals: repos.intervals,
    settings: repos.settings,
    clock,
    newId: () => `id-${++n}`,
    harvest: harvest ? () => harvest : undefined,
    ado: () => ado,
  });
  return { service, repos, ado };
}

const T0 = Date.parse('2026-08-03T09:00:00Z');

describe('TrackingService', () => {
  let clock: FakeClock;
  beforeEach(() => {
    clock = new FakeClock(T0);
  });

  it('starts a running interval stamped to the selected day', async () => {
    const { service } = makeService(clock);
    const i = await service.startTracking({ date: '2026-08-01', source: 'Manual', harvestProjectId: 1, harvestTaskId: 2 });
    expect(i.end).toBeUndefined();
    expect(i.date).toBe('2026-08-01');
    expect((await service.getRunning())?.id).toBe(i.id);
  });

  it('auto-stops the previous timer when a new one starts', async () => {
    const harvest = new FakeHarvest();
    const { service } = makeService(clock, harvest);
    const first = await service.startTracking({ date: '2026-08-03', source: 'Manual', harvestProjectId: 1, harvestTaskId: 2 });
    clock.advance(3_600_000); // 1h
    await service.startTracking({ date: '2026-08-03', source: 'Manual', harvestProjectId: 1, harvestTaskId: 2 });

    const stopped = await service.listDay('2026-08-03');
    const firstStopped = stopped.find((x) => x.id === first.id)!;
    expect(firstStopped.end).toBeDefined();
    expect(harvest.created[0]!.hours).toBeCloseTo(1, 5);
  });

  it('stop computes hours, embeds hg1, sends external ref, and syncs CompletedWork', async () => {
    const harvest = new FakeHarvest();
    const { service, ado } = makeService(clock, harvest);
    const i = await service.startTracking({
      date: '2026-08-03',
      source: 'WorkItem',
      harvestProjectId: 1,
      harvestTaskId: 2,
      notes: 'investigating',
      workItemRef: { connectionId: 'c1', workItemId: 4821, workItemType: 'User Story', url: 'https://dev.azure.com/x/_workitems/edit/4821' },
    });
    clock.advance(90 * 60_000); // 1.5h
    await service.stopTracking(i.id);

    expect(harvest.created).toHaveLength(1);
    const entry = harvest.created[0]!;
    expect(entry.hours).toBeCloseTo(1.5, 5);
    expect(entry.notes).toContain('investigating');
    expect(entry.notes).toContain('```hg1');
    expect(entry.externalReference?.id).toBe('AzureDevOps_UserStory_4821');
    expect(ado.calls).toEqual([{ id: 'c1', wi: 4821, delta: 1.5 }]);
  });

  it('logManualTime creates a completed entry from an explicit duration', async () => {
    const harvest = new FakeHarvest();
    const { service } = makeService(clock, harvest);
    const i = await service.logManualTime({ date: '2026-08-03', source: 'Meeting', harvestProjectId: 3, harvestTaskId: 4, hours: 0.5, notes: 'standup' });
    expect(i.isManual).toBe(true);
    expect(i.end).toBeDefined();
    expect(harvest.created[0]!.hours).toBe(0.5);
  });

  it('updateInterval re-pushes absolute hours to Harvest and only the delta to ADO', async () => {
    const harvest = new FakeHarvest();
    const { service, ado } = makeService(clock, harvest);
    const i = await service.startTracking({
      date: '2026-08-03',
      source: 'WorkItem',
      harvestProjectId: 1,
      harvestTaskId: 2,
      notes: 'first',
      workItemRef: { connectionId: 'c1', workItemId: 4821, workItemType: 'Task', url: 'u' },
    });
    clock.advance(90 * 60_000); // 1.5h
    const stopped = await service.stopTracking(i.id);
    expect(stopped.syncedHours).toBeCloseTo(1.5, 5);
    expect(ado.calls).toEqual([{ id: 'c1', wi: 4821, delta: 1.5 }]);

    // Edit: extend the entry to 2h total and change the notes.
    const newEnd = new Date(new Date(stopped.start).getTime() + 2 * 3_600_000).toISOString();
    const edited = await service.updateInterval(i.id, { end: newEnd, notes: 'edited' });

    expect(edited.notes).toBe('edited');
    expect(edited.syncedHours).toBeCloseTo(2, 5);
    expect(harvest.updated).toHaveLength(1);
    expect(harvest.updated[0]!.id).toBe(stopped.harvestTimeEntryId);
    expect(harvest.updated[0]!.patch.hours).toBeCloseTo(2, 5);
    // ADO gets only the +0.5h change, not the full 2h.
    expect(ado.calls[1]).toEqual({ id: 'c1', wi: 4821, delta: 0.5 });
  });

  it('restartInterval starts a fresh running timer cloned from a stopped one', async () => {
    const harvest = new FakeHarvest();
    const { service } = makeService(clock, harvest);
    const i = await service.startTracking({ date: '2026-08-03', source: 'QuickTemplate', harvestProjectId: 7, harvestTaskId: 8, notes: 'PRs', templateId: 'qt-1' });
    clock.advance(600_000);
    await service.stopTracking(i.id);

    const resumed = await service.restartInterval(i.id, '2026-08-04');
    expect(resumed.id).not.toBe(i.id);
    expect(resumed.end).toBeUndefined();
    expect(resumed.date).toBe('2026-08-04');
    expect(resumed.harvestProjectId).toBe(7);
    expect(resumed.taskName).toBeUndefined();
    expect(resumed.notes).toBe('PRs');
    expect(resumed.templateId).toBe('qt-1');
    expect((await service.getRunning())?.id).toBe(resumed.id);
  });

  it('keeps data locally when Harvest is absent', async () => {
    const { service } = makeService(clock); // no harvest client
    const i = await service.startTracking({ date: '2026-08-03', source: 'Manual', harvestProjectId: 1, harvestTaskId: 2 });
    clock.advance(600_000);
    const stopped = await service.stopTracking(i.id);
    expect(stopped.end).toBeDefined();
    expect(stopped.harvestTimeEntryId).toBeUndefined();
  });
});
