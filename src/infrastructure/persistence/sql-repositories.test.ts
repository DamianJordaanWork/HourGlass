import { describe, expect, it } from 'vitest';
import { createInMemoryWasmDatabase } from '@test/wasm-sql-database';
import { createSqlRepositories } from '@infrastructure/persistence/sql-repositories';
import type { TimeInterval } from '@domain/time/time-interval';
import type { MappingRule } from '@domain/templates/mapping';
import type { CalendarAccount, Meeting } from '@domain/calendar/meeting';
import type { QuickTemplate } from '@domain/templates/quick-template';
import type { Note } from '@domain/notes/note';
import type { AdoConnection } from '@domain/connections/connection';
import { DEFAULT_SETTINGS } from '@domain/settings/settings';

function interval(id: string, date: string, overrides: Partial<TimeInterval> = {}): TimeInterval {
  return {
    id,
    date,
    notes: '',
    start: `${date}T09:00:00Z`,
    isManual: false,
    source: 'Manual',
    createdAt: `${date}T09:00:00Z`,
    updatedAt: `${date}T09:00:00Z`,
    ...overrides,
  };
}

function rule(id: string, priority: number, overrides: Partial<MappingRule> = {}): MappingRule {
  return {
    id,
    name: id,
    ruleType: 'WorkItem',
    priority,
    enabled: true,
    conditions: [],
    target: { harvestProjectId: 1, harvestTaskId: 1 },
    ...overrides,
  };
}

function account(id: string, overrides: Partial<CalendarAccount> = {}): CalendarAccount {
  return { id, provider: 'Ics', displayName: id, enabled: true, ...overrides };
}

function meeting(id: string, accountId: string, date: string, overrides: Partial<Meeting> = {}): Meeting {
  return {
    id,
    calendarAccountId: accountId,
    calendarName: 'Cal',
    externalUid: id,
    title: id,
    start: `${date}T09:00:00Z`,
    end: `${date}T10:00:00Z`,
    date,
    isAllDay: false,
    status: 'Active',
    ...overrides,
  };
}

describe('sql-repositories', () => {
  describe('TimeIntervalRepository', () => {
    it('round-trips fields (null/JSON fidelity) and preserves running semantics', async () => {
      const db = createInMemoryWasmDatabase();
      const repos = createSqlRepositories(db);

      const running = interval('running', '2026-08-11', {
        workItemRef: { connectionId: 'c1', workItemId: 42, workItemType: 'Bug', url: 'https://x' },
        harvestProjectId: 1001,
        harvestTaskId: 10,
        projectName: 'LetsDrive',
        taskName: 'Dev',
        syncedHours: 1.5,
      });
      const finished = interval('finished', '2026-08-11', { end: '2026-08-11T10:00:00Z' });

      await repos.intervals.upsert(running);
      await repos.intervals.upsert(finished);

      const gotRunning = await repos.intervals.get('running');
      expect(gotRunning).toEqual(running);
      expect(gotRunning?.end).toBeUndefined();
      expect(gotRunning?.workItemRef).toEqual({
        connectionId: 'c1',
        workItemId: 42,
        workItemType: 'Bug',
        url: 'https://x',
      });

      const currentlyRunning = await repos.intervals.getRunning();
      expect(currentlyRunning?.id).toBe('running');

      const finishedRow = await repos.intervals.get('finished');
      expect(finishedRow?.workItemRef).toBeUndefined();
      expect(finishedRow?.end).toBe('2026-08-11T10:00:00Z');
    });

    it('listByDate orders by start_time; listByRange spans dates', async () => {
      const db = createInMemoryWasmDatabase();
      const repos = createSqlRepositories(db);

      await repos.intervals.upsert(interval('late', '2026-08-11', { start: '2026-08-11T14:00:00Z' }));
      await repos.intervals.upsert(interval('early', '2026-08-11', { start: '2026-08-11T08:00:00Z' }));
      await repos.intervals.upsert(interval('other-day', '2026-08-12'));

      expect((await repos.intervals.listByDate('2026-08-11')).map((i) => i.id)).toEqual(['early', 'late']);
      expect((await repos.intervals.listByRange('2026-08-11', '2026-08-12')).map((i) => i.id)).toEqual([
        'early',
        'late',
        'other-day',
      ]);
    });

    it('deletes intervals', async () => {
      const db = createInMemoryWasmDatabase();
      const repos = createSqlRepositories(db);
      await repos.intervals.upsert(interval('a', '2026-08-11'));
      await repos.intervals.delete('a');
      expect(await repos.intervals.get('a')).toBeNull();
    });
  });

  describe('MappingRuleRepository', () => {
    it('orders rules by priority and conditions by seq; round-trips via upsert', async () => {
      const db = createInMemoryWasmDatabase();
      const repos = createSqlRepositories(db);

      const r1 = rule('r1', 20);
      const r2 = rule('r2', 10, {
        conditions: [
          { field: 'project', operator: 'equals', value: 'LetsDrive' },
          { field: 'title', operator: 'contains', value: 'bug', negate: true },
        ],
      });

      await repos.mappingRules.upsert(r1);
      await repos.mappingRules.upsert(r2);

      const list = await repos.mappingRules.list();
      expect(list.map((r) => r.id)).toEqual(['r2', 'r1']);
      expect(list[0]?.conditions).toEqual(r2.conditions);
    });

    it('re-upserting a rule replaces its condition set (not append)', async () => {
      const db = createInMemoryWasmDatabase();
      const repos = createSqlRepositories(db);

      await repos.mappingRules.upsert(
        rule('r1', 10, { conditions: [{ field: 'a', operator: 'equals', value: '1' }] }),
      );
      await repos.mappingRules.upsert(
        rule('r1', 10, { conditions: [{ field: 'b', operator: 'equals', value: '2' }] }),
      );

      const [got] = await repos.mappingRules.list();
      expect(got?.conditions).toEqual([{ field: 'b', operator: 'equals', value: '2' }]);
    });

    it('delete cascades to conditions (FK ON DELETE CASCADE)', async () => {
      const db = createInMemoryWasmDatabase();
      const repos = createSqlRepositories(db);
      await repos.mappingRules.upsert(
        rule('r1', 10, { conditions: [{ field: 'a', operator: 'equals', value: '1' }] }),
      );

      await repos.mappingRules.delete('r1');

      const conditionRows = await db.query('SELECT * FROM mapping_condition WHERE rule_id = ?', ['r1']);
      expect(conditionRows).toEqual([]);
      expect(await repos.mappingRules.list()).toEqual([]);
    });
  });

  describe('CalendarAccountRepository + MeetingRepository', () => {
    it('round-trips calendar accounts', async () => {
      const db = createInMemoryWasmDatabase();
      const repos = createSqlRepositories(db);
      const a = account('acc1', { email: 'x@y.com', color: '#fff', icsUrl: 'https://ics' });
      await repos.calendarAccounts.upsert(a);
      expect(await repos.calendarAccounts.list()).toEqual([a]);
    });

    it('delete cascades to meetings (FK ON DELETE CASCADE)', async () => {
      const db = createInMemoryWasmDatabase();
      const repos = createSqlRepositories(db);
      await repos.calendarAccounts.upsert(account('acc1'));
      await repos.meetings.upsertMany([meeting('m1', 'acc1', '2026-08-11')]);

      await repos.calendarAccounts.delete('acc1');

      const rows = await db.query('SELECT * FROM meeting WHERE calendar_account_id = ?', ['acc1']);
      expect(rows).toEqual([]);
    });

    it('upsertMany dedupes on (calendar_account_id, external_uid, date)', async () => {
      const db = createInMemoryWasmDatabase();
      const repos = createSqlRepositories(db);
      await repos.calendarAccounts.upsert(account('acc1'));

      await repos.meetings.upsertMany([meeting('m1', 'acc1', '2026-08-11', { externalUid: 'same-uid', title: 'Original' })]);
      await repos.meetings.upsertMany([meeting('m1-new-id', 'acc1', '2026-08-11', { externalUid: 'same-uid', title: 'Updated' })]);

      const list = await repos.meetings.listByDate('2026-08-11');
      expect(list).toHaveLength(1);
      expect(list[0]?.title).toBe('Updated');
    });

    it('listByDate orders by start_time', async () => {
      const db = createInMemoryWasmDatabase();
      const repos = createSqlRepositories(db);
      await repos.calendarAccounts.upsert(account('acc1'));
      await repos.meetings.upsertMany([
        meeting('late', 'acc1', '2026-08-11', { externalUid: 'late', start: '2026-08-11T14:00:00Z', end: '2026-08-11T15:00:00Z' }),
        meeting('early', 'acc1', '2026-08-11', { externalUid: 'early', start: '2026-08-11T08:00:00Z', end: '2026-08-11T09:00:00Z' }),
      ]);

      expect((await repos.meetings.listByDate('2026-08-11')).map((m) => m.id)).toEqual(['early', 'late']);
    });
  });

  describe('QuickTemplateRepository + NoteRepository', () => {
    it('orders quick templates and notes by sort_order', async () => {
      const db = createInMemoryWasmDatabase();
      const repos = createSqlRepositories(db);

      const templates: QuickTemplate[] = [
        { id: 't2', label: 'B', sortOrder: 2, enabled: true },
        { id: 't1', label: 'A', sortOrder: 1, enabled: true },
      ];
      for (const t of templates) await repos.quickTemplates.upsert(t);
      expect((await repos.quickTemplates.list()).map((t) => t.id)).toEqual(['t1', 't2']);

      const notes: Note[] = [
        { id: 'n2', content: 'B', color: 'none', isWip: false, isDone: false, sortOrder: 2, createdAt: '2026-08-11T00:00:00Z' },
        { id: 'n1', content: 'A', color: 'green', isWip: true, isDone: false, sortOrder: 1, createdAt: '2026-08-11T00:00:00Z' },
      ];
      for (const n of notes) await repos.notes.upsert(n);
      const gotNotes = await repos.notes.list();
      expect(gotNotes.map((n) => n.id)).toEqual(['n1', 'n2']);
      expect(gotNotes[0]).toEqual(notes[1]);
    });

    it('deletes quick templates and notes', async () => {
      const db = createInMemoryWasmDatabase();
      const repos = createSqlRepositories(db);
      await repos.quickTemplates.upsert({ id: 't1', label: 'A', sortOrder: 1, enabled: true });
      await repos.quickTemplates.delete('t1');
      expect(await repos.quickTemplates.list()).toEqual([]);

      await repos.notes.upsert({ id: 'n1', content: 'A', color: 'none', isWip: false, isDone: false, sortOrder: 1, createdAt: '2026-08-11T00:00:00Z' });
      await repos.notes.delete('n1');
      expect(await repos.notes.list()).toEqual([]);
    });
  });

  describe('AdoConnectionRepository', () => {
    it('orders by label and round-trips', async () => {
      const db = createInMemoryWasmDatabase();
      const repos = createSqlRepositories(db);
      const conns: AdoConnection[] = [
        { id: 'b', label: 'Bravo', orgUrl: 'https://x/b', enabled: true },
        { id: 'a', label: 'Alpha', orgUrl: 'https://x/a', iterationPath: 'x\\Sprint 1', enabled: false },
      ];
      for (const c of conns) await repos.adoConnections.upsert(c);

      expect((await repos.adoConnections.list()).map((c) => c.id)).toEqual(['a', 'b']);
      expect(await repos.adoConnections.get('a')).toEqual(conns[1]);
      expect(await repos.adoConnections.get('missing')).toBeNull();
    });

    it('deletes connections', async () => {
      const db = createInMemoryWasmDatabase();
      const repos = createSqlRepositories(db);
      await repos.adoConnections.upsert({ id: 'a', label: 'Alpha', orgUrl: 'https://x', enabled: true });
      await repos.adoConnections.delete('a');
      expect(await repos.adoConnections.get('a')).toBeNull();
    });

    it('round-trips harvestGuid (migration v3 column): set and undefined (NULL <-> undefined)', async () => {
      const db = createInMemoryWasmDatabase();
      const repos = createSqlRepositories(db);
      const withGuid: AdoConnection = {
        id: 'a',
        label: 'Alpha',
        orgUrl: 'https://x',
        enabled: true,
        harvestGuid: '11111111-2222-3333-4444-555555555555',
      };
      await repos.adoConnections.upsert(withGuid);
      expect(await repos.adoConnections.get('a')).toEqual(withGuid);

      const noGuid: AdoConnection = { id: 'b', label: 'Bravo', orgUrl: 'https://y', enabled: true };
      await repos.adoConnections.upsert(noGuid);
      const got = await repos.adoConnections.get('b');
      expect(got?.harvestGuid).toBeUndefined();
      expect(got).toEqual(noGuid);
    });
  });

  describe('SettingsRepository', () => {
    it('returns DEFAULT_SETTINGS when absent, and merges partial saves over defaults', async () => {
      const db = createInMemoryWasmDatabase();
      const repos = createSqlRepositories(db);

      expect(await repos.settings.get()).toEqual(DEFAULT_SETTINGS);

      await repos.settings.save({ ...DEFAULT_SETTINGS, weeklyGoalHours: 32 });
      expect((await repos.settings.get()).weeklyGoalHours).toBe(32);

      const rows = await db.query('SELECT id FROM settings');
      expect(rows).toHaveLength(1);
    });

    it('round-trips googleClientId (migration v2 column)', async () => {
      const db = createInMemoryWasmDatabase();
      const repos = createSqlRepositories(db);

      expect((await repos.settings.get()).googleClientId).toBeUndefined();

      await repos.settings.save({ ...DEFAULT_SETTINGS, googleClientId: 'google-client-abc' });
      expect((await repos.settings.get()).googleClientId).toBe('google-client-abc');

      const rows = await db.query<{ google_client_id: string | null }>('SELECT google_client_id FROM settings');
      expect(rows).toEqual([{ google_client_id: 'google-client-abc' }]);
    });

    it('keeps a single id=1 row across repeated saves (singleton)', async () => {
      const db = createInMemoryWasmDatabase();
      const repos = createSqlRepositories(db);

      await repos.settings.save({ ...DEFAULT_SETTINGS, weeklyGoalHours: 10 });
      await repos.settings.save({ ...DEFAULT_SETTINGS, weeklyGoalHours: 20 });
      await repos.settings.save({ ...DEFAULT_SETTINGS, weeklyGoalHours: 30 });

      const rows = await db.query('SELECT id, weekly_goal_hours FROM settings');
      expect(rows).toEqual([{ id: 1, weekly_goal_hours: 30 }]);
    });
  });
});
