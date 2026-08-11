import type { Id, IsoDate } from '@domain/common/types';
import type { IClock } from '@domain/common/clock';
import type {
  IAdoConnectionRepository,
  IAzureDevOpsClient,
  ICalendarAccountRepository,
  ICalendarSource,
  IHarvestClient,
  IHttpTransport,
  IOAuthService,
  ISecretStore,
  ISettingsRepository,
  OAuthConfig,
} from '@domain/ports';
import type { HarvestProject } from '@domain/harvest/harvest-types';
import type { AdoConnection } from '@domain/connections/connection';
import type { CalendarAccount, CalendarProvider, Meeting } from '@domain/calendar/meeting';
import {
  HARVEST_TOKEN_KEY,
  adoPatKey,
  calendarExpiryKey,
  calendarRefreshKey,
  calendarTokenKey,
} from '@domain/connections/connection';
import { parseAdoConnectionGuid } from '@domain/harvest/ado-external-ref';
import { HarvestClient } from '@infrastructure/harvest/harvest-client';
import {
  AzureDevOpsClient,
  type AdoConnectionResolver,
} from '@infrastructure/ado/ado-client';
import { IcsCalendarSource } from '@infrastructure/calendar/ics-calendar-source';
import { MicrosoftGraphCalendarSource } from '@infrastructure/calendar/microsoft-graph-calendar-source';
import { GoogleCalendarSource } from '@infrastructure/calendar/google-calendar-source';

const GRAPH_SCOPES = ['Calendars.Read', 'offline_access', 'openid', 'profile'];
const MS_AUTHORIZE_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';
const MS_TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';

const GOOGLE_SCOPES = ['https://www.googleapis.com/auth/calendar.readonly', 'openid', 'email'];
const GOOGLE_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

/** Refresh a calendar access token this long before it actually expires. */
const TOKEN_REFRESH_SKEW_MS = 60_000;

/** Result of testing a connection's credentials. */
export type Probe =
  | { readonly state: 'ok'; readonly detail: string }
  | { readonly state: 'error'; readonly error: string }
  | { readonly state: 'idle' };

export interface HarvestConfigView {
  readonly accountId: string;
  readonly hasToken: boolean;
  readonly probe: Probe;
}

export interface AdoConnectionView extends AdoConnection {
  readonly hasPat: boolean;
}

export interface HarvestName {
  readonly projectName?: string;
  readonly taskName?: string;
}

export interface AdoConnectionInput {
  readonly id?: Id;
  readonly label: string;
  readonly orgUrl: string;
  readonly iterationPath?: string;
  readonly enabled: boolean;
}

export interface CalendarAccountView extends CalendarAccount {
  readonly probe: Probe;
}

export interface CalendarAccountInput {
  readonly id?: Id;
  readonly provider: CalendarProvider;
  readonly displayName: string;
  readonly icsUrl?: string;
  readonly enabled: boolean;
}

interface Deps {
  readonly settings: ISettingsRepository;
  readonly adoConnections: IAdoConnectionRepository;
  readonly calendarAccounts: ICalendarAccountRepository;
  readonly secrets: ISecretStore;
  readonly transport: IHttpTransport;
  readonly oauth: IOAuthService;
  readonly clock: IClock;
  readonly newId: () => Id;
}

/**
 * Owns the runtime Harvest/ADO clients built from persisted connection config +
 * secrets. Lives in infrastructure because it constructs concrete adapters; the
 * composition root wires it and the presentation layer drives it via the
 * container facade. When nothing is configured, {@link harvest}/{@link ado}
 * resolve to `undefined` so callers transparently fall back to demo mode.
 */
export class ConnectionManager {
  private liveHarvest?: IHarvestClient;
  private liveAdo?: IAzureDevOpsClient;
  private harvestProjects: HarvestProject[] = [];
  private harvestProbe: Probe = { state: 'idle' };
  private readonly icsSource: IcsCalendarSource;
  private readonly graphSource: MicrosoftGraphCalendarSource;
  private readonly googleSource: GoogleCalendarSource;
  private calendarSourceMap = new Map<Id, ICalendarSource>();
  private calendarProbes = new Map<Id, Probe>();
  /** Light in-flight de-dupe so concurrent `fetchDay` calls for one account don't trigger parallel refreshes. */
  private readonly refreshInFlight = new Map<Id, Promise<{ accessToken: string } | null>>();

  constructor(private readonly deps: Deps) {
    this.icsSource = new IcsCalendarSource(deps.transport);
    this.graphSource = new MicrosoftGraphCalendarSource(deps.transport, this.calendarTokenResolver);
    this.googleSource = new GoogleCalendarSource(deps.transport, this.calendarTokenResolver);
  }

  // ── live client accessors (passed to TrackingService as providers) ────────
  harvest(): IHarvestClient | undefined {
    return this.liveHarvest;
  }
  ado(): IAzureDevOpsClient | undefined {
    return this.liveAdo;
  }
  /** Enabled calendar accounts → the shared `ICalendarSource` instance to fetch them with. */
  calendars(): Map<Id, ICalendarSource> {
    return new Map(this.calendarSourceMap);
  }
  /** True when at least one real client is active (i.e. not pure demo mode). */
  configured(): boolean {
    return this.liveHarvest !== undefined || this.liveAdo !== undefined;
  }

  /** Harvest projects fetched by the last successful probe (for pickers). */
  projects(): HarvestProject[] {
    return this.harvestProjects.slice();
  }

  /** Friendly Harvest project/task names for a live-mode interval chip. */
  harvestName(projectId?: number, taskId?: number): HarvestName {
    if (projectId === undefined) return {};
    const project = this.harvestProjects.find((p) => p.id === projectId);
    if (!project) return {};
    const task = taskId !== undefined ? project.tasks.find((t) => t.id === taskId) : undefined;
    return { projectName: project.name, taskName: task?.name };
  }

  /**
   * Rebuild live clients from persisted config + secrets. Best-effort: a failed
   * Harvest probe leaves the client active (data still syncs) but records the
   * error for the UI. Safe to call repeatedly (after any Save).
   */
  async reconfigure(): Promise<void> {
    // Harvest
    const settings = await this.deps.settings.get();
    const token = await this.deps.secrets.get(HARVEST_TOKEN_KEY);
    if (settings.harvestAccountId && token) {
      this.liveHarvest = new HarvestClient(this.deps.transport, {
        accountId: settings.harvestAccountId,
        token,
      });
      this.harvestProbe = await this.probeHarvest();
    } else {
      this.liveHarvest = undefined;
      this.harvestProjects = [];
      this.harvestProbe = { state: 'idle' };
    }

    // Azure DevOps — one client with a resolver reading repo + secrets live.
    const connections = await this.deps.adoConnections.list();
    const anyUsable = await this.hasUsableAdoConnection(connections);
    this.liveAdo = anyUsable ? new AzureDevOpsClient(this.deps.transport, this.adoResolver) : undefined;

    // Best-effort: learn Harvest⇄ADO connection GUIDs from existing Harvest
    // entries so ADO's official widget binds to entries Hourglass creates
    // (ADR-021). Never throws.
    await this.learnHarvestGuids();

    // Calendars — a shared source per provider; each enabled account maps to it.
    const calendarAccounts = await this.deps.calendarAccounts.list();
    const map = new Map<Id, ICalendarSource>();
    for (const account of calendarAccounts) {
      if (!account.enabled) continue;
      const source =
        account.provider === 'Ics' ? this.icsSource : account.provider === 'Google' ? this.googleSource : this.graphSource;
      map.set(account.id, source);
    }
    this.calendarSourceMap = map;
  }

  // ── Harvest config ────────────────────────────────────────────────────────
  async getHarvestConfig(): Promise<HarvestConfigView> {
    const settings = await this.deps.settings.get();
    const token = await this.deps.secrets.get(HARVEST_TOKEN_KEY);
    return {
      accountId: settings.harvestAccountId ?? '',
      hasToken: token !== null && token.length > 0,
      probe: this.harvestProbe,
    };
  }

  /** Persist Harvest account id (+ token when a new one is supplied), then probe. */
  async saveHarvest(accountId: string, token?: string): Promise<Probe> {
    const settings = await this.deps.settings.get();
    await this.deps.settings.save({ ...settings, harvestAccountId: accountId.trim() || undefined });
    if (token !== undefined && token.trim().length > 0) {
      await this.deps.secrets.set(HARVEST_TOKEN_KEY, token.trim());
    }
    await this.reconfigure();
    return this.harvestProbe;
  }

  async clearHarvest(): Promise<void> {
    const settings = await this.deps.settings.get();
    await this.deps.settings.save({ ...settings, harvestAccountId: undefined });
    await this.deps.secrets.delete(HARVEST_TOKEN_KEY);
    await this.reconfigure();
  }

  /**
   * Best-effort: scan a recent window of Harvest entries for external
   * references created by ADO's official Harvest widget, parse the Harvest
   * connection GUID out of any hit (ADR-021), and cache it on the matching
   * {@link AdoConnection} (matched by the entry's permalink starting with the
   * connection's org URL — the host alone isn't enough since every ADO org
   * shares the `dev.azure.com` host) so future pushes splice it into the id
   * ourselves. Never throws; a failure just leaves guids unlearned.
   */
  async learnHarvestGuids(): Promise<void> {
    const harvest = this.liveHarvest;
    if (!harvest) return;
    try {
      const to = toIsoDate(this.deps.clock.now());
      const from = toIsoDate(new Date(this.deps.clock.now().getTime() - 90 * 24 * 60 * 60 * 1000));
      const entries = await harvest.getTimeEntries(from, to);
      const connections = await this.deps.adoConnections.list();
      for (const entry of entries) {
        const ref = entry.externalReference;
        if (!ref) continue;
        const guid = parseAdoConnectionGuid(ref.id);
        if (!guid) continue;
        const match = connections.find((c) => permalinkBelongsToOrg(ref.permalink, c.orgUrl));
        if (!match || match.harvestGuid === guid) continue;
        await this.deps.adoConnections.upsert({ ...match, harvestGuid: guid });
      }
    } catch (e) {
      console.warn('[ado] learnHarvestGuids failed', e);
    }
  }

  /** Resolves a connection's learned Harvest⇄ADO GUID (ADR-021), if any. */
  async adoGuid(connectionId: Id): Promise<string | undefined> {
    const connection = await this.deps.adoConnections.get(connectionId);
    return connection?.harvestGuid;
  }

  // ── ADO connections ─────────────────────────────────────────────────────
  async listAdo(): Promise<AdoConnectionView[]> {
    const connections = await this.deps.adoConnections.list();
    const views = await Promise.all(
      connections.map(async (c) => ({
        ...c,
        hasPat: (await this.deps.secrets.get(adoPatKey(c.id)))?.length ? true : false,
      })),
    );
    return views;
  }

  /** Upsert an ADO connection (+ PAT when supplied), reconfigure, then probe it. */
  async saveAdo(input: AdoConnectionInput, pat?: string): Promise<Probe> {
    const id = input.id ?? this.deps.newId();
    const connection: AdoConnection = {
      id,
      label: input.label.trim(),
      orgUrl: input.orgUrl.trim().replace(/\/+$/, ''),
      iterationPath: input.iterationPath?.trim() || undefined,
      enabled: input.enabled,
    };
    await this.deps.adoConnections.upsert(connection);
    if (pat !== undefined && pat.trim().length > 0) {
      await this.deps.secrets.set(adoPatKey(id), pat.trim());
    }
    await this.reconfigure();
    return this.probeAdo(id);
  }

  async deleteAdo(id: Id): Promise<void> {
    await this.deps.adoConnections.delete(id);
    await this.deps.secrets.delete(adoPatKey(id));
    await this.reconfigure();
  }

  // ── Calendar accounts ────────────────────────────────────────────────────
  async listCalendars(): Promise<CalendarAccountView[]> {
    const accounts = await this.deps.calendarAccounts.list();
    return accounts.map((a) => ({ ...a, probe: this.calendarProbes.get(a.id) ?? { state: 'idle' } }));
  }

  /** Upsert an ICS calendar account, reconfigure, then probe it. */
  async saveCalendarAccount(input: CalendarAccountInput): Promise<Probe> {
    const id = input.id ?? this.deps.newId();
    const account: CalendarAccount = {
      id,
      provider: input.provider,
      displayName: input.displayName.trim(),
      icsUrl: input.icsUrl?.trim() || undefined,
      enabled: input.enabled,
    };
    await this.deps.calendarAccounts.upsert(account);
    await this.reconfigure();
    return this.probeCalendarAccount(id);
  }

  async deleteCalendarAccount(id: Id): Promise<void> {
    await this.deps.calendarAccounts.delete(id);
    await this.deps.secrets.delete(calendarTokenKey(id));
    await this.deps.secrets.delete(calendarRefreshKey(id));
    await this.deps.secrets.delete(calendarExpiryKey(id));
    this.calendarProbes.delete(id);
    this.refreshInFlight.delete(id);
    await this.reconfigure();
  }

  /**
   * Runs the interactive Microsoft OAuth popup flow, persists the resulting
   * tokens, and upserts a `Microsoft`-provider calendar account (adopting an
   * existing account with `existingId` when re-connecting/re-authorizing).
   */
  async connectMicrosoftAccount(clientId: string, existingId?: Id): Promise<Probe> {
    const settings = await this.deps.settings.get();
    if (settings.microsoftClientId !== clientId.trim()) {
      await this.deps.settings.save({ ...settings, microsoftClientId: clientId.trim() });
    }

    const tokens = await this.deps.oauth.authorize(this.msOAuthConfig(clientId));
    const id = existingId ?? this.deps.newId();
    await this.deps.secrets.set(calendarTokenKey(id), tokens.accessToken);
    if (tokens.refreshToken) await this.deps.secrets.set(calendarRefreshKey(id), tokens.refreshToken);
    await this.deps.secrets.set(calendarExpiryKey(id), new Date(tokens.expiresAt).toISOString());

    const profile = await this.fetchGraphProfile(tokens.accessToken);
    const existing = (await this.deps.calendarAccounts.list()).find((a) => a.id === id);
    const account: CalendarAccount = {
      id,
      provider: 'Microsoft',
      displayName: profile.displayName ?? existing?.displayName ?? 'Microsoft Calendar',
      email: profile.email ?? existing?.email,
      enabled: true,
    };
    await this.deps.calendarAccounts.upsert(account);
    await this.reconfigure();
    return this.probeCalendarAccount(id);
  }

  /**
   * Runs the interactive Google OAuth popup flow, persists the resulting
   * tokens, and upserts a `Google`-provider calendar account (adopting an
   * existing account with `existingId` when re-connecting/re-authorizing).
   */
  async connectGoogleAccount(clientId: string, existingId?: Id): Promise<Probe> {
    const settings = await this.deps.settings.get();
    if (settings.googleClientId !== clientId.trim()) {
      await this.deps.settings.save({ ...settings, googleClientId: clientId.trim() });
    }

    const tokens = await this.deps.oauth.authorize(this.googleOAuthConfig(clientId));
    const id = existingId ?? this.deps.newId();
    await this.deps.secrets.set(calendarTokenKey(id), tokens.accessToken);
    if (tokens.refreshToken) await this.deps.secrets.set(calendarRefreshKey(id), tokens.refreshToken);
    await this.deps.secrets.set(calendarExpiryKey(id), new Date(tokens.expiresAt).toISOString());

    const profile = await this.fetchGoogleProfile(tokens.accessToken);
    const existing = (await this.deps.calendarAccounts.list()).find((a) => a.id === id);
    const account: CalendarAccount = {
      id,
      provider: 'Google',
      displayName: profile.name ?? existing?.displayName ?? 'Google Calendar',
      email: profile.email ?? existing?.email,
      enabled: true,
    };
    await this.deps.calendarAccounts.upsert(account);
    await this.reconfigure();
    return this.probeCalendarAccount(id);
  }

  // ── probes ────────────────────────────────────────────────────────────────
  async probeHarvest(): Promise<Probe> {
    if (!this.liveHarvest) return { state: 'idle' };
    try {
      const projects = await this.liveHarvest.getProjectAssignments();
      this.harvestProjects = projects.slice();
      return { state: 'ok', detail: `${projects.length} project assignment(s)` };
    } catch (e) {
      return { state: 'error', error: errMsg(e) };
    }
  }

  async probeAdo(id: Id): Promise<Probe> {
    const client = this.liveAdo;
    if (!client) return { state: 'idle' };
    const connection = await this.deps.adoConnections.get(id);
    if (!connection) return { state: 'idle' };
    try {
      const items = await client.listAssignedWorkItems(id, {
        iterationPath: connection.iterationPath,
      });
      return { state: 'ok', detail: `${items.length} assigned work item(s)` };
    } catch (e) {
      return { state: 'error', error: errMsg(e) };
    }
  }

  async probeCalendarAccount(id: Id): Promise<Probe> {
    const source = this.calendarSourceMap.get(id);
    const accounts = await this.deps.calendarAccounts.list();
    const account = accounts.find((a) => a.id === id);
    if (!source || !account) {
      const probe: Probe = { state: 'idle' };
      this.calendarProbes.set(id, probe);
      return probe;
    }
    try {
      const today = new Date().toISOString().slice(0, 10) as IsoDate;
      const meetings: Meeting[] = await source.fetchDay(account, today);
      const probe: Probe = { state: 'ok', detail: `${meetings.length} event(s) today` };
      this.calendarProbes.set(id, probe);
      return probe;
    } catch (e) {
      const probe: Probe = { state: 'error', error: errMsg(e) };
      this.calendarProbes.set(id, probe);
      return probe;
    }
  }

  // ── helpers ────────────────────────────────────────────────────────────
  /**
   * Shared, provider-agnostic resolver: every calendar provider's access token
   * lives under the same secret key. Proactively refreshes the token when it's
   * expired (or expiring within {@link TOKEN_REFRESH_SKEW_MS}) and a refresh
   * token is available (ADR-017). Best-effort: any refresh failure — missing
   * refresh token, missing client id, or a failed HTTP call — falls back to
   * returning the existing (possibly stale) access token rather than throwing,
   * so a sync attempt still happens instead of breaking silently-hard.
   * In-flight refreshes are de-duped per account so concurrent `fetchDay`
   * calls don't race two refresh requests.
   */
  private readonly calendarTokenResolver = async (accountId: Id): Promise<{ accessToken: string } | null> => {
    const inFlight = this.refreshInFlight.get(accountId);
    if (inFlight) return inFlight;

    const promise = this.resolveCalendarToken(accountId).finally(() => {
      this.refreshInFlight.delete(accountId);
    });
    this.refreshInFlight.set(accountId, promise);
    return promise;
  };

  private async resolveCalendarToken(accountId: Id): Promise<{ accessToken: string } | null> {
    const accessToken = await this.deps.secrets.get(calendarTokenKey(accountId));
    if (!accessToken) return null;

    const expiryRaw = await this.deps.secrets.get(calendarExpiryKey(accountId));
    const expiresAt = expiryRaw ? Date.parse(expiryRaw) : NaN;
    if (Number.isNaN(expiresAt)) return { accessToken };

    const now = this.deps.clock.now().getTime();
    if (now < expiresAt - TOKEN_REFRESH_SKEW_MS) return { accessToken };

    const refreshToken = await this.deps.secrets.get(calendarRefreshKey(accountId));
    if (!refreshToken) {
      console.warn(`[calendar] access token for account ${accountId} is expired but no refresh token is stored; using the stale token`);
      return { accessToken };
    }

    const account = (await this.deps.calendarAccounts.list()).find((a) => a.id === accountId);
    const config = account ? await this.refreshConfigFor(account) : null;
    if (!config) {
      console.warn(`[calendar] cannot refresh access token for account ${accountId}: no OAuth config available; using the stale token`);
      return { accessToken };
    }

    try {
      const refreshed = await this.deps.oauth.refresh(config, refreshToken);
      await this.deps.secrets.set(calendarTokenKey(accountId), refreshed.accessToken);
      await this.deps.secrets.set(calendarExpiryKey(accountId), new Date(refreshed.expiresAt).toISOString());
      if (refreshed.refreshToken) {
        await this.deps.secrets.set(calendarRefreshKey(accountId), refreshed.refreshToken);
      }
      return { accessToken: refreshed.accessToken };
    } catch (e) {
      console.warn(`[calendar] token refresh failed for account ${accountId}; using the stale token`, e);
      return { accessToken };
    }
  }

  /** Builds the provider-specific refresh config for a calendar account (Microsoft/Google only; ICS has no OAuth). */
  private async refreshConfigFor(account: CalendarAccount): Promise<OAuthConfig | null> {
    if (account.provider === 'Ics') return null;
    const settings = await this.deps.settings.get();
    if (account.provider === 'Microsoft') {
      if (!settings.microsoftClientId) return null;
      return this.msOAuthConfig(settings.microsoftClientId);
    }
    if (!settings.googleClientId) return null;
    return this.googleOAuthConfig(settings.googleClientId);
  }

  private msOAuthConfig(clientId: string) {
    return {
      provider: 'Microsoft' as const,
      clientId: clientId.trim(),
      scopes: GRAPH_SCOPES,
      authorizeUrl: MS_AUTHORIZE_URL,
      tokenUrl: MS_TOKEN_URL,
      redirectUri: `${window.location.origin}/?oauth=callback`,
      extraAuthParams: { response_mode: 'query' },
    };
  }

  private googleOAuthConfig(clientId: string) {
    return {
      provider: 'Google' as const,
      clientId: clientId.trim(),
      scopes: GOOGLE_SCOPES,
      authorizeUrl: GOOGLE_AUTHORIZE_URL,
      tokenUrl: GOOGLE_TOKEN_URL,
      redirectUri: `${window.location.origin}/?oauth=callback`,
      extraAuthParams: { access_type: 'offline', prompt: 'consent' },
    };
  }

  private async fetchGraphProfile(accessToken: string): Promise<{ displayName?: string; email?: string }> {
    try {
      const res = await this.deps.transport.send({
        method: 'GET',
        url: 'https://graph.microsoft.com/v1.0/me',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (res.status < 200 || res.status >= 300) return {};
      const dto = JSON.parse(res.body) as { displayName?: string; mail?: string; userPrincipalName?: string };
      return { displayName: dto.displayName, email: dto.mail ?? dto.userPrincipalName };
    } catch {
      return {};
    }
  }

  private async fetchGoogleProfile(accessToken: string): Promise<{ name?: string; email?: string }> {
    try {
      const res = await this.deps.transport.send({
        method: 'GET',
        url: 'https://openidconnect.googleapis.com/v1/userinfo',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (res.status < 200 || res.status >= 300) return {};
      const dto = JSON.parse(res.body) as { name?: string; email?: string };
      return { name: dto.name, email: dto.email };
    } catch {
      return {};
    }
  }

  private readonly adoResolver: AdoConnectionResolver = async (connectionId) => {
    const connection = await this.deps.adoConnections.get(connectionId);
    if (!connection) return null;
    const pat = await this.deps.secrets.get(adoPatKey(connectionId));
    if (!pat) return null;
    return { orgUrl: connection.orgUrl, pat };
  };

  private async hasUsableAdoConnection(connections: readonly AdoConnection[]): Promise<boolean> {
    for (const c of connections) {
      if (!c.enabled) continue;
      const pat = await this.deps.secrets.get(adoPatKey(c.id));
      if (pat && pat.length > 0) return true;
    }
    return false;
  }
}

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

const toIsoDate = (d: Date): IsoDate => d.toISOString().slice(0, 10) as IsoDate;

/**
 * True when `permalink` points into the given ADO org. Matching on host alone
 * isn't enough since every ADO org shares the `dev.azure.com` host — the org
 * name lives in the first path segment, so we require the permalink to start
 * with the connection's (normalized, trailing-slash-free) org URL.
 */
function permalinkBelongsToOrg(permalink: string, orgUrl: string): boolean {
  const normalizedOrg = orgUrl.toLowerCase().replace(/\/+$/, '');
  return permalink.toLowerCase().startsWith(`${normalizedOrg}/`);
}
