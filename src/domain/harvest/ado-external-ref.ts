import type { ExternalReference } from '@domain/harvest/harvest-types';
import type { WorkItemRef } from '@domain/time/time-interval';

/** Harvest's external-reference "groupId" for ADO's built-in work-item widget. */
export const ADO_REF_GROUP_ID = 'AzureDevOpsWorkItem';
/** Harvest's external-reference "service" for ADO's built-in work-item widget. */
export const ADO_REF_SERVICE = 'dev.azure.com';

const GUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * Harvest native external reference for an ADO work item. When `connectionGuid`
 * is supplied (learned from an existing Harvest entry created by ADO's official
 * widget — see ADR-021), it's spliced into the id so ADO's widget binds; without
 * it the id is byte-for-byte identical to the pre-ADR-021 format.
 */
export function buildAdoExternalReference(ref: WorkItemRef, connectionGuid?: string): ExternalReference {
  const type = ref.workItemType.replace(/\s+/g, '');
  const guidSegment = connectionGuid ? `${connectionGuid}_` : '';
  return {
    id: `AzureDevOps_${guidSegment}${type}_${ref.workItemId}`,
    groupId: ADO_REF_GROUP_ID,
    permalink: ref.url,
    service: ADO_REF_SERVICE,
  };
}

/**
 * Parse the connection GUID out of an existing external-reference id (as created
 * by ADO's official Harvest widget). Returns `undefined` for legacy
 * (no-guid) ids or ids from another integration entirely.
 */
export function parseAdoConnectionGuid(id: string): string | undefined {
  const segments = id.split('_');
  if (segments[0] !== 'AzureDevOps') return undefined;
  const candidate = segments[1];
  if (candidate !== undefined && GUID_RE.test(candidate)) return candidate;
  return undefined;
}
