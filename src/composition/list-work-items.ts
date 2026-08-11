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
  readonly warn?: (message: string, label: string, error: unknown) => void;
}

/**
 * Container's `listWorkItems` facade, extracted for unit-testability. Demo mode
 * (no live `ado`) short-circuits to `demoWorkItems`, ignoring `wiql`. Otherwise
 * fans out over every enabled ADO connection, best-effort (a failing connection
 * is swallowed and contributes no items rather than failing the whole call).
 */
export async function fanOutWorkItems(params: FanOutWorkItemsParams): Promise<WorkItem[]> {
  const { ado, listEnabledAdoConnections, demoWorkItems, wiql, warn = (m, l, e) => console.warn(m, l, e) } = params;
  if (!ado) return demoWorkItems as WorkItem[];
  const enabled = await listEnabledAdoConnections();
  const batches = await Promise.all(
    enabled.map(async (conn) => {
      try {
        return wiql
          ? await ado.queryWorkItems(conn.id, wiql)
          : await ado.listAssignedWorkItems(conn.id, { iterationPath: conn.iterationPath });
      } catch (e) {
        warn('[ado] listWorkItems failed', conn.label, e);
        return [] as WorkItem[];
      }
    }),
  );
  return batches.flat();
}
