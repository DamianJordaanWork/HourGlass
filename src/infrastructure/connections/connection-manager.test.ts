import { describe, it, expect, beforeEach } from 'vitest';
import { ConnectionManager } from './connection-manager';
import { createLocalRepositories } from '@infrastructure/persistence/local-repositories';
import { MemoryStorage } from '@infrastructure/persistence/local-store';
import { LocalSecretStore } from '@infrastructure/secrets/local-secret-store';
import { FakeTransport } from '@test/fake-transport';
import {
  HARVEST_TOKEN_KEY,
  adoPatKey,
  calendarExpiryKey,
  calendarRefreshKey,
  calendarTokenKey,
} from '@domain/connections/connection';
import type { IClock } from '@domain/common/clock';
import type { IOAuthService, OAuthConfig, TokenSet } from '@domain/ports';

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

class FakeOAuthService implements IOAuthService {
  authorized?: OAuthConfig;
  refreshedWith?: { config: OAuthConfig; refreshToken: string };
  refreshResult: TokenSet = { accessToken: 'refreshed-access-token', expiresAt: Date.now() + 3600_000 };
  refreshError: Error | null = null;
  tokens: TokenSet = { accessToken: 'graph-access-token', refreshToken: 'graph-refresh-token', expiresAt: Date.now() + 3600_000 };
  async authorize(config: OAuthConfig): Promise<TokenSet> {
    this.authorized = config;
    return this.tokens;
  }
  async refresh(config: OAuthConfig, refreshToken: string): Promise<TokenSet> {
    this.refreshedWith = { config, refreshToken };
    if (this.refreshError) throw this.refreshError;
    return this.refreshResult;
  }
}

function make(transport = new FakeTransport()) {
  const storage = new MemoryStorage();
  const repos = createLocalRepositories(storage);
  const secrets = new LocalSecretStore(storage);
  const oauth = new FakeOAuthService();
  const clock = new FakeClock(Date.now());
  let n = 0;
  const manager = new ConnectionManager({
    settings: repos.settings,
    adoConnections: repos.adoConnections,
    calendarAccounts: repos.calendarAccounts,
    secrets,
    transport,
    oauth,
    clock,
    newId: () => `conn-${++n}`,
  });
  return { manager, repos, secrets, transport, oauth, clock };
}

const HARVEST_ASSIGNMENTS = {
  project_assignments: [
    {
      project: { id: 1001, name: 'LetsDrive' },
      client: { name: 'Agile Bridge' },
      task_assignments: [{ task: { id: 10, name: 'Development' } }],
    },
  ],
};

describe('ConnectionManager', () => {
  let ctx: ReturnType<typeof make>;
  beforeEach(() => {
    ctx = make();
  });

  it('is unconfigured (demo mode) with no persisted config', async () => {
    await ctx.manager.reconfigure();
    expect(ctx.manager.configured()).toBe(false);
    expect(ctx.manager.harvest()).toBeUndefined();
    expect(ctx.manager.ado()).toBeUndefined();
  });

  it('activates Harvest, probes, and exposes project names once saved', async () => {
    ctx.transport.on('GET', '/project_assignments', HARVEST_ASSIGNMENTS);
    const probe = await ctx.manager.saveHarvest('123456', 'pat-token');

    expect(probe).toEqual({ state: 'ok', detail: '1 project assignment(s)' });
    expect(ctx.manager.configured()).toBe(true);
    expect(ctx.manager.harvest()).toBeDefined();
    expect(await ctx.secrets.get(HARVEST_TOKEN_KEY)).toBe('pat-token');
    expect(ctx.manager.harvestName(1001, 10)).toEqual({ projectName: 'LetsDrive', taskName: 'Development' });

    // account id persisted; token kept even if a later save omits it.
    expect((await ctx.manager.getHarvestConfig()).accountId).toBe('123456');
    await ctx.manager.saveHarvest('123456');
    expect(await ctx.secrets.get(HARVEST_TOKEN_KEY)).toBe('pat-token');
  });

  it('reports a Harvest auth error but keeps the client active', async () => {
    ctx.transport.on('GET', '/project_assignments', { error: 'nope' }, 401);
    const probe = await ctx.manager.saveHarvest('123456', 'bad-token');
    expect(probe.state).toBe('error');
    expect(ctx.manager.harvest()).toBeDefined(); // data still syncs best-effort
  });

  it('clearHarvest removes config and returns to demo mode', async () => {
    ctx.transport.on('GET', '/project_assignments', HARVEST_ASSIGNMENTS);
    await ctx.manager.saveHarvest('123456', 'pat-token');
    await ctx.manager.clearHarvest();
    expect(ctx.manager.configured()).toBe(false);
    expect(await ctx.secrets.get(HARVEST_TOKEN_KEY)).toBeNull();
  });

  it('activates an ADO connection, stores the PAT, and probes it', async () => {
    ctx.transport
      .on('POST', '/_apis/wit/wiql', { workItems: [{ id: 4821 }] })
      .on('GET', '/_apis/wit/workitems', {
        value: [{ id: 4821, fields: { 'System.Title': 'Fix bug', 'System.TeamProject': 'LetsDrive' } }],
      });

    const probe = await ctx.manager.saveAdo(
      { label: 'Agile Bridge', orgUrl: 'https://dev.azure.com/agile-bridge/', enabled: true },
      'ado-pat',
    );

    expect(probe).toEqual({ state: 'ok', detail: '1 assigned work item(s)' });
    expect(ctx.manager.ado()).toBeDefined();
    const list = await ctx.manager.listAdo();
    expect(list).toHaveLength(1);
    expect(list[0]!.hasPat).toBe(true);
    expect(list[0]!.orgUrl).toBe('https://dev.azure.com/agile-bridge'); // trailing slash trimmed
    expect(await ctx.secrets.get(adoPatKey(list[0]!.id))).toBe('ado-pat');
  });

  it('a disabled ADO connection does not activate the live client', async () => {
    await ctx.manager.saveAdo(
      { label: 'Off', orgUrl: 'https://dev.azure.com/x', enabled: false },
      'ado-pat',
    );
    expect(ctx.manager.ado()).toBeUndefined();
    expect(ctx.manager.configured()).toBe(false);
  });

  it('deleteAdo removes the connection and its PAT', async () => {
    ctx.transport
      .on('POST', '/_apis/wit/wiql', { workItems: [] })
      .on('GET', '/_apis/wit/workitems', { value: [] });
    await ctx.manager.saveAdo(
      { label: 'Agile Bridge', orgUrl: 'https://dev.azure.com/agile-bridge', enabled: true },
      'ado-pat',
    );
    const [conn] = await ctx.manager.listAdo();
    await ctx.manager.deleteAdo(conn!.id);
    expect(await ctx.manager.listAdo()).toHaveLength(0);
    expect(ctx.manager.ado()).toBeUndefined();
    expect(await ctx.secrets.get(adoPatKey(conn!.id))).toBeNull();
  });

  it('saves an ICS calendar account and makes it live via calendars()', async () => {
    ctx.transport.on('GET', 'example.com/cal.ics', 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n');

    const probe = await ctx.manager.saveCalendarAccount({
      provider: 'Ics',
      displayName: 'Work',
      icsUrl: 'https://example.com/cal.ics',
      enabled: true,
    });

    expect(probe).toEqual({ state: 'ok', detail: '0 event(s) today' });
    const [account] = await ctx.manager.listCalendars();
    expect(account!.enabled).toBe(true);
    expect(account!.probe.state).toBe('ok');
    expect(ctx.manager.calendars().get(account!.id)).toBeDefined();
  });

  it('connects a Microsoft calendar account via OAuth, stores tokens, and probes it', async () => {
    ctx.transport
      .on('GET', '/calendarView', { value: [] })
      .on('GET', '/v1.0/me', { displayName: 'Damian Jordaan', mail: 'damianj@agilebridge.co.za' });

    const probe = await ctx.manager.connectMicrosoftAccount('client-abc');

    expect(probe).toEqual({ state: 'ok', detail: '0 event(s) today' });
    expect(ctx.oauth.authorized?.clientId).toBe('client-abc');
    const [account] = await ctx.manager.listCalendars();
    expect(account!.provider).toBe('Microsoft');
    expect(account!.displayName).toBe('Damian Jordaan');
    expect(account!.email).toBe('damianj@agilebridge.co.za');
    expect(await ctx.secrets.get(calendarTokenKey(account!.id))).toBe('graph-access-token');
    expect(ctx.manager.calendars().get(account!.id)).toBeDefined();
    expect((await ctx.manager.getHarvestConfig()).accountId).toBe(''); // unrelated config untouched
  });

  it('deleteCalendarAccount removes the account and its tokens', async () => {
    ctx.transport.on('GET', '/calendarView', { value: [] }).on('GET', '/v1.0/me', {});
    await ctx.manager.connectMicrosoftAccount('client-abc');
    const [account] = await ctx.manager.listCalendars();

    await ctx.manager.deleteCalendarAccount(account!.id);

    expect(await ctx.manager.listCalendars()).toHaveLength(0);
    expect(ctx.manager.calendars().size).toBe(0);
    expect(await ctx.secrets.get(calendarTokenKey(account!.id))).toBeNull();
  });

  it('connects a Google calendar account via OAuth, stores tokens, and probes it', async () => {
    ctx.transport
      .on('GET', '/calendars/primary/events', { items: [] })
      .on('GET', '/v1/userinfo', { name: 'Damian Jordaan', email: 'damianj@agilebridge.co.za' });

    const probe = await ctx.manager.connectGoogleAccount('google-client-abc');

    expect(probe).toEqual({ state: 'ok', detail: '0 event(s) today' });
    expect(ctx.oauth.authorized?.clientId).toBe('google-client-abc');
    expect(ctx.oauth.authorized?.provider).toBe('Google');
    const [account] = await ctx.manager.listCalendars();
    expect(account!.provider).toBe('Google');
    expect(account!.displayName).toBe('Damian Jordaan');
    expect(account!.email).toBe('damianj@agilebridge.co.za');
    expect(await ctx.secrets.get(calendarTokenKey(account!.id))).toBe('graph-access-token');
    expect(ctx.manager.calendars().get(account!.id)).toBeDefined();
  });

  it('a Google account with no profile falls back to a default display name', async () => {
    ctx.transport.on('GET', '/calendars/primary/events', { items: [] }).on('GET', '/v1/userinfo', {}, 401);

    await ctx.manager.connectGoogleAccount('google-client-abc');

    const [account] = await ctx.manager.listCalendars();
    expect(account!.displayName).toBe('Google Calendar');
  });

  // ── ADR-017: proactive calendar OAuth token refresh ─────────────────────
  describe('calendarTokenResolver token refresh (ADR-017)', () => {
    async function connectMicrosoft(ctx2: ReturnType<typeof make>) {
      ctx2.transport.on('GET', '/calendarView', { value: [] }).on('GET', '/v1.0/me', { displayName: 'Damian' });
      await ctx2.manager.connectMicrosoftAccount('client-abc');
      const [account] = await ctx2.manager.listCalendars();
      return account!;
    }

    async function connectGoogle(ctx2: ReturnType<typeof make>) {
      ctx2.transport.on('GET', '/calendars/primary/events', { items: [] }).on('GET', '/v1/userinfo', { name: 'Damian' });
      await ctx2.manager.connectGoogleAccount('google-client-abc');
      const [account] = await ctx2.manager.listCalendars();
      return account!;
    }

    it('non-expired token: resolver returns the stored token, no refresh call made', async () => {
      const account = await connectMicrosoft(ctx);
      ctx.clock.advance(30 * 60_000); // 30 min — well within the 1h expiry

      await ctx.manager.probeCalendarAccount(account.id);

      expect(ctx.oauth.refreshedWith).toBeUndefined();
      expect(ctx.transport.lastRequest().headers?.Authorization).toBe('Bearer graph-access-token');
    });

    it('expired token + refresh token present: refreshes with the right provider config and persists the new token + expiry', async () => {
      const account = await connectMicrosoft(ctx);
      const before = await ctx.secrets.get(calendarExpiryKey(account.id));
      ctx.clock.advance(2 * 3600_000); // 2h — well past the 1h expiry
      ctx.oauth.refreshResult = { accessToken: 'refreshed-access-token', expiresAt: ctx.clock.now().getTime() + 3600_000 };

      await ctx.manager.probeCalendarAccount(account.id);

      expect(ctx.oauth.refreshedWith?.refreshToken).toBe('graph-refresh-token');
      expect(ctx.oauth.refreshedWith?.config.clientId).toBe('client-abc');
      expect(ctx.oauth.refreshedWith?.config.tokenUrl).toBe('https://login.microsoftonline.com/common/oauth2/v2.0/token');
      expect(await ctx.secrets.get(calendarTokenKey(account.id))).toBe('refreshed-access-token');
      expect(ctx.transport.lastRequest().headers?.Authorization).toBe('Bearer refreshed-access-token');
      const after = await ctx.secrets.get(calendarExpiryKey(account.id));
      expect(after).not.toBe(before);
      expect(Date.parse(after!)).toBeGreaterThan(Date.parse(before!));
    });

    it('rotated refresh token from the refresh response is persisted', async () => {
      const account = await connectMicrosoft(ctx);
      ctx.oauth.refreshResult = {
        accessToken: 'refreshed-access-token',
        refreshToken: 'rotated-refresh-token',
        expiresAt: Date.now() + 3600_000,
      };
      ctx.clock.advance(2 * 3600_000);

      await ctx.manager.probeCalendarAccount(account.id);

      expect(await ctx.secrets.get(calendarRefreshKey(account.id))).toBe('rotated-refresh-token');
    });

    it('expired token but no refresh token: returns the stale token without throwing', async () => {
      const account = await connectMicrosoft(ctx);
      await ctx.secrets.delete(calendarRefreshKey(account.id));
      ctx.clock.advance(2 * 3600_000);

      await expect(ctx.manager.probeCalendarAccount(account.id)).resolves.toEqual({ state: 'ok', detail: '0 event(s) today' });

      expect(ctx.oauth.refreshedWith).toBeUndefined();
      expect(ctx.transport.lastRequest().headers?.Authorization).toBe('Bearer graph-access-token');
    });

    it('refresh call failure: returns the stale token without throwing', async () => {
      const account = await connectMicrosoft(ctx);
      ctx.oauth.refreshError = new Error('token endpoint unreachable');
      ctx.clock.advance(2 * 3600_000);

      await expect(ctx.manager.probeCalendarAccount(account.id)).resolves.toEqual({ state: 'ok', detail: '0 event(s) today' });

      expect(ctx.transport.lastRequest().headers?.Authorization).toBe('Bearer graph-access-token');
    });

    it('skew boundary: a token expiring within the skew window triggers a refresh', async () => {
      const account = await connectMicrosoft(ctx);
      ctx.oauth.refreshResult = { accessToken: 'refreshed-access-token', expiresAt: Date.now() + 3600_000 };
      // 1h expiry minus 30s (inside the 60s skew window) — should already refresh.
      ctx.clock.advance(3600_000 - 30_000);

      await ctx.manager.probeCalendarAccount(account.id);

      expect(ctx.oauth.refreshedWith).toBeDefined();
      expect(ctx.transport.lastRequest().headers?.Authorization).toBe('Bearer refreshed-access-token');
    });

    it('provider correctness: a Google account refreshes against the Google token endpoint/clientId', async () => {
      const account = await connectGoogle(ctx);
      ctx.oauth.refreshResult = { accessToken: 'refreshed-google-token', expiresAt: Date.now() + 3600_000 };
      ctx.clock.advance(2 * 3600_000);

      await ctx.manager.probeCalendarAccount(account.id);

      expect(ctx.oauth.refreshedWith?.config.tokenUrl).toBe('https://oauth2.googleapis.com/token');
      expect(ctx.oauth.refreshedWith?.config.clientId).toBe('google-client-abc');
      expect(ctx.oauth.refreshedWith?.config.provider).toBe('Google');
      expect(await ctx.secrets.get(calendarTokenKey(account.id))).toBe('refreshed-google-token');
    });
  });

  // ── ADR-021: ADO Harvest-connection-GUID auto-learn ─────────────────────
  describe('learnHarvestGuids (ADR-021)', () => {
    const GUID = '11111111-2222-3333-4444-555555555555';

    async function activateHarvest(ctx2: ReturnType<typeof make>, entries: unknown[]) {
      ctx2.transport.on('GET', '/project_assignments', HARVEST_ASSIGNMENTS);
      ctx2.transport.on('GET', '/time_entries', { time_entries: entries });
      await ctx2.manager.saveHarvest('123456', 'pat-token');
    }

    it('learns and caches the GUID from an existing Harvest entry created by ADO\'s widget', async () => {
      await ctx.manager.saveAdo({ label: 'Agile Bridge', orgUrl: 'https://dev.azure.com/agile-bridge', enabled: false });
      await activateHarvest(ctx, [
        {
          id: 1,
          spent_date: '2026-08-01',
          hours: 1,
          notes: null,
          project: { id: 1001, name: 'LetsDrive' },
          task: { id: 10, name: 'Development' },
          is_running: false,
          external_reference: {
            id: `AzureDevOps_${GUID}_UserStory_10`,
            group_id: 'AzureDevOpsWorkItem',
            permalink: 'https://dev.azure.com/agile-bridge/_workitems/edit/10',
            service: 'dev.azure.com',
          },
        },
      ]);

      const [conn] = await ctx.manager.listAdo();
      expect(conn!.harvestGuid).toBe(GUID);
      expect(await ctx.manager.adoGuid(conn!.id)).toBe(GUID);
    });

    it('does not upsert when the entry\'s permalink host does not match any connection org', async () => {
      await ctx.manager.saveAdo({ label: 'Agile Bridge', orgUrl: 'https://dev.azure.com/agile-bridge', enabled: false });
      await activateHarvest(ctx, [
        {
          id: 1,
          spent_date: '2026-08-01',
          hours: 1,
          notes: null,
          project: { id: 1001, name: 'LetsDrive' },
          task: { id: 10, name: 'Development' },
          is_running: false,
          external_reference: {
            id: `AzureDevOps_${GUID}_UserStory_10`,
            group_id: 'AzureDevOpsWorkItem',
            permalink: 'https://dev.azure.com/some-other-org/_workitems/edit/10',
            service: 'dev.azure.com',
          },
        },
      ]);

      const [conn] = await ctx.manager.listAdo();
      expect(conn!.harvestGuid).toBeUndefined();
      expect(await ctx.manager.adoGuid(conn!.id)).toBeUndefined();
    });

    it('a legacy (no-guid) external-reference id is ignored', async () => {
      await ctx.manager.saveAdo({ label: 'Agile Bridge', orgUrl: 'https://dev.azure.com/agile-bridge', enabled: false });
      await activateHarvest(ctx, [
        {
          id: 1,
          spent_date: '2026-08-01',
          hours: 1,
          notes: null,
          project: { id: 1001, name: 'LetsDrive' },
          task: { id: 10, name: 'Development' },
          is_running: false,
          external_reference: {
            id: 'AzureDevOps_UserStory_10',
            group_id: 'AzureDevOpsWorkItem',
            permalink: 'https://dev.azure.com/agile-bridge/_workitems/edit/10',
            service: 'dev.azure.com',
          },
        },
      ]);

      const [conn] = await ctx.manager.listAdo();
      expect(conn!.harvestGuid).toBeUndefined();
    });

    it('is idempotent: a second reconfigure with the same learned GUID does not change it', async () => {
      await ctx.manager.saveAdo({ label: 'Agile Bridge', orgUrl: 'https://dev.azure.com/agile-bridge', enabled: false });
      const entries = [
        {
          id: 1,
          spent_date: '2026-08-01',
          hours: 1,
          notes: null,
          project: { id: 1001, name: 'LetsDrive' },
          task: { id: 10, name: 'Development' },
          is_running: false,
          external_reference: {
            id: `AzureDevOps_${GUID}_UserStory_10`,
            group_id: 'AzureDevOpsWorkItem',
            permalink: 'https://dev.azure.com/agile-bridge/_workitems/edit/10',
            service: 'dev.azure.com',
          },
        },
      ];
      await activateHarvest(ctx, entries);
      const [conn] = await ctx.manager.listAdo();
      expect(conn!.harvestGuid).toBe(GUID);

      await ctx.manager.learnHarvestGuids();
      const [connAgain] = await ctx.manager.listAdo();
      expect(connAgain!.harvestGuid).toBe(GUID);
    });

    it('never throws even if Harvest is unconfigured', async () => {
      await expect(ctx.manager.learnHarvestGuids()).resolves.toBeUndefined();
    });
  });
});
