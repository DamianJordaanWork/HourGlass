import type { IClock } from '@domain/common/clock';
import type { IsoDate } from '@domain/common/types';
import type { WorkItem } from '@domain/work-items/work-item';
import type { Meeting } from '@domain/calendar/meeting';
import type { HarvestProject, HarvestTimeEntry } from '@domain/harvest/harvest-types';
import { SystemClock } from '@infrastructure/system-clock';
import type { AppRepositories } from '@infrastructure/persistence/app-repositories';
import { createRepositories } from '@infrastructure/persistence/create-repositories';
import { createSecretStore } from '@composition/create-secret-store';
import { createHttpTransport } from '@infrastructure/http/http-transport';
import { createOAuthService } from '@composition/create-oauth-service';
import {
  ConnectionManager,
  type HarvestName,
} from '@infrastructure/connections/connection-manager';
import { TrackingService } from '@application/tracking-service';
import { MappingService } from '@application/mapping-service';
import { fanOutWorkItems } from '@composition/list-work-items';
import {
  clearBrokenDemoSeed,
  demoMeetings,
  demoProjectNames,
  demoWorkItems,
  seedDemo,
} from '@infrastructure/dev/demo-data';

export type {
  HarvestName,
  Probe,
  HarvestConfigView,
  AdoConnectionView,
  AdoConnectionInput,
  CalendarAccountView,
  CalendarAccountInput,
} from '@infrastructure/connections/connection-manager';

export interface Container {
  readonly repos: AppRepositories;
  readonly clock: IClock;
  readonly tracking: TrackingService;
  readonly mapping: MappingService;
  readonly connections: ConnectionManager;
  readonly ready: Promise<void>;
  newId(): string;
  /** False while unconfigured — the UI shows demo data and a "Demo" badge. */
  isConfigured(): boolean;
  /** Rebuild live clients after connections change, e.g. from the Settings UI. */
  reconfigure(): Promise<void>;
  /** With `wiql`, runs that saved query per enabled connection; without, lists items assigned to me. */
  listWorkItems(wiql?: string): Promise<WorkItem[]>;
  listMeetings(date: IsoDate): Promise<Meeting[]>;
  harvestName(projectId?: number, taskId?: number): HarvestName;
  /** Project/task options for template pickers — live when connected, else demo. */
  harvestProjectOptions(): HarvestProject[];
  /** Existing Harvest time entries in [from, to] (empty when unconnected). */
  listHarvestEntries(from: IsoDate, to: IsoDate): Promise<HarvestTimeEntry[]>;
  /** Delete a Harvest entry directly (used for Harvest-only rows). */
  deleteHarvestEntry(id: number): Promise<void>;
}

/**
 * Composition root. Wires local persistence + system clock + use cases + the
 * connection manager (real Harvest/ADO adapters). Falls back to seeded demo data
 * whenever nothing is configured, so a first run is immediately explorable and
 * `npm run dev` works without credentials.
 */
export function createContainer(): Container {
  // Web: WASM SQLite (IndexedDB-backed) with a localStorage fallback + one-time
  // import, behind a synchronous facade. Desktop (isTauri()): native SQLite via
  // `@tauri-apps/plugin-sql`, wired through the same createSqlRepositories();
  // no localStorage import (fresh desktop installs have nothing to import).
  // Both branches share the repos/facade layer above — see
  // createRepositories() (F4, now wired; desktop path not yet run — see
  // ADR-015 and active-memory.md).
  const { repos, ready: reposReady } = createRepositories();
  const clock = new SystemClock();
  const newId = () => crypto.randomUUID();

  const transport = createHttpTransport();

  const connections = new ConnectionManager({
    settings: repos.settings,
    adoConnections: repos.adoConnections,
    calendarAccounts: repos.calendarAccounts,
    secrets: createSecretStore(),
    transport,
    oauth: createOAuthService(transport),
    clock,
    newId,
  });

  const tracking = new TrackingService({
    intervals: repos.intervals,
    settings: repos.settings,
    clock,
    newId,
    // Live providers → undefined in demo mode, so sync is skipped silently.
    harvest: () => connections.harvest(),
    ado: () => connections.ado(),
    adoGuid: (id) => connections.adoGuid(id),
    warn: (m) => console.warn('[sync]', m),
  });

  const mapping = new MappingService(repos.mappingRules);

  const isConfigured = () => connections.configured();

  return {
    repos,
    clock,
    tracking,
    mapping,
    connections,
    newId,
    isConfigured,
    reconfigure: () => connections.reconfigure(),
    // Reconfigure first so we know whether we're connected, THEN either seed demo
    // samples (unconfigured) or strip any leftover placeholder-id samples that
    // would otherwise 422 against real Harvest.
    ready: reposReady
      .then(() => connections.reconfigure())
      .then(async () => {
        if (isConfigured()) {
          const removed = await clearBrokenDemoSeed(repos);
          if (removed > 0) console.info(`[demo] removed ${removed} sample mapping(s) with placeholder Harvest ids`);
        } else {
          await seedDemo(repos);
        }
      })
      // Startup is best-effort: a failing secret store or a stalled probe must
      // leave the app usable (and must not surface as an unhandled rejection),
      // rather than taking the whole shell down with it (ADR-032).
      .catch((e: unknown) => {
        console.error('[startup] container initialization failed — the app will run with reduced functionality', e);
      }),
    async listWorkItems(wiql) {
      return fanOutWorkItems({
        ado: connections.ado(),
        listEnabledAdoConnections: async () => (await repos.adoConnections.list()).filter((c) => c.enabled),
        demoWorkItems,
        wiql,
        fetchParents: (await repos.settings.get()).fetchParentWorkItems,
      });
    },
    async listMeetings(date) {
      const accounts = (await repos.calendarAccounts.list()).filter((a) => a.enabled);
      if (accounts.length === 0) {
        return isConfigured() ? repos.meetings.listByDate(date) : demoMeetings(date);
      }
      const sources = connections.calendars();
      await Promise.all(
        accounts.map(async (account) => {
          const source = sources.get(account.id);
          if (!source) return;
          try {
            const fetched = await source.fetchDay(account, date);
            await repos.meetings.upsertMany(fetched);
          } catch (e) {
            // Best-effort: a provider hiccup shouldn't blank the day — whatever
            // was already cached from a prior sync is still returned below.
            console.warn('[calendar] fetchDay failed', account.displayName, e);
          }
        }),
      );
      return repos.meetings.listByDate(date);
    },
    harvestName(projectId, taskId) {
      if (isConfigured()) return connections.harvestName(projectId, taskId);
      if (projectId === undefined) return {};
      const p = demoProjectNames[projectId];
      return { projectName: p?.project, taskName: taskId !== undefined ? p?.tasks[taskId] : undefined };
    },
    async listHarvestEntries(from, to) {
      const harvest = connections.harvest();
      if (!harvest) return [];
      try {
        return await harvest.getTimeEntries(from, to);
      } catch (e) {
        console.warn('[harvest] getTimeEntries failed', e);
        return [];
      }
    },
    async deleteHarvestEntry(id) {
      const harvest = connections.harvest();
      if (!harvest) return;
      await harvest.deleteTimeEntry(id);
    },
    harvestProjectOptions() {
      const live = connections.projects();
      if (live.length > 0) return live;
      // Demo fallback so pickers are populated before Harvest is connected.
      return Object.entries(demoProjectNames).map(([id, p]) => ({
        id: Number(id),
        name: p.project,
        tasks: Object.entries(p.tasks).map(([tid, name]) => ({ id: Number(tid), name })),
      }));
    },
  };
}
