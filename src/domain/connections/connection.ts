import type { Id } from '@domain/common/types';

/**
 * A configured Azure DevOps organization connection. Non-secret metadata only —
 * the PAT lives in the {@link ISecretStore} keyed by {@link adoPatKey}.
 */
export interface AdoConnection {
  readonly id: Id;
  readonly label: string;
  /** Organization URL, e.g. `https://dev.azure.com/agile-bridge`. */
  readonly orgUrl: string;
  /** Optional iteration filter, e.g. `LetsDrive\Sprint 12` (UNDER match). */
  readonly iterationPath?: string;
  readonly enabled: boolean;
}

/** Secret-store key for the Harvest personal access token. */
export const HARVEST_TOKEN_KEY = 'harvest.token';

/** Secret-store key for a given ADO connection's PAT. */
export function adoPatKey(connectionId: Id): string {
  return `ado.pat.${connectionId}`;
}
