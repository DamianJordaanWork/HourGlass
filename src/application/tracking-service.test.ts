import { describe, it, expect, beforeEach } from 'vitest';
import { TrackingService } from './tracking-service';
import { createLocalRepositories } from '@infrastructure/persistence/local-repositories';
import { MemoryStorage } from '@infrastructure/persistence/local-store';
import type { IClock } from '@domain/common/clock';
import type { IHarvestClient } from '@domain/ports';
import type { CreateTimeEntry, HarvestTimeEntry, UpdateTimeEntry } from '@domain/harvest/harvest-types';
import { durationHours } from '@domain/time/time-interval';
import { UnmappedEntryError } from '@domain/errors';

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
  deleted: number[] = [];
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
  async deleteTimeEntry(id: number) {
    this.deleted.push(id);
  }
  async stopTimer(id: number): Promise<HarvestTimeEntry> {
    return { id, spentDate: '', hours: 0, notes: '', projectId: 0, projectName: '', taskId: 0, taskName: '', isRunning: false };
  }
  async restartTimer(id: number): Promise<HarvestTimeEntry> {
    return this.stopTimer(id);
  }
}

function makeService(clock: FakeClock, harvest?: FakeHarvest, adoGuid?: (connectionId: string) => Promise<string | undefined>) {
  const repos = createLocalRepositories(new MemoryStorage());
  let n = 0;
  const ado = { calls: [] as { id: string; wi: number; delta: number }[], async listAssignedWorkItems() { return []; }, async queryWorkItems() { return []; }, async getWorkItem() { throw new Error('n/a'); }, async syncCompletedWork(id: string, wi: number, delta: number) { this.calls.push({ id, wi, delta }); } };
  const service = new TrackingService({
    intervals: repos.intervals,
    settings: repos.settings,
    clock,
    newId: () => `id-${++n}`,
    harvest: harvest ? () => harvest : undefined,
    ado: () => ado,
    adoGuid,
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

  it('with a learned adoGuid provider, splices the connection GUID into the external-reference id (ADR-021)', async () => {
    const harvest = new FakeHarvest();
    const GUID = '11111111-2222-3333-4444-555555555555';
    const { service } = makeService(clock, harvest, async (connectionId) => (connectionId === 'c1' ? GUID : undefined));
    const i = await service.startTracking({
      date: '2026-08-03',
      source: 'WorkItem',
      harvestProjectId: 1,
      harvestTaskId: 2,
      workItemRef: { connectionId: 'c1', workItemId: 4821, workItemType: 'User Story', url: 'https://dev.azure.com/x/_workitems/edit/4821' },
    });
    clock.advance(3_600_000); // 1h
    await service.stopTracking(i.id);

    expect(harvest.created).toHaveLength(1);
    expect(harvest.created[0]!.externalReference?.id).toBe(`AzureDevOps_${GUID}_UserStory_4821`);
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
    const { interval: linked } = await service.linkToHarvestEntry(i.id, 999, 1);
    expect(linked.harvestTimeEntryId).toBe(999);
    expect(linked.syncedHours).toBe(1);
    // Editing now UPDATES entry 999 (not create) and no phantom Harvest create.
    const before = harvest.created.length;
    await service.updateInterval(i.id, { notes: 'linked+edited' });
    expect(harvest.created.length).toBe(before);
    expect(harvest.updated.some((u) => u.id === 999)).toBe(true);
  });

  describe('linkToHarvestEntry reconciliation (ADR-022)', () => {
    it('adopts Harvest hours as syncedHours (Harvest wins), makes no Harvest/ADO calls, and surfaces the divergence', async () => {
      const harvest = new FakeHarvest();
      const { service, ado } = makeService(clock, harvest);
      // Local computed duration: 2.0h (09:00 -> 11:00).
      const i = await service.logManualTime({
        date: '2026-08-03',
        source: 'Manual',
        harvestProjectId: 1,
        harvestTaskId: 2,
        start: '2026-08-03T09:00:00.000Z',
        end: '2026-08-03T11:00:00.000Z',
      });
      const createdBefore = harvest.created.length;
      const updatedBefore = harvest.updated.length;

      const result = await service.linkToHarvestEntry(i.id, 999, 1.5);

      expect(result.interval.harvestTimeEntryId).toBe(999);
      expect(result.interval.syncedHours).toBe(1.5); // Harvest wins, not the local 2.0h.
      expect(result.interval.start).toBe(i.start); // local timing untouched
      expect(result.interval.end).toBe(i.end);
      expect(result.reconciled).toEqual({ localHours: 2, harvestHours: 1.5, adopted: 1.5, diverged: true });
      // Linking itself never pushes to Harvest (it already has the entry) or ADO (no new logged time).
      expect(harvest.created.length).toBe(createdBefore);
      expect(harvest.updated.length).toBe(updatedBefore);
      expect(ado.calls).toEqual([]);
    });

    it('reconciles with no divergence flag when hours already match within epsilon', async () => {
      const { service } = makeService(clock);
      const i = await service.logManualTime({
        date: '2026-08-03',
        source: 'Manual',
        harvestProjectId: 1,
        harvestTaskId: 2,
        start: '2026-08-03T09:00:00.000Z',
        end: '2026-08-03T10:30:00.000Z',
      });
      const result = await service.linkToHarvestEntry(i.id, 999, 1.5);
      expect(result.reconciled).toEqual({ localHours: 1.5, harvestHours: 1.5, adopted: 1.5, diverged: false });
    });

    it('does not double-count on a later edit — the ADO delta is computed against the adopted syncedHours, not the local pre-link hours', async () => {
      const harvest = new FakeHarvest();
      const { service, ado } = makeService(clock, harvest);
      const i = await service.startTracking({
        date: '2026-08-03',
        source: 'WorkItem',
        harvestProjectId: 1,
        harvestTaskId: 2,
        workItemRef: { connectionId: 'c1', workItemId: 4821, workItemType: 'Task', url: 'u' },
      });
      clock.advance(2 * 3_600_000); // 2h computed locally
      const stopped = await service.stopTracking(i.id);
      // Simulate linking to an existing Harvest entry whose real hours are 1.5 (Harvest wins).
      const { interval: linked } = await service.linkToHarvestEntry(stopped.id, 999, 1.5);
      expect(linked.syncedHours).toBe(1.5);
      const adoCallsAfterLink = ado.calls.length;

      // Extend the entry to a new total of 3h.
      const newEnd = new Date(new Date(linked.start).getTime() + 3 * 3_600_000).toISOString();
      const edited = await service.updateInterval(i.id, { end: newEnd });

      expect(edited.syncedHours).toBeCloseTo(3, 5);
      // Delta = newHours(3) - adopted syncedHours(1.5) = 1.5, NOT 3 - 2 = 1 (which would double-count
      // the 2h originally computed locally before the link adopted Harvest's 1.5h as truth).
      expect(ado.calls[adoCallsAfterLink]).toEqual({ id: 'c1', wi: 4821, delta: 1.5 });
    });
  });

  it('refuses to start, log, or save an entry without a Harvest project+task (source of truth)', async () => {
    const { service, repos } = makeService(clock);
    await expect(service.startTracking({ date: '2026-08-03', source: 'Manual' })).rejects.toThrow(UnmappedEntryError);
    await expect(service.startTracking({ date: '2026-08-03', source: 'Manual', harvestProjectId: 1 })).rejects.toThrow(UnmappedEntryError); // partial
    await expect(service.logManualTime({ date: '2026-08-03', source: 'Manual', hours: 1 })).rejects.toThrow(UnmappedEntryError);

    // A legacy entry that predates the guard (e.g. seeded directly) can't be
    // saved again without adding a mapping — editing notes alone isn't enough.
    const legacy = { id: 'legacy-1', date: '2026-08-03', notes: 'old unmapped entry', start: clock.nowIso(), end: clock.nowIso(), isManual: true, source: 'Manual' as const, createdAt: clock.nowIso(), updatedAt: clock.nowIso() };
    await repos.intervals.upsert(legacy);
    await expect(service.updateInterval('legacy-1', { notes: 'still unmapped' })).rejects.toThrow(UnmappedEntryError);
    // Adding the mapping in the same edit succeeds.
    const fixed = await service.updateInterval('legacy-1', { harvestProjectId: 9, harvestTaskId: 3 });
    expect(fixed.harvestProjectId).toBe(9);
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

describe('aggregateSameTaskPerDay roll-up', () => {
  let clock: FakeClock;
  beforeEach(() => {
    clock = new FakeClock(T0);
  });

  async function enableAggregation(repos: ReturnType<typeof makeService>['repos']) {
    const current = await repos.settings.get();
    await repos.settings.save({ ...current, aggregateSameTaskPerDay: true });
  }

  const refA = { connectionId: 'c1', workItemId: 100, workItemType: 'Task', url: 'u1' };
  const refB = { connectionId: 'c1', workItemId: 200, workItemType: 'Task', url: 'u2' };

  it('ON: second same-task/day stop patches the first Harvest entry to the cumulative sum', async () => {
    const harvest = new FakeHarvest();
    const { service, repos, ado } = makeService(clock, harvest);
    await enableAggregation(repos);

    const a = await service.startTracking({ date: '2026-08-03', source: 'WorkItem', harvestProjectId: 1, harvestTaskId: 2, workItemRef: refA });
    clock.advance(3_600_000); // 1h
    const stoppedA = await service.stopTracking(a.id);
    expect(harvest.created).toHaveLength(1);
    expect(harvest.created[0]!.hours).toBeCloseTo(1, 5);
    expect(harvest.updated).toHaveLength(0);

    const b = await service.startTracking({ date: '2026-08-03', source: 'WorkItem', harvestProjectId: 1, harvestTaskId: 2, workItemRef: refB });
    clock.advance(1_800_000); // 0.5h
    const stoppedB = await service.stopTracking(b.id);

    expect(harvest.created).toHaveLength(1); // no new Harvest entry
    expect(harvest.updated).toHaveLength(1);
    expect(harvest.updated[0]!.id).toBe(stoppedA.harvestTimeEntryId);
    expect(harvest.updated[0]!.patch.hours).toBeCloseTo(1.5, 5);
    expect(stoppedB.harvestTimeEntryId).toBe(stoppedA.harvestTimeEntryId);
    // each interval's own hours went to ADO, not the running total
    expect(ado.calls).toEqual([
      { id: 'c1', wi: 100, delta: 1 },
      { id: 'c1', wi: 200, delta: 0.5 },
    ]);

    // A third stop keeps patching the same entry to the new cumulative sum.
    const c = await service.startTracking({ date: '2026-08-03', source: 'WorkItem', harvestProjectId: 1, harvestTaskId: 2 });
    clock.advance(900_000); // 0.25h
    await service.stopTracking(c.id);
    expect(harvest.created).toHaveLength(1);
    expect(harvest.updated).toHaveLength(2);
    expect(harvest.updated[1]!.id).toBe(stoppedA.harvestTimeEntryId);
    expect(harvest.updated[1]!.patch.hours).toBeCloseTo(1.75, 5);
  });

  it('OFF (default): two same-task/day stops create two separate Harvest entries, never cross-updating', async () => {
    const harvest = new FakeHarvest();
    const { service } = makeService(clock, harvest); // aggregateSameTaskPerDay defaults to false

    const a = await service.startTracking({ date: '2026-08-03', source: 'Manual', harvestProjectId: 1, harvestTaskId: 2 });
    clock.advance(3_600_000);
    await service.stopTracking(a.id);

    const b = await service.startTracking({ date: '2026-08-03', source: 'Manual', harvestProjectId: 1, harvestTaskId: 2 });
    clock.advance(1_800_000);
    await service.stopTracking(b.id);

    expect(harvest.created).toHaveLength(2);
    expect(harvest.updated).toHaveLength(0); // explicit: OFF never patches a sibling's entry
  });

  it('ON: continueInterval on a member then stopping patches the sum, no new create', async () => {
    const harvest = new FakeHarvest();
    const { service, repos } = makeService(clock, harvest);
    await enableAggregation(repos);

    const a = await service.startTracking({ date: '2026-08-03', source: 'Manual', harvestProjectId: 1, harvestTaskId: 2 });
    clock.advance(3_600_000); // 1h
    const stoppedA = await service.stopTracking(a.id);

    const b = await service.startTracking({ date: '2026-08-03', source: 'Manual', harvestProjectId: 1, harvestTaskId: 2 });
    clock.advance(1_800_000); // 0.5h
    await service.stopTracking(b.id);
    expect(harvest.created).toHaveLength(1);

    clock.advance(60_000);
    await service.continueInterval(a.id);
    clock.advance(600_000); // +10m on A
    await service.stopTracking(a.id);

    expect(harvest.created).toHaveLength(1); // still no new create
    const last = harvest.updated[harvest.updated.length - 1]!;
    expect(last.id).toBe(stoppedA.harvestTimeEntryId);
    // A's new total (1h + 10m, rounded to 1.17) + B's 0.5h
    expect(last.patch.hours).toBeCloseTo(1.67, 5);
  });

  it('ON: updateInterval on a member patches the recomputed sum and syncs only that member\'s ADO delta', async () => {
    const harvest = new FakeHarvest();
    const { service, repos, ado } = makeService(clock, harvest);
    await enableAggregation(repos);

    const a = await service.startTracking({ date: '2026-08-03', source: 'WorkItem', harvestProjectId: 1, harvestTaskId: 2, workItemRef: refA });
    clock.advance(3_600_000); // 1h
    const stoppedA = await service.stopTracking(a.id);

    const b = await service.startTracking({ date: '2026-08-03', source: 'WorkItem', harvestProjectId: 1, harvestTaskId: 2, workItemRef: refB });
    clock.advance(1_800_000); // 0.5h
    const stoppedB = await service.stopTracking(b.id);

    const adoCallsBefore = ado.calls.length;
    const newEnd = new Date(new Date(stoppedB.start).getTime() + 1 * 3_600_000).toISOString(); // extend B to 1h
    const edited = await service.updateInterval(stoppedB.id, { end: newEnd });

    expect(edited.harvestTimeEntryId).toBe(stoppedA.harvestTimeEntryId);
    expect(edited.syncedHours).toBeCloseTo(1, 5); // B's own hours only
    const last = harvest.updated[harvest.updated.length - 1]!;
    expect(last.id).toBe(stoppedA.harvestTimeEntryId);
    expect(last.patch.hours).toBeCloseTo(1 + 1, 5); // A's 1h + B's new 1h
    // ADO only gets B's own delta (+0.5h, from 0.5 -> 1), not the whole sum.
    expect(ado.calls.length).toBe(adoCallsBefore + 1);
    expect(ado.calls[ado.calls.length - 1]).toEqual({ id: 'c1', wi: 200, delta: 0.5 });
  });

  it('ON: deleting one member of a 2-member group patches the entry down to the survivor; deleting the survivor deletes it', async () => {
    const harvest = new FakeHarvest();
    const { service, repos, ado } = makeService(clock, harvest);
    await enableAggregation(repos);

    const a = await service.startTracking({ date: '2026-08-03', source: 'WorkItem', harvestProjectId: 1, harvestTaskId: 2, workItemRef: refA });
    clock.advance(3_600_000); // 1h
    const stoppedA = await service.stopTracking(a.id);

    const b = await service.startTracking({ date: '2026-08-03', source: 'WorkItem', harvestProjectId: 1, harvestTaskId: 2, workItemRef: refB });
    clock.advance(1_800_000); // 0.5h
    const stoppedB = await service.stopTracking(b.id);

    await service.deleteInterval(stoppedB.id);
    // Entry patched down to the survivor's hours, not deleted.
    const patchDown = harvest.updated[harvest.updated.length - 1]!;
    expect(patchDown.id).toBe(stoppedA.harvestTimeEntryId);
    expect(patchDown.patch.hours).toBeCloseTo(1, 5);
    expect(ado.calls[ado.calls.length - 1]).toEqual({ id: 'c1', wi: 200, delta: -0.5 });

    await service.deleteInterval(stoppedA.id);
    // No survivors left → the Harvest entry is actually deleted.
    expect(harvest.deleted).toEqual([stoppedA.harvestTimeEntryId]);
    expect(ado.calls[ado.calls.length - 1]).toEqual({ id: 'c1', wi: 100, delta: -1 });
    expect(await service.listDay('2026-08-03')).toHaveLength(0);
  });

  it('ON: with no Harvest client configured (demo mode), stays local and never throws', async () => {
    const { service, repos } = makeService(clock); // no harvest client
    await enableAggregation(repos);

    const a = await service.startTracking({ date: '2026-08-03', source: 'Manual', harvestProjectId: 1, harvestTaskId: 2 });
    clock.advance(3_600_000);
    const stoppedA = await service.stopTracking(a.id);
    expect(stoppedA.harvestTimeEntryId).toBeUndefined();

    const b = await service.startTracking({ date: '2026-08-03', source: 'Manual', harvestProjectId: 1, harvestTaskId: 2 });
    clock.advance(1_800_000);
    await expect(service.stopTracking(b.id)).resolves.toBeDefined();
  });
});
