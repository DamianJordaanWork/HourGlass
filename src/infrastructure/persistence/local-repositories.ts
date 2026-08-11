import type { Id, IsoDate } from '@domain/common/types';
import type {
  IAdoConnectionRepository,
  ICalendarAccountRepository,
  IMappingRuleRepository,
  IMeetingRepository,
  INoteRepository,
  IQuickTemplateRepository,
  ISettingsRepository,
  ITimeIntervalRepository,
} from '@domain/ports';
import type { Note } from '@domain/notes/note';
import type { AdoConnection } from '@domain/connections/connection';
import type { TimeInterval } from '@domain/time/time-interval';
import type { MappingRule } from '@domain/templates/mapping';
import type { QuickTemplate } from '@domain/templates/quick-template';
import type { CalendarAccount, Meeting } from '@domain/calendar/meeting';
import { DEFAULT_SETTINGS, type Settings } from '@domain/settings/settings';
import type { AppRepositories } from '@infrastructure/persistence/app-repositories';
import { LocalCollection, LocalValue, defaultStorage, type StorageLike } from './local-store';

export const KEY = {
  intervals: 'hourglass.intervals',
  mappingRules: 'hourglass.mappingRules',
  calendarAccounts: 'hourglass.calendarAccounts',
  meetings: 'hourglass.meetings',
  quickTemplates: 'hourglass.quickTemplates',
  notes: 'hourglass.notes',
  settings: 'hourglass.settings',
  adoConnections: 'hourglass.adoConnections',
} as const;

export class TimeIntervalRepository implements ITimeIntervalRepository {
  constructor(private readonly c: LocalCollection<TimeInterval>) {}
  async listByDate(date: IsoDate): Promise<TimeInterval[]> {
    return this.c.find((i) => i.date === date);
  }
  async listByRange(from: IsoDate, to: IsoDate): Promise<TimeInterval[]> {
    return this.c.find((i) => i.date >= from && i.date <= to);
  }
  async getRunning(): Promise<TimeInterval | null> {
    return this.c.find((i) => i.end === undefined)[0] ?? null;
  }
  async get(id: Id): Promise<TimeInterval | null> {
    return this.c.get(id);
  }
  async upsert(interval: TimeInterval): Promise<void> {
    this.c.upsert(interval);
  }
  async delete(id: Id): Promise<void> {
    this.c.delete(id);
  }
}

export class MappingRuleRepository implements IMappingRuleRepository {
  constructor(private readonly c: LocalCollection<MappingRule>) {}
  async list(): Promise<MappingRule[]> {
    return this.c.all().sort((a, b) => a.priority - b.priority);
  }
  async upsert(rule: MappingRule): Promise<void> {
    this.c.upsert(rule);
  }
  async delete(id: Id): Promise<void> {
    this.c.delete(id);
  }
}

export class CalendarAccountRepository implements ICalendarAccountRepository {
  constructor(private readonly c: LocalCollection<CalendarAccount>) {}
  async list(): Promise<CalendarAccount[]> {
    return this.c.all();
  }
  async upsert(account: CalendarAccount): Promise<void> {
    this.c.upsert(account);
  }
  async delete(id: Id): Promise<void> {
    this.c.delete(id);
  }
}

export class MeetingRepository implements IMeetingRepository {
  constructor(private readonly c: LocalCollection<Meeting>) {}
  async listByDate(date: IsoDate): Promise<Meeting[]> {
    return this.c.find((m) => m.date === date).sort((a, b) => a.start.localeCompare(b.start));
  }
  async upsertMany(meetings: readonly Meeting[]): Promise<void> {
    this.c.upsertMany(meetings);
  }
}

export class QuickTemplateRepository implements IQuickTemplateRepository {
  constructor(private readonly c: LocalCollection<QuickTemplate>) {}
  async list(): Promise<QuickTemplate[]> {
    return this.c.all().sort((a, b) => a.sortOrder - b.sortOrder);
  }
  async upsert(template: QuickTemplate): Promise<void> {
    this.c.upsert(template);
  }
  async delete(id: Id): Promise<void> {
    this.c.delete(id);
  }
}

export class NoteRepository implements INoteRepository {
  constructor(private readonly c: LocalCollection<Note>) {}
  async list(): Promise<Note[]> {
    return this.c.all().sort((a, b) => a.sortOrder - b.sortOrder);
  }
  async upsert(note: Note): Promise<void> {
    this.c.upsert(note);
  }
  async delete(id: Id): Promise<void> {
    this.c.delete(id);
  }
}

export class AdoConnectionRepository implements IAdoConnectionRepository {
  constructor(private readonly c: LocalCollection<AdoConnection>) {}
  async list(): Promise<AdoConnection[]> {
    return this.c.all().sort((a, b) => a.label.localeCompare(b.label));
  }
  async get(id: Id): Promise<AdoConnection | null> {
    return this.c.get(id);
  }
  async upsert(connection: AdoConnection): Promise<void> {
    this.c.upsert(connection);
  }
  async delete(id: Id): Promise<void> {
    this.c.delete(id);
  }
}

export class SettingsRepository implements ISettingsRepository {
  constructor(private readonly v: LocalValue<Settings>) {}
  async get(): Promise<Settings> {
    return this.v.get();
  }
  async save(settings: Settings): Promise<Settings> {
    return this.v.set(settings);
  }
}

export interface LocalRepositories extends AppRepositories {
  readonly intervals: TimeIntervalRepository;
  readonly mappingRules: MappingRuleRepository;
  readonly calendarAccounts: CalendarAccountRepository;
  readonly meetings: MeetingRepository;
  readonly quickTemplates: QuickTemplateRepository;
  readonly notes: NoteRepository;
  readonly settings: SettingsRepository;
  readonly adoConnections: AdoConnectionRepository;
}

export function createLocalRepositories(storage: StorageLike = defaultStorage()): LocalRepositories {
  return {
    intervals: new TimeIntervalRepository(new LocalCollection(KEY.intervals, storage)),
    mappingRules: new MappingRuleRepository(new LocalCollection(KEY.mappingRules, storage)),
    calendarAccounts: new CalendarAccountRepository(new LocalCollection(KEY.calendarAccounts, storage)),
    meetings: new MeetingRepository(new LocalCollection(KEY.meetings, storage)),
    quickTemplates: new QuickTemplateRepository(new LocalCollection(KEY.quickTemplates, storage)),
    notes: new NoteRepository(new LocalCollection(KEY.notes, storage)),
    settings: new SettingsRepository(new LocalValue(KEY.settings, DEFAULT_SETTINGS, storage)),
    adoConnections: new AdoConnectionRepository(new LocalCollection(KEY.adoConnections, storage)),
  };
}
