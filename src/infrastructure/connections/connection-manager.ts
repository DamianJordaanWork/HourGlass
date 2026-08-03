import type { Id } from '@domain/common/types';
import type {
  IAdoConnectionRepository,
  IAzureDevOpsClient,
  IHarvestClient,
  IHttpTransport,
  ISecretStore,
  ISettingsRepository,
} from '@domain/ports';
import type { HarvestProject } from '@domain/harvest/harvest-types';
import type { AdoConnection } from '@domain/connections/connection';
import { HARVEST_TOKEN_KEY, adoPatKey } from '@domain/connections/connection';
import { HarvestClient } from '@infrastructure/harvest/harvest-client';
import {
  AzureDevOpsClient,
  type AdoConnectionResolver,
} from '@infrastructure/ado/ado-client';

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

interface Deps {
  readonly settings: ISettingsRepository;
  readonly adoConnections: IAdoConnectionRepository;
  readonly secrets: ISecretStore;
  readonly transport: IHttpTransport;
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

  constructor(private readonly deps: Deps) {}

  // ── live client accessors (passed to TrackingService as providers) ────────
  harvest(): IHarvestClient | undefined {
    return this.liveHarvest;
  }
  ado(): IAzureDevOpsClient | undefined {
    return this.liveAdo;
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

  // ── helpers ────────────────────────────────────────────────────────────
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
