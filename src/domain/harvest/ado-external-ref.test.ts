import { describe, expect, it } from 'vitest';
import {
  ADO_REF_GROUP_ID,
  ADO_REF_SERVICE,
  buildAdoExternalReference,
  parseAdoConnectionGuid,
} from '@domain/harvest/ado-external-ref';
import type { WorkItemRef } from '@domain/time/time-interval';

const ref: WorkItemRef = {
  connectionId: 'conn-1',
  workItemId: 4821,
  workItemType: 'User Story',
  url: 'https://dev.azure.com/agile-bridge/_workitems/edit/4821',
};

const GUID = '11111111-2222-3333-4444-555555555555';

describe('buildAdoExternalReference', () => {
  it('without a guid, matches the pre-ADR-021 format (spaces stripped from type)', () => {
    const result = buildAdoExternalReference(ref);
    expect(result.id).toBe('AzureDevOps_UserStory_4821');
    expect(result.groupId).toBe(ADO_REF_GROUP_ID);
    expect(result.service).toBe(ADO_REF_SERVICE);
    expect(result.permalink).toBe(ref.url);
  });

  it('with a guid, splices it into the id', () => {
    const result = buildAdoExternalReference(ref, GUID);
    expect(result.id).toBe(`AzureDevOps_${GUID}_UserStory_4821`);
    expect(result.groupId).toBe(ADO_REF_GROUP_ID);
    expect(result.service).toBe(ADO_REF_SERVICE);
    expect(result.permalink).toBe(ref.url);
  });
});

describe('parseAdoConnectionGuid', () => {
  it('parses the guid from a guid-bearing id', () => {
    const id = buildAdoExternalReference(ref, GUID).id;
    expect(parseAdoConnectionGuid(id)).toBe(GUID);
  });

  it('returns undefined for a legacy (no-guid) id', () => {
    expect(parseAdoConnectionGuid('AzureDevOps_UserStory_4821')).toBeUndefined();
  });

  it('returns undefined for a non-ADO id', () => {
    expect(parseAdoConnectionGuid('Trello_Card_123')).toBeUndefined();
  });

  it('round-trips: parse(build(ref, guid).id) === guid', () => {
    const built = buildAdoExternalReference(ref, GUID);
    expect(parseAdoConnectionGuid(built.id)).toBe(GUID);
  });
});
