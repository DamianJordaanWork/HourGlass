import type { Container } from '@composition/container';

/**
 * Builds a `Container` for component/hook tests: every facade method throws if
 * called without an override, so a test that unexpectedly exercises an
 * un-stubbed path fails loudly instead of hanging on a real network/DB call.
 * Pass `overrides` for whichever methods the unit under test actually calls.
 */
export function makeFakeContainer(overrides: Partial<Container> = {}): Container {
  const notImplemented = (name: string) => (): never => {
    throw new Error(`makeFakeContainer: "${name}" was not stubbed but was called`);
  };

  const base: Container = {
    repos: {
      intervals: {
        listByDate: notImplemented('repos.intervals.listByDate'),
        listByRange: notImplemented('repos.intervals.listByRange'),
        getRunning: notImplemented('repos.intervals.getRunning'),
        get: notImplemented('repos.intervals.get'),
        upsert: notImplemented('repos.intervals.upsert'),
        delete: notImplemented('repos.intervals.delete'),
      },
      mappingRules: {
        list: notImplemented('repos.mappingRules.list'),
        upsert: notImplemented('repos.mappingRules.upsert'),
        delete: notImplemented('repos.mappingRules.delete'),
      },
      calendarAccounts: {
        list: notImplemented('repos.calendarAccounts.list'),
        upsert: notImplemented('repos.calendarAccounts.upsert'),
        delete: notImplemented('repos.calendarAccounts.delete'),
      },
      meetings: {
        listByDate: notImplemented('repos.meetings.listByDate'),
        upsertMany: notImplemented('repos.meetings.upsertMany'),
      },
      quickTemplates: {
        list: notImplemented('repos.quickTemplates.list'),
        upsert: notImplemented('repos.quickTemplates.upsert'),
        delete: notImplemented('repos.quickTemplates.delete'),
      },
      notes: {
        list: notImplemented('repos.notes.list'),
        upsert: notImplemented('repos.notes.upsert'),
        delete: notImplemented('repos.notes.delete'),
      },
      settings: {
        get: notImplemented('repos.settings.get'),
        save: notImplemented('repos.settings.save'),
      },
      adoConnections: {
        list: notImplemented('repos.adoConnections.list'),
        get: notImplemented('repos.adoConnections.get'),
        upsert: notImplemented('repos.adoConnections.upsert'),
        delete: notImplemented('repos.adoConnections.delete'),
      },
    },
    clock: {
      now: notImplemented('clock.now'),
      nowIso: notImplemented('clock.nowIso'),
      today: notImplemented('clock.today'),
    },
    // Application services are heavy classes wired against real repos; tests
    // that need them should pass a real instance (or a narrow fake) via
    // `overrides` rather than relying on this placeholder.
    tracking: {} as Container['tracking'],
    mapping: {} as Container['mapping'],
    connections: {} as Container['connections'],
    ready: Promise.resolve(),
    newId: notImplemented('newId'),
    isConfigured: () => false,
    reconfigure: notImplemented('reconfigure'),
    listWorkItems: notImplemented('listWorkItems'),
    listMeetings: notImplemented('listMeetings'),
    harvestName: () => ({}),
    harvestProjectOptions: () => [],
    listHarvestEntries: notImplemented('listHarvestEntries'),
    deleteHarvestEntry: notImplemented('deleteHarvestEntry'),
  };

  return {
    ...base,
    ...overrides,
    repos: { ...base.repos, ...overrides.repos },
  };
}
