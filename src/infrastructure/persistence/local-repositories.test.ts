import { describe, it, expect } from 'vitest';
import { createLocalRepositories } from './local-repositories';
import { MemoryStorage } from './local-store';
import type { TimeInterval } from '@domain/time/time-interval';

function interval(id: string, date: string, end?: string): TimeInterval {
  return {
    id,
    date,
    notes: '',
    start: `${date}T09:00:00Z`,
    end,
    isManual: false,
    source: 'Manual',
    createdAt: `${date}T09:00:00Z`,
    updatedAt: `${date}T09:00:00Z`,
  };
}

describe('local repositories', () => {
  it('persists intervals and queries by date / range / running', async () => {
    const storage = new MemoryStorage();
    const repos = createLocalRepositories(storage);
    await repos.intervals.upsert(interval('a', '2026-08-03', '2026-08-03T10:00:00Z'));
    await repos.intervals.upsert(interval('b', '2026-08-04')); // running
    await repos.intervals.upsert(interval('c', '2026-08-10', '2026-08-10T10:00:00Z'));

    expect((await repos.intervals.listByDate('2026-08-03')).map((i) => i.id)).toEqual(['a']);
    expect((await repos.intervals.listByRange('2026-08-03', '2026-08-05')).map((i) => i.id).sort()).toEqual(['a', 'b']);
    expect((await repos.intervals.getRunning())?.id).toBe('b');
  });

  it('survives a reload via storage (new repo instance sees prior data)', async () => {
    const storage = new MemoryStorage();
    await createLocalRepositories(storage).intervals.upsert(interval('x', '2026-08-03'));
    const reloaded = createLocalRepositories(storage);
    expect((await reloaded.intervals.get('x'))?.id).toBe('x');
  });

  it('merges settings over defaults', async () => {
    const storage = new MemoryStorage();
    const repos = createLocalRepositories(storage);
    const base = await repos.settings.get();
    expect(base.weeklyGoalHours).toBe(40);
    await repos.settings.save({ ...base, weeklyGoalHours: 32 });
    expect((await createLocalRepositories(storage).settings.get()).weeklyGoalHours).toBe(32);
  });

  it('deletes intervals', async () => {
    const storage = new MemoryStorage();
    const repos = createLocalRepositories(storage);
    await repos.intervals.upsert(interval('a', '2026-08-03'));
    await repos.intervals.delete('a');
    expect(await repos.intervals.get('a')).toBeNull();
  });
});
