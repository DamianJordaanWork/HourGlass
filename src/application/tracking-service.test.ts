import { describe, it, expect, beforeEach } from 'vitest';
import { TrackingService } from './tracking-service';
import { createLocalRepositories } from '@infrastructure/persistence/local-repositories';
import { MemoryStorage } from '@infrastructure/persistence/local-store';
import type { IClock } from '@domain/common/clock';
import type { IHarvestClient } from '@domain/ports';
import type { CreateTimeEntry, HarvestTimeEntry, UpdateTimeEntry } from '@domain/harvest/harvest-types';
import { durationHours } from '@domain/time/time-interval';

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
    const { service, repos, ado } = makeService(clock, harvest);
    const current = await repos.settings.get();
    await repos.settings.save({ ...current, embedMetadata: true }); // opt in for this test
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

  it('continueInterval reopens the SAME entry, resuming from the accrued total', async () => {
    const harvest = new FakeHarvest();
    const { service } = makeService(clock, harvest);
    const i = await service.startTracking({ date: '2026-08-03', source: 'WorkItem', harvestProjectId: 7, harvestTaskId: 8, notes: 'PRs' });
    clock.advance(600_000); // 10m
    const stopped = await service.stopTracking(i.id);
    expect(stopped.harvestTimeEntryId).toBeDefined();
    const createdCount = harvest.created.length;

    clock.advance(300_000); // 5m paused
    const resumed = await service.continueInterval(i.id);
    expect(resumed.id).toBe(i.id); // SAME interval, not a clone
    expect(resumed.end).toBeUndefined();
    // Clock resumes from the 10m already logged (not the 15m wall-clock gap).
    expect(durationHours(resumed, clock.nowIso())).toBeCloseTo(10 / 60, 5);
    expect((await service.getRunning())?.id).toBe(i.id);

    clock.advance(300_000); // +5m
    const stoppedAgain = await service.stopTracking(i.id);
    expect(durationHours(stoppedAgain, clock.nowIso())).toBeCloseTo(15 / 60, 5);
    // No new Harvest entry — the existing one is updated to the new total.
    expect(harvest.created.length).toBe(createdCount);
    expect(harvest.updated.some((u) => u.id === stopped.harvestTimeEntryId)).toBe(true);
  });

  it('importHarvestEntry adopts a Harvest entry once (idempotent) with exact hours', async () => {
    const { service } = makeService(clock);
    const entry = { id: 555, spentDate: '2026-08-03', hours: 0.5, notes: 'CRT Scrum\n\n\n```hg1\nx\n```', projectId: 9, projectName: 'P', taskId: 3, taskName: 'Meetings', isRunning: false };
    const first = await service.importHarvestEntry(entry);
    expect(first.harvestTimeEntryId).toBe(555);
    expect(first.syncedHours).toBe(0.5);
    expect(first.notes).toBe('CRT Scrum'); // hg1 stripped
    expect(durationHours(first, first.end!)).toBeCloseTo(0.5, 5);
    const again = await service.importHarvestEntry(entry);
    expect(again.id).toBe(first.id); // no duplicate
    expect(await service.listDay('2026-08-03')).toHaveLength(1);
  });

  it('linkToHarvestEntry attaches an existing Harvest id without double-counting on next push', async () => {
    const harvest = new FakeHarvest();
    const { service } = makeService(clock, harvest);
    const i = await service.logManualTime({ date: '2026-08-03', source: 'Manual', harvestProjectId: 1, harvestTaskId: 2, hours: 1 });
    const linked = await service.linkToHarvestEntry(i.id, 999, 1);
    expect(linked.harvestTimeEntryId).toBe(999);
    expect(linked.syncedHours).toBe(1);
    // Editing now UPDATES entry 999 (not create) and no phantom Harvest create.
    const before = harvest.created.length;
    await service.updateInterval(i.id, { notes: 'linked+edited' });
    expect(harvest.created.length).toBe(before);
    expect(harvest.updated.some((u) => u.id === 999)).toBe(true);
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
