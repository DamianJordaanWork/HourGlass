import type { ISqlDatabase } from '@infrastructure/persistence/sql/sql-database';
import { MIGRATIONS, type Migration } from '@infrastructure/persistence/sql/migrations';

/** Thrown when the supplied migration set is malformed (dupe/out-of-order versions). */
export class MigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MigrationError';
  }
}

interface AppliedRow {
  readonly version: number;
}

export interface MigrationRunResult {
  readonly applied: number[];
  readonly currentVersion: number;
}

const SCHEMA_MIGRATIONS_TABLE = `CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL
)`;

function assertOrdered(migrations: readonly Migration[]): readonly Migration[] {
  const sorted = [...migrations].sort((a, b) => a.version - b.version);
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i]!.version <= sorted[i - 1]!.version) {
      throw new MigrationError(
        `duplicate or non-increasing migration version: ${sorted[i - 1]!.version} -> ${sorted[i]!.version}`,
      );
    }
  }
  return sorted;
}

/**
 * Applies not-yet-applied migrations, in ascending version order, forward-only
 * and idempotent. Each migration runs in its own transaction: its statements
 * execute, then its version is recorded — both roll back together on failure.
 */
export async function runMigrations(
  db: ISqlDatabase,
  migrations: readonly Migration[] = MIGRATIONS,
  nowIso: () => string = () => new Date().toISOString(),
): Promise<MigrationRunResult> {
  const ordered = assertOrdered(migrations);

  await db.execute(SCHEMA_MIGRATIONS_TABLE);

  const appliedRows = await db.query<AppliedRow>('SELECT version FROM schema_migrations');
  const appliedVersions = new Set(appliedRows.map((r) => r.version));

  const applied: number[] = [];
  for (const migration of ordered) {
    if (appliedVersions.has(migration.version)) continue;

    await db.transaction(async (tx) => {
      for (const statement of migration.statements) {
        await tx.execute(statement);
      }
      await tx.execute('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)', [
        migration.version,
        migration.name,
        nowIso(),
      ]);
    });

    applied.push(migration.version);
    appliedVersions.add(migration.version);
  }

  const currentVersion = appliedVersions.size > 0 ? Math.max(...appliedVersions) : 0;
  return { applied, currentVersion };
}
