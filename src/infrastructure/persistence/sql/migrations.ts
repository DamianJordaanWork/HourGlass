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
];
