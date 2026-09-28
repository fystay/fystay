/**
 * Production migration history check, run by
 * .github/workflows/db-migrate-production.yml before and after
 * `prisma migrate deploy`.
 *
 * `prisma migrate status` isn't enough on its own. Verified against a copy of
 * production's recovered history (see docs/production-database-migrations.md):
 * it reports "up to date" (exit 0) for a migration edited after it was
 * applied, and for a migration applied in the database but missing from the
 * repository - and it exits 1 whenever anything is merely pending, which is
 * the normal state before a deploy. This compares the database's
 * _prisma_migrations rows with the commit's migration files directly.
 *
 * Pure: no database or filesystem access, so every rule is unit-tested.
 * Self-contained (no "@/" imports) because scripts/db/ runs it through tsx.
 */

/** One row of _prisma_migrations. */
export type MigrationHistoryRow = {
  migrationName: string;
  checksum: string;
  startedAt: Date;
  finishedAt: Date | null;
  rolledBackAt: Date | null;
};

/** One prisma/migrations/<name>/migration.sql in the commit being deployed; checksum is its SHA-256, as Prisma computes it. */
export type LocalMigration = {
  name: string;
  checksum: string;
};

/**
 * Migrations applied in production whose directory was deliberately removed
 * from the repository - accepted history, matched by name *and* checksum.
 *
 * 20260924190352: applied to production by a preview build before its file
 * was edited and renamed to 20260924191043 (the incident that led to this
 * workflow). The recovery on 2026-09-28 kept its row as a historical record
 * rather than deleting it; 20260924191043 now owns those objects.
 */
export const RETIRED_MIGRATIONS: readonly LocalMigration[] = Object.freeze([
  {
    name: "20260924190352_add_hotel_affiliate_system",
    checksum: "dcff113691459f76e69c05976a8e3600901cc3a1664d34d9cf7fada5fc894533",
  },
]);

export type HistoryReport = {
  /** Anything that makes it unsafe to deploy. Empty means safe. */
  problems: string[];
  /** Local migrations not yet applied, oldest first - what `migrate deploy` would run. */
  pending: string[];
  appliedCount: number;
  /** Accepted RETIRED_MIGRATIONS rows present in the database. */
  retired: string[];
  /** Rolled-back rows that were later re-applied (a resolved past failure). */
  resolvedFailures: string[];
};

/** <14-digit UTC timestamp>_<name> - what `prisma migrate dev` creates. */
export const MIGRATION_NAME = /^\d{14}_[A-Za-z0-9_]+$/;

export function evaluateMigrationHistory(
  rows: readonly MigrationHistoryRow[],
  local: readonly LocalMigration[],
  retiredMigrations: readonly LocalMigration[] = RETIRED_MIGRATIONS,
): HistoryReport {
  const problems: string[] = [];
  const localByName = new Map(local.map((migration) => [migration.name, migration]));

  // --- the commit's own migrations
  const seenTimestamps = new Map<string, string>();
  for (const migration of local) {
    if (!MIGRATION_NAME.test(migration.name)) {
      problems.push(`Migration directory "${migration.name}" isn't named <14-digit timestamp>_<name>.`);
      continue;
    }
    const timestamp = migration.name.slice(0, 14);
    const clash = seenTimestamps.get(timestamp);
    if (clash) {
      problems.push(`Migrations "${clash}" and "${migration.name}" share a timestamp, so their order is ambiguous.`);
    }
    seenTimestamps.set(timestamp, migration.name);
  }

  // --- failed or interrupted migrations: never repaired automatically
  for (const row of rows) {
    if (row.finishedAt === null && row.rolledBackAt === null) {
      problems.push(
        `"${row.migrationName}" failed or was interrupted and is unresolved. This workflow never runs ` +
          `\`prisma migrate resolve\` - investigate and resolve it manually first.`,
      );
    }
  }

  // --- applied migrations must be exactly what this commit contains
  const applied = rows.filter((row) => row.finishedAt !== null && row.rolledBackAt === null);
  const appliedNames = new Set<string>();
  const retired: string[] = [];

  for (const row of applied) {
    if (appliedNames.has(row.migrationName)) {
      problems.push(`"${row.migrationName}" is recorded as applied more than once.`);
      continue;
    }
    appliedNames.add(row.migrationName);

    const file = localByName.get(row.migrationName);
    if (file) {
      if (file.checksum !== row.checksum) {
        problems.push(
          `"${row.migrationName}" was modified after it was applied: the database recorded checksum ` +
            `${row.checksum.slice(0, 12)}…, this commit's file is ${file.checksum.slice(0, 12)}…. ` +
            `Applied migrations must never be edited - make the change in a new migration.`,
        );
      }
      continue;
    }

    const acceptedRetirement = retiredMigrations.find(
      (retiredMigration) => retiredMigration.name === row.migrationName && retiredMigration.checksum === row.checksum,
    );
    if (acceptedRetirement) {
      retired.push(row.migrationName);
    } else {
      problems.push(
        `"${row.migrationName}" is applied in the database but missing from this commit's prisma/migrations. ` +
          `Either this is the wrong commit, or a migration was deleted or renamed after being applied.`,
      );
    }
  }

  // --- rolled-back rows must have been dealt with
  const resolvedFailures: string[] = [];
  for (const row of rows) {
    if (row.rolledBackAt === null) continue;
    if (appliedNames.has(row.migrationName)) {
      resolvedFailures.push(row.migrationName);
    } else if (!localByName.has(row.migrationName)) {
      problems.push(
        `"${row.migrationName}" was rolled back and is neither re-applied nor present in this commit.`,
      );
    }
    // Otherwise it is pending below, and `migrate deploy` will re-apply it.
  }

  // --- pending migrations must come after everything already applied
  const pending = local
    .map((migration) => migration.name)
    .filter((name) => !appliedNames.has(name))
    .sort();
  const latestApplied = [...appliedNames].sort().at(-1);
  if (latestApplied) {
    for (const name of pending) {
      if (name < latestApplied) {
        problems.push(
          `"${name}" is pending but older than "${latestApplied}", which is already applied. ` +
            `Deploying it out of order could conflict - it needs a new, later timestamp.`,
        );
      }
    }
  }

  return { problems, pending, appliedCount: appliedNames.size, retired, resolvedFailures };
}
