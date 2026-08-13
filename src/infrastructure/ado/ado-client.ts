import type { Id } from '@domain/common/types';
import type {
  IAzureDevOpsClient,
  IHttpTransport,
  ListWorkItemsOptions,
} from '@domain/ports';
import type { WorkItem } from '@domain/work-items/work-item';

export interface AdoConnectionConfig {
  /** e.g. `https://dev.azure.com/agile-bridge`. */
  readonly orgUrl: string;
  readonly pat: string;
}

/** Resolves a connection id → its org URL + PAT (from repo/secret store). */
export type AdoConnectionResolver = (connectionId: Id) => Promise<AdoConnectionConfig | null>;

const API = 'api-version=7.0';
const FIELDS = [
  'System.Id',
  'System.Title',
  'System.WorkItemType',
  'System.State',
  'System.TeamProject',
  'System.IterationPath',
  'System.AreaPath',
  'System.AssignedTo',
  'System.Tags',
  'System.Parent',
];
/** ADO caps a work-item batch fetch at 200 ids. */
const BATCH_SIZE = 200;
const COMPLETED_WORK = 'Microsoft.VSTS.Scheduling.CompletedWork';

interface WiqlResult {
  workItems: { id: number }[];
}
interface WorkItemDto {
  id: number;
  fields: Record<string, unknown>;
}
interface BatchResult {
  value: WorkItemDto[];
}

function identityName(v: unknown): string | undefined {
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object' && 'displayName' in v) {
    return String((v as { displayName: unknown }).displayName);
  }
  return undefined;
}

function parseTags(v: unknown): string[] {
  if (typeof v !== 'string' || v.length === 0) return [];
  return v.split(';').map((t) => t.trim()).filter((t) => t.length > 0);
}

export class AzureDevOpsClient implements IAzureDevOpsClient {
  constructor(
    private readonly http: IHttpTransport,
    private readonly resolve: AdoConnectionResolver,
  ) {}

  async listAssignedWorkItems(connectionId: Id, options?: ListWorkItemsOptions): Promise<WorkItem[]> {
    const conn = await this.connection(connectionId);
    const clauses = ['[System.AssignedTo] = @Me'];
    if (!options?.includeCompleted) {
      clauses.push("[System.State] <> 'Closed'", "[System.State] <> 'Removed'", "[System.State] <> 'Done'");
    }
    if (options?.iterationPath) clauses.push(`[System.IterationPath] UNDER '${options.iterationPath.replace(/'/g, "''")}'`);
    if (options?.workItemTypes?.length) {
      const types = options.workItemTypes.map((t) => `'${t.replace(/'/g, "''")}'`).join(', ');
      clauses.push(`[System.WorkItemType] IN (${types})`);
    }
    const wiql = `SELECT [System.Id] FROM WorkItems WHERE ${clauses.join(' AND ')} ORDER BY [System.ChangedDate] DESC`;

    return this.runWiql(conn, connectionId, wiql);
  }

  /** Run a caller-supplied WIQL query verbatim (e.g. a saved template query). */
  async queryWorkItems(connectionId: Id, wiql: string): Promise<WorkItem[]> {
    const conn = await this.connection(connectionId);
    return this.runWiql(conn, connectionId, wiql);
  }

  /** Batch fetch by id — used to pull in parent stories for orphaned tasks. */
  async getWorkItems(connectionId: Id, ids: readonly number[]): Promise<WorkItem[]> {
    if (ids.length === 0) return [];
    const conn = await this.connection(connectionId);
    return this.fetchByIds(conn, connectionId, ids);
  }

  async getWorkItem(connectionId: Id, workItemId: number): Promise<WorkItem> {
    const conn = await this.connection(connectionId);
    const dto = JSON.parse(
      await this.send(conn, 'GET', `/_apis/wit/workitems/${workItemId}?fields=${FIELDS.join(',')}&${API}`),
    ) as WorkItemDto;
    return this.mapWorkItem(conn, connectionId, dto);
  }

  async syncCompletedWork(connectionId: Id, workItemId: number, deltaHours: number): Promise<void> {
    if (deltaHours === 0) return;
    const conn = await this.connection(connectionId);
    const current = JSON.parse(
      await this.send(conn, 'GET', `/_apis/wit/workitems/${workItemId}?fields=${COMPLETED_WORK}&${API}`),
    ) as WorkItemDto;
    const existing = Number(current.fields[COMPLETED_WORK] ?? 0) || 0;
    const next = Math.round((existing + deltaHours) * 100) / 100;
    await this.send(
      conn,
      'PATCH',
      `/_apis/wit/workitems/${workItemId}?${API}`,
      [{ op: 'add', path: `/fields/${COMPLETED_WORK}`, value: next }],
      'application/json-patch+json',
    );
  }

  // ── helpers ─────────────────────────────────────────────────────────────
  /** WIQL → ids → fixed-field batch fetch → map. Shared by assigned + saved-query paths. */
  private async runWiql(conn: AdoConnectionConfig, connectionId: Id, wiql: string): Promise<WorkItem[]> {
    const wiqlRes = JSON.parse(
      await this.send(conn, 'POST', `/_apis/wit/wiql?${API}`, { query: wiql }),
    ) as WiqlResult;
    const ids = wiqlRes.workItems.map((w) => w.id).slice(0, BATCH_SIZE);
    return this.fetchByIds(conn, connectionId, ids);
  }

  /** Field-limited batch fetch, chunked to ADO's 200-ids-per-request ceiling. */
  private async fetchByIds(
    conn: AdoConnectionConfig,
    connectionId: Id,
    ids: readonly number[],
  ): Promise<WorkItem[]> {
    if (ids.length === 0) return [];
    const chunks: number[][] = [];
    for (let i = 0; i < ids.length; i += BATCH_SIZE) chunks.push(ids.slice(i, i + BATCH_SIZE));
    const batches = await Promise.all(
      chunks.map(async (chunk) => {
        const batch = JSON.parse(
          await this.send(conn, 'GET', `/_apis/wit/workitems?ids=${chunk.join(',')}&fields=${FIELDS.join(',')}&${API}`),
        ) as BatchResult;
        return batch.value.map((dto) => this.mapWorkItem(conn, connectionId, dto));
      }),
    );
    return batches.flat();
  }

  private async connection(connectionId: Id): Promise<AdoConnectionConfig> {
    const conn = await this.resolve(connectionId);
    if (!conn) throw new Error(`Unknown ADO connection: ${connectionId}`);
    return conn;
  }

  private mapWorkItem(conn: AdoConnectionConfig, connectionId: Id, dto: WorkItemDto): WorkItem {
    const f = dto.fields;
    const project = String(f['System.TeamProject'] ?? '');
    return {
      id: dto.id,
      title: String(f['System.Title'] ?? ''),
      workItemType: String(f['System.WorkItemType'] ?? ''),
      state: String(f['System.State'] ?? ''),
      project,
      iterationPath: String(f['System.IterationPath'] ?? ''),
      areaPath: String(f['System.AreaPath'] ?? ''),
      assignedTo: identityName(f['System.AssignedTo']),
      tags: parseTags(f['System.Tags']),
      parentId: Number(f['System.Parent']) || undefined,
      connectionId,
      url: `${conn.orgUrl}/${encodeURIComponent(project)}/_workitems/edit/${dto.id}`,
    };
  }

  private async send(
    conn: AdoConnectionConfig,
    method: 'GET' | 'POST' | 'PATCH',
    path: string,
    body?: unknown,
    contentType = 'application/json',
  ): Promise<string> {
    const res = await this.http.send({
      method,
      url: `${conn.orgUrl}${path}`,
      headers: {
        Authorization: `Basic ${btoa(`:${conn.pat}`)}`,
        'Content-Type': contentType,
        Accept: 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`ADO ${method} ${path} failed (${res.status}): ${res.body}`);
    }
    return res.body;
  }
}
