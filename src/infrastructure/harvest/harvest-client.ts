import type { IsoDate } from '@domain/common/types';
import type {
  CreateTimeEntry,
  ExternalReference,
  HarvestProject,
  HarvestTimeEntry,
  UpdateTimeEntry,
} from '@domain/harvest/harvest-types';
import type { HttpRequest, IHarvestClient, IHttpTransport } from '@domain/ports';

export interface HarvestConfig {
  readonly accountId: string;
  readonly token: string;
  readonly userAgent?: string;
  readonly baseUrl?: string;
}

// ── snake_case wire DTOs ──────────────────────────────────────────────────
interface RefDto {
  id: string;
  group_id?: string;
  permalink?: string;
  service?: string;
}
interface EntryDto {
  id: number;
  spent_date: string;
  hours: number;
  notes: string | null;
  project: { id: number; name: string };
  task: { id: number; name: string };
  is_running: boolean;
  external_reference: RefDto | null;
}
interface AssignmentDto {
  project: { id: number; name: string; code?: string };
  client?: { name?: string };
  task_assignments: { task: { id: number; name: string } }[];
}

const HARVEST_BASE = 'https://api.harvestapp.com/v2';

function mapRef(dto: RefDto | null): ExternalReference | undefined {
  if (!dto) return undefined;
  return {
    id: dto.id,
    groupId: dto.group_id ?? '',
    permalink: dto.permalink ?? '',
    service: dto.service ?? '',
  };
}

function mapEntry(dto: EntryDto): HarvestTimeEntry {
  return {
    id: dto.id,
    spentDate: dto.spent_date,
    hours: dto.hours,
    notes: dto.notes ?? '',
    projectId: dto.project.id,
    projectName: dto.project.name,
    taskId: dto.task.id,
    taskName: dto.task.name,
    isRunning: dto.is_running,
    externalReference: mapRef(dto.external_reference),
  };
}

function refToWire(ref: ExternalReference): Record<string, string> {
  return { id: ref.id, group_id: ref.groupId, permalink: ref.permalink, service: ref.service };
}

/** Harvest API v2 client. All network I/O flows through IHttpTransport (CORS-free). */
export class HarvestClient implements IHarvestClient {
  private readonly base: string;

  constructor(
    private readonly http: IHttpTransport,
    private readonly config: HarvestConfig,
  ) {
    this.base = config.baseUrl ?? HARVEST_BASE;
  }

  async getProjectAssignments(): Promise<HarvestProject[]> {
    const body = await this.get('/users/me/project_assignments?per_page=100');
    const dto = JSON.parse(body) as { project_assignments: AssignmentDto[] };
    return dto.project_assignments.map((a) => ({
      id: a.project.id,
      name: a.project.name,
      code: a.project.code,
      clientName: a.client?.name,
      tasks: a.task_assignments.map((t) => ({ id: t.task.id, name: t.task.name })),
    }));
  }

  async getTimeEntries(from: IsoDate, to: IsoDate): Promise<HarvestTimeEntry[]> {
    const body = await this.get(`/time_entries?from=${from}&to=${to}&per_page=100`);
    const dto = JSON.parse(body) as { time_entries: EntryDto[] };
    return dto.time_entries.map(mapEntry);
  }

  async createTimeEntry(entry: CreateTimeEntry): Promise<HarvestTimeEntry> {
    const wire: Record<string, unknown> = {
      project_id: entry.projectId,
      task_id: entry.taskId,
      spent_date: entry.spentDate,
    };
    if (entry.hours !== undefined) wire.hours = entry.hours;
    if (entry.notes !== undefined) wire.notes = entry.notes;
    if (entry.externalReference) wire.external_reference = refToWire(entry.externalReference);
    return mapEntry(JSON.parse(await this.send('POST', '/time_entries', wire)) as EntryDto);
  }

  async updateTimeEntry(id: number, patch: UpdateTimeEntry): Promise<HarvestTimeEntry> {
    const wire: Record<string, unknown> = {};
    if (patch.hours !== undefined) wire.hours = patch.hours;
    if (patch.notes !== undefined) wire.notes = patch.notes;
    if (patch.projectId !== undefined) wire.project_id = patch.projectId;
    if (patch.taskId !== undefined) wire.task_id = patch.taskId;
    if (patch.externalReference) wire.external_reference = refToWire(patch.externalReference);
    return mapEntry(JSON.parse(await this.send('PATCH', `/time_entries/${id}`, wire)) as EntryDto);
  }

  async deleteTimeEntry(id: number): Promise<void> {
    await this.send('DELETE', `/time_entries/${id}`);
  }

  async stopTimer(id: number): Promise<HarvestTimeEntry> {
    return mapEntry(JSON.parse(await this.send('PATCH', `/time_entries/${id}/stop`)) as EntryDto);
  }

  async restartTimer(id: number): Promise<HarvestTimeEntry> {
    return mapEntry(JSON.parse(await this.send('PATCH', `/time_entries/${id}/restart`)) as EntryDto);
  }

  // ── transport helpers ───────────────────────────────────────────────────
  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.config.token}`,
      'Harvest-Account-Id': this.config.accountId,
      'User-Agent': this.config.userAgent ?? 'Hourglass',
      'Content-Type': 'application/json',
    };
  }

  private async get(path: string): Promise<string> {
    return this.send('GET', path);
  }

  private async send(
    method: HttpRequest['method'],
    path: string,
    body?: unknown,
  ): Promise<string> {
    const res = await this.http.send({
      method,
      url: `${this.base}${path}`,
      headers: this.headers(),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`Harvest ${method} ${path} failed (${res.status}): ${res.body}`);
    }
    return res.body;
  }
}
