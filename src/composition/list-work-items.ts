import type { IAzureDevOpsClient } from '@domain/ports';
import type { AdoConnection } from '@domain/connections/connection';
import type { WorkItem } from '@domain/work-items/work-item';

export interface FanOutWorkItemsParams {
  /** Live ADO client, or `undefined` in demo mode. */
  readonly ado: IAzureDevOpsClient | undefined;
  readonly listEnabledAdoConnections: () => Promise<readonly AdoConnection[]>;
  readonly demoWorkItems: readonly WorkItem[];
  /** With a saved query, runs it verbatim; without, lists items assigned to me. */
  readonly wiql?: string;
  /** Pull in the parent story of any orphaned task (ADR-030). Default true. */
  readonly fetchParents?: boolean;
  readonly warn?: (message: string, label: string, error: unknown) => void;
}

/**
 * Types whose missing parent we bother fetching. Deliberately just Task: a Task
 * with no visible User Story reads as noise, whereas Stories/Features hanging
 * off an unfetched ancestor are handled by section grouping instead of another
 * round-trip (ADR-030).
 */
const PARENT_FETCH_TYPES = ['task'];

/**
 * Container's `listWorkItems` facade, extracted for unit-testability. Demo mode
 * (no live `ado`) short-circuits to `demoWorkItems`, ignoring `wiql`. Otherwise
 * fans out over every enabled ADO connection, best-effort (a failing connection
 * is swallowed and contributes no items rather than failing the whole call).
 */
export async function fanOutWorkItems(params: FanOutWorkItemsParams): Promise<WorkItem[]> {
  const {
    ado,
    listEnabledAdoConnections,
    demoWorkItems,
    wiql,
    fetchParents = true,
    warn = (m, l, e) => console.warn(m, l, e),
  } = params;
  if (!ado) return demoWorkItems as WorkItem[];
  const enabled = await listEnabledAdoConnections();
  const batches = await Promise.all(
    enabled.map(async (conn) => {
      let items: WorkItem[];
      try {
        items = wiql
          ? await ado.queryWorkItems(conn.id, wiql)
          : await ado.listAssignedWorkItems(conn.id, { iterationPath: conn.iterationPath });
      } catch (e) {
        warn('[ado] listWorkItems failed', conn.label, e);
        return [] as WorkItem[];
      }
      if (!fetchParents) return items;
      try {
        return items.concat(await fetchMissingParents(ado, conn.id, items));
      } catch (e) {
        // A failed parent lookup costs us nesting, not tickets.
        warn('[ado] parent work item fetch failed', conn.label, e);
        return items;
      }
    }),
  );
  return dedupe(batches.flat());
}

/**
 * One extra request, one level up: the parent of every Task whose story wasn't
 * already returned. Fetched stories never trigger a further Feature lookup.
 */
async function fetchMissingParents(
  ado: IAzureDevOpsClient,
  connectionId: string,
  items: readonly WorkItem[],
): Promise<WorkItem[]> {
  const present = new Set(items.map((i) => i.id));
  const missing = new Set<number>();
  for (const item of items) {
    if (item.parentId === undefined || present.has(item.parentId)) continue;
    if (PARENT_FETCH_TYPES.includes(item.workItemType.trim().toLowerCase())) missing.add(item.parentId);
  }
  if (missing.size === 0) return [];
  return ado.getWorkItems(connectionId, [...missing]);
}

/** Same ticket from two connections stays distinct; the same one twice does not. */
function dedupe(items: readonly WorkItem[]): WorkItem[] {
  const seen = new Set<string>();
  const out: WorkItem[] = [];
  for (const item of items) {
    const key = `${item.connectionId}:${item.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}
