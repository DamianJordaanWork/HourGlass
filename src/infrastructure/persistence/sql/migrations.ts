import { SCHEMA_V1 } from '@infrastructure/persistence/sql/schema';

/** A single forward-only, versioned batch of DDL/DML statements. */
export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly statements: readonly string[];
}

/** Ordered migration set applied by {@link runMigrations}. Append-only. */
export const MIGRATIONS: readonly Migration[] = [
  { version: 1, name: 'schema_v1', statements: SCHEMA_V1 },
  { version: 2, name: 'settings_google_client_id', statements: ['ALTER TABLE settings ADD COLUMN google_client_id TEXT'] },
  { version: 3, name: 'ado_connection_harvest_guid', statements: ['ALTER TABLE ado_connection ADD COLUMN harvest_guid TEXT'] },
  {
    version: 4,
    name: 'work_item_sections_and_multi_ticket_intervals',
    statements: [
      // Full ticket list for an interval (JSON array, primary first). The legacy
      // singular `work_item_ref` stays populated with the primary — ADR-029.
      'ALTER TABLE time_interval ADD COLUMN work_item_refs TEXT',
      // NULL ⇒ the default (on), so existing rows keep working.
      'ALTER TABLE settings ADD COLUMN fetch_parent_work_items INTEGER',
      `CREATE TABLE IF NOT EXISTS work_item_section (
        id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        sort_order INTEGER NOT NULL,
        enabled INTEGER NOT NULL,
        default_collapsed INTEGER NOT NULL,
        nest_under_parent INTEGER NOT NULL,
        group_by_parent INTEGER NOT NULL,
        sort_by TEXT NOT NULL,
        sort_direction TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS work_item_section_condition (
        section_id TEXT NOT NULL REFERENCES work_item_section(id) ON DELETE CASCADE,
        seq INTEGER NOT NULL,
        field TEXT NOT NULL,
        operator TEXT NOT NULL,
        value TEXT NOT NULL,
        negate INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (section_id, seq)
      )`,
    ],
  },
];
