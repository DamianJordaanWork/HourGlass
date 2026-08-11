import { DEFAULT_SETTINGS } from '@domain/settings/settings';
import type { TimeInterval } from '@domain/time/time-interval';
import type { MappingRule } from '@domain/templates/mapping';
import type { CalendarAccount, Meeting } from '@domain/calendar/meeting';
import type { QuickTemplate } from '@domain/templates/quick-template';
import type { Note } from '@domain/notes/note';
import type { AdoConnection } from '@domain/connections/connection';
import type { AppRepositories } from '@infrastructure/persistence/app-repositories';
import { KEY } from '@infrastructure/persistence/local-repositories';
import { LocalCollection, LocalValue, defaultStorage, type StorageLike } from '@infrastructure/persistence/local-store';

const MIGRATED_FLAG_KEY = 'hourglass.migratedToSqlite';

/**
 * One-time import of any pre-existing `hourglass.*` localStorage data into the
 * SQL repos. Runs at most once (guarded by `hourglass.migratedToSqlite`) and
 * never deletes localStorage — it remains the fallback store if WASM SQLite
 * becomes unavailable later. Returns whether a migration actually ran.
 */
export async function migrateLocalStorageIntoSql(
  repos: AppRepositories,
  storage: StorageLike = defaultStorage(),
): Promise<boolean> {
  if (storage.getItem(MIGRATED_FLAG_KEY) !== null) return false;

  const hasLegacyData =
    storage.getItem(KEY.intervals) !== null ||
    storage.getItem(KEY.mappingRules) !== null ||
    storage.getItem(KEY.calendarAccounts) !== null ||
    storage.getItem(KEY.meetings) !== null ||
    storage.getItem(KEY.quickTemplates) !== null ||
    storage.getItem(KEY.notes) !== null ||
    storage.getItem(KEY.settings) !== null ||
    storage.getItem(KEY.adoConnections) !== null;

  if (!hasLegacyData) {
    storage.setItem(MIGRATED_FLAG_KEY, '1');
    return false;
  }

  const intervals = new LocalCollection<TimeInterval>(KEY.intervals, storage).all();
  for (const i of intervals) await repos.intervals.upsert(i);

  const mappingRules = new LocalCollection<MappingRule>(KEY.mappingRules, storage).all();
  for (const r of mappingRules) await repos.mappingRules.upsert(r);

  const calendarAccounts = new LocalCollection<CalendarAccount>(KEY.calendarAccounts, storage).all();
  for (const a of calendarAccounts) await repos.calendarAccounts.upsert(a);

  const meetings = new LocalCollection<Meeting>(KEY.meetings, storage).all();
  if (meetings.length > 0) await repos.meetings.upsertMany(meetings);

  const quickTemplates = new LocalCollection<QuickTemplate>(KEY.quickTemplates, storage).all();
  for (const t of quickTemplates) await repos.quickTemplates.upsert(t);

  const notes = new LocalCollection<Note>(KEY.notes, storage).all();
  for (const n of notes) await repos.notes.upsert(n);

  const adoConnections = new LocalCollection<AdoConnection>(KEY.adoConnections, storage).all();
  for (const c of adoConnections) await repos.adoConnections.upsert(c);

  if (storage.getItem(KEY.settings) !== null) {
    const settings = new LocalValue(KEY.settings, DEFAULT_SETTINGS, storage).get();
    await repos.settings.save(settings);
  }

  storage.setItem(MIGRATED_FLAG_KEY, '1');
  return true;
}
