import type {
  IAdoConnectionRepository,
  ICalendarAccountRepository,
  IMappingRuleRepository,
  IMeetingRepository,
  INoteRepository,
  IQuickTemplateRepository,
  ISettingsRepository,
  ITimeIntervalRepository,
  IWorkItemSectionRepository,
} from '@domain/ports';

/**
 * The persistence surface the composition root wires up and callers consume —
 * identical shape whether backed by WASM SQLite or the localStorage fallback.
 */
export interface AppRepositories {
  readonly intervals: ITimeIntervalRepository;
  readonly mappingRules: IMappingRuleRepository;
  readonly workItemSections: IWorkItemSectionRepository;
  readonly calendarAccounts: ICalendarAccountRepository;
  readonly meetings: IMeetingRepository;
  readonly quickTemplates: IQuickTemplateRepository;
  readonly notes: INoteRepository;
  readonly settings: ISettingsRepository;
  readonly adoConnections: IAdoConnectionRepository;
}

/**
 * Proxies an `AppRepositories` that resolves asynchronously (e.g. once WASM
 * SQLite finishes initializing, or after falling back to localStorage) behind
 * a synchronously constructible facade. Every call awaits `backend` first, so
 * callers can be handed a `RepositoriesFacade` immediately at composition time
 * without needing to await the underlying backend themselves.
 */
export class RepositoriesFacade implements AppRepositories {
  constructor(private readonly backend: Promise<AppRepositories>) {}

  readonly intervals: ITimeIntervalRepository = {
    listByDate: async (...a) => (await this.backend).intervals.listByDate(...a),
    listByRange: async (...a) => (await this.backend).intervals.listByRange(...a),
    getRunning: async (...a) => (await this.backend).intervals.getRunning(...a),
    get: async (...a) => (await this.backend).intervals.get(...a),
    upsert: async (...a) => (await this.backend).intervals.upsert(...a),
    delete: async (...a) => (await this.backend).intervals.delete(...a),
  };

  readonly mappingRules: IMappingRuleRepository = {
    list: async (...a) => (await this.backend).mappingRules.list(...a),
    upsert: async (...a) => (await this.backend).mappingRules.upsert(...a),
    delete: async (...a) => (await this.backend).mappingRules.delete(...a),
  };

  readonly workItemSections: IWorkItemSectionRepository = {
    list: async (...a) => (await this.backend).workItemSections.list(...a),
    upsert: async (...a) => (await this.backend).workItemSections.upsert(...a),
    delete: async (...a) => (await this.backend).workItemSections.delete(...a),
  };

  readonly calendarAccounts: ICalendarAccountRepository = {
    list: async (...a) => (await this.backend).calendarAccounts.list(...a),
    upsert: async (...a) => (await this.backend).calendarAccounts.upsert(...a),
    delete: async (...a) => (await this.backend).calendarAccounts.delete(...a),
  };

  readonly meetings: IMeetingRepository = {
    listByDate: async (...a) => (await this.backend).meetings.listByDate(...a),
    upsertMany: async (...a) => (await this.backend).meetings.upsertMany(...a),
  };

  readonly quickTemplates: IQuickTemplateRepository = {
    list: async (...a) => (await this.backend).quickTemplates.list(...a),
    upsert: async (...a) => (await this.backend).quickTemplates.upsert(...a),
    delete: async (...a) => (await this.backend).quickTemplates.delete(...a),
  };

  readonly notes: INoteRepository = {
    list: async (...a) => (await this.backend).notes.list(...a),
    upsert: async (...a) => (await this.backend).notes.upsert(...a),
    delete: async (...a) => (await this.backend).notes.delete(...a),
  };

  readonly settings: ISettingsRepository = {
    get: async (...a) => (await this.backend).settings.get(...a),
    save: async (...a) => (await this.backend).settings.save(...a),
  };

  readonly adoConnections: IAdoConnectionRepository = {
    list: async (...a) => (await this.backend).adoConnections.list(...a),
    get: async (...a) => (await this.backend).adoConnections.get(...a),
    upsert: async (...a) => (await this.backend).adoConnections.upsert(...a),
    delete: async (...a) => (await this.backend).adoConnections.delete(...a),
  };
}
