import { describe, expect, it } from 'vitest';
import { SCHEMA_V1 } from '@infrastructure/persistence/sql/schema';

const createTableStatements = SCHEMA_V1.filter((s) => s.trim().toUpperCase().startsWith('CREATE TABLE'));

const EXPECTED_TABLES = [
  'time_interval',
  'mapping_rule',
  'mapping_condition',
  'quick_template',
  'calendar_account',
  'meeting',
  'note',
  'note_status',
  'ado_connection',
  'settings',
];

describe('SCHEMA_V1', () => {
  it('has exactly 10 CREATE TABLE statements', () => {
    expect(createTableStatements).toHaveLength(10);
  });

  it('creates exactly the expected 10 tables', () => {
    const names = createTableStatements.map((s) => {
      const match = /CREATE TABLE IF NOT EXISTS (\w+)/i.exec(s);
      if (!match) throw new Error(`could not parse table name from: ${s}`);
      return match[1];
    });
    expect(names.sort()).toEqual([...EXPECTED_TABLES].sort());
  });

  it('every CREATE TABLE statement uses IF NOT EXISTS', () => {
    for (const s of createTableStatements) {
      expect(s).toMatch(/CREATE TABLE IF NOT EXISTS/i);
    }
  });

  it('every CREATE INDEX statement uses IF NOT EXISTS', () => {
    const indexStatements = SCHEMA_V1.filter((s) => s.trim().toUpperCase().startsWith('CREATE INDEX'));
    expect(indexStatements.length).toBeGreaterThan(0);
    for (const s of indexStatements) {
      expect(s).toMatch(/CREATE INDEX IF NOT EXISTS/i);
    }
  });

  it('time_interval has synced_hours', () => {
    const stmt = createTableStatements.find((s) => s.includes('time_interval ('));
    expect(stmt).toContain('synced_hours');
  });

  it('meeting has calendar_name', () => {
    const stmt = createTableStatements.find((s) => s.includes('meeting ('));
    expect(stmt).toContain('calendar_name');
  });

  it('ado_connection has org_url + iteration_path and NOT pat_ref', () => {
    const stmt = createTableStatements.find((s) => s.includes('ado_connection ('));
    expect(stmt).toContain('org_url');
    expect(stmt).toContain('iteration_path');
    expect(stmt).not.toContain('pat_ref');
  });

  it('calendar_account lacks token_ref', () => {
    const stmt = createTableStatements.find((s) => s.includes('calendar_account ('));
    expect(stmt).not.toContain('token_ref');
  });

  it('note lacks status_id', () => {
    const stmt = createTableStatements.find((s) => s.includes('note (') && !s.includes('note_status'));
    expect(stmt).not.toContain('status_id');
  });

  it('settings has hg1_scheme + embed_metadata', () => {
    const stmt = createTableStatements.find((s) => s.includes('settings ('));
    expect(stmt).toContain('hg1_scheme');
    expect(stmt).toContain('embed_metadata');
  });
});
