/**
 * Domain ports (interfaces). Adapters live in `infrastructure/` and are wired in
 * `composition/`. Nothing in `domain/` imports an adapter.
 */
import type { Id, IsoDate } from '@domain/common/types';
import type {
  CreateTimeEntry,
  HarvestProject,
  HarvestTimeEntry,
  UpdateTimeEntry,
} from '@domain/harvest/harvest-types';
import type { WorkItem } from '@domain/work-items/work-item';
import type { CalendarAccount, Meeting } from '@domain/calendar/meeting';
import type { TimeInterval } from '@domain/time/time-interval';
import type { MappingRule } from '@domain/templates/mapping';
import type { QuickTemplate } from '@domain/templates/quick-template';
import type { Settings } from '@domain/settings/settings';
import type { Note } from '@domain/notes/note';
import type { AdoConnection } from '@domain/connections/connection';

// ── External service clients ──────────────────────────────────────────────

export interface IHarvestClient {
  getProjectAssignments(): Promise<HarvestProject[]>;
  getTimeEntries(from: IsoDate, to: IsoDate): Promise<HarvestTimeEntry[]>;
  createTimeEntry(entry: CreateTimeEntry): Promise<HarvestTimeEntry>;
  updateTimeEntry(id: number, patch: UpdateTimeEntry): Promise<HarvestTimeEntry>;
  deleteTimeEntry(id: number): Promise<void>;
  stopTimer(id: number): Promise<HarvestTimeEntry>;
  restartTimer(id: number): Promise<HarvestTimeEntry>;
}

export interface ListWorkItemsOptions {
  readonly includeCompleted?: boolean;
  readonly iterationPath?: string;
  readonly workItemTypes?: readonly string[];
}

export interface IAzureDevOpsClient {
  listAssignedWorkItems(connectionId: Id, options?: ListWorkItemsOptions): Promise<WorkItem[]>;
  getWorkItem(connectionId: Id, workItemId: number): Promise<WorkItem>;
  /** Increment `Microsoft.VSTS.Scheduling.CompletedWork` by `deltaHours` (best-effort). */
  syncCompletedWork(connectionId: Id, workItemId: number, deltaHours: number): Promise<void>;
}

/** One adapter per provider (Microsoft Graph / Google / ICS). */
export interface ICalendarSource {
  readonly provider: CalendarAccount['provider'];
  fetchDay(account: CalendarAccount, date: IsoDate): Promise<Meeting[]>;
}

export interface OAuthConfig {
  readonly provider: 'Microsoft' | 'Google';
  readonly clientId: string;
  readonly scopes: readonly string[];
  readonly authorizeUrl: string;
  readonly tokenUrl: string;
  readonly redirectUri: string;
  readonly extraAuthParams?: Readonly<Record<string, string>>;
}

export interface TokenSet {
  readonly accessToken: string;
  readonly refreshToken?: string;
  readonly expiresAt: number; // epoch ms
  readonly scope?: string;
}

export interface IOAuthService {
  /** Interactive PKCE + loopback flow; returns tokens. */
  authorize(config: OAuthConfig): Promise<TokenSet>;
  refresh(config: OAuthConfig, refreshToken: string): Promise<TokenSet>;
}

// ── Secrets + transport ───────────────────────────────────────────────────

export interface ISecretStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface HttpRequest {
  readonly method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  readonly url: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
}

export interface HttpResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

/** CORS-free transport: Tauri HTTP on desktop, proxy on web. */
export interface IHttpTransport {
  send(request: HttpRequest): Promise<HttpResponse>;
}

// ── Repositories (SQLite) ─────────────────────────────────────────────────

export interface ITimeIntervalRepository {
  listByDate(date: IsoDate): Promise<TimeInterval[]>;
  listByRange(from: IsoDate, to: IsoDate): Promise<TimeInterval[]>;
  getRunning(): Promise<TimeInterval | null>;
  get(id: Id): Promise<TimeInterval | null>;
  upsert(interval: TimeInterval): Promise<void>;
  delete(id: Id): Promise<void>;
}

export interface IMappingRuleRepository {
  list(): Promise<MappingRule[]>;
  upsert(rule: MappingRule): Promise<void>;
  delete(id: Id): Promise<void>;
}

export interface ICalendarAccountRepository {
  list(): Promise<CalendarAccount[]>;
  upsert(account: CalendarAccount): Promise<void>;
  delete(id: Id): Promise<void>;
}

export interface IMeetingRepository {
  listByDate(date: IsoDate): Promise<Meeting[]>;
  upsertMany(meetings: readonly Meeting[]): Promise<void>;
}

export interface IQuickTemplateRepository {
  list(): Promise<QuickTemplate[]>;
  upsert(template: QuickTemplate): Promise<void>;
  delete(id: Id): Promise<void>;
}

export interface ISettingsRepository {
  get(): Promise<Settings>;
  save(settings: Settings): Promise<Settings>;
}

export interface INoteRepository {
  list(): Promise<Note[]>;
  upsert(note: Note): Promise<void>;
  delete(id: Id): Promise<void>;
}

export interface IAdoConnectionRepository {
  list(): Promise<AdoConnection[]>;
  get(id: Id): Promise<AdoConnection | null>;
  upsert(connection: AdoConnection): Promise<void>;
  delete(id: Id): Promise<void>;
}
