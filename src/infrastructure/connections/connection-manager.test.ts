import { describe, it, expect, beforeEach } from 'vitest';
import { ConnectionManager } from './connection-manager';
import { createLocalRepositories } from '@infrastructure/persistence/local-repositories';
import { MemoryStorage } from '@infrastructure/persistence/local-store';
import { LocalSecretStore } from '@infrastructure/secrets/local-secret-store';
import { FakeTransport } from '@test/fake-transport';
import { HARVEST_TOKEN_KEY, adoPatKey, calendarTokenKey } from '@domain/connections/connection';
import type { IOAuthService, OAuthConfig, TokenSet } from '@domain/ports';

class FakeOAuthService implements IOAuthService {
  authorized?: OAuthConfig;
  tokens: TokenSet = { accessToken: 'graph-access-token', refreshToken: 'graph-refresh-token', expiresAt: Date.now() + 3600_000 };
  async authorize(config: OAuthConfig): Promise<TokenSet> {
    this.authorized = config;
    return this.tokens;
  }
  async refresh(): Promise<TokenSet> {
    return this.tokens;
  }
}

function make(transport = new FakeTransport()) {
  const storage = new MemoryStorage();
  const repos = createLocalRepositories(storage);
  const secrets = new LocalSecretStore(storage);
  const oauth = new FakeOAuthService();
  let n = 0;
  const manager = new ConnectionManager({
    settings: repos.settings,
    adoConnections: repos.adoConnections,
    calendarAccounts: repos.calendarAccounts,
    secrets,
    transport,
    oauth,
    newId: () => `conn-${++n}`,
  });
  return { manager, repos, secrets, transport, oauth };
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
});
