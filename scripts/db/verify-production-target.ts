/**
 * Step 1 of the production migration workflow: prove PROD_DIRECT_URL is the
 * production database, read-only, before anything else touches it. Exits 1
 * on any doubt. See docs/production-database-migrations.md.
 *
 *   PROD_DIRECT_URL=... npx tsx scripts/db/verify-production-target.ts
 */
import {
  connectionStringProblems,
  databaseFactsProblems,
  EXPECTED_PRODUCTION_DATABASE,
  valuesToMask,
  type DatabaseFacts,
} from "../../src/lib/migrationSafety/productionTarget";
import { RETIRED_MIGRATIONS } from "../../src/lib/migrationSafety/history";
import { describeError, fail, productionUrlFromEnv, withReadOnlyTransaction } from "./productionDatabase";

async function main() {
  const url = productionUrlFromEnv();

  // Before anything can print: mask password fragments for the rest of the job.
  for (const value of valuesToMask(url)) console.log(`::add-mask::${value}`);

  const urlProblems = connectionStringProblems(url);
  if (urlProblems.length > 0 || !url) fail(urlProblems);
  console.log(`Connection string names project ${EXPECTED_PRODUCTION_DATABASE.projectRef} on a migration-capable port.`);

  let facts: DatabaseFacts;
  try {
    facts = await withReadOnlyTransaction(url, async (tx) => {
      const [server] = await tx.$queryRaw<{ database: string; version: number }[]>`
        SELECT current_database() AS database, current_setting('server_version_num')::int AS version`;
      const [supabase] = await tx.$queryRaw<{ authenticator: boolean; auth_schema: boolean }[]>`
        SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticator') AS authenticator,
               EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'auth') AS auth_schema`;
      const trigger = await tx.$queryRaw<{ enabled: string }[]>`
        SELECT evtenabled::text AS enabled FROM pg_event_trigger
        WHERE evtname = ${EXPECTED_PRODUCTION_DATABASE.eventTrigger}`;
      const [migrationsTable] = await tx.$queryRaw<{ present: boolean }[]>`
        SELECT to_regclass('public._prisma_migrations') IS NOT NULL AS present`;
      const retired = migrationsTable.present
        ? await tx.$queryRaw<{ checksum: string }[]>`
            SELECT checksum FROM public._prisma_migrations WHERE migration_name = ${RETIRED_MIGRATIONS[0].name}`
        : [];
      return {
        database: server.database,
        serverVersionNum: server.version,
        hasSupabaseAuthenticatorRole: supabase.authenticator,
        hasSupabaseAuthSchema: supabase.auth_schema,
        eventTriggerEnabled: trigger[0]?.enabled ?? null,
        hasMigrationsTable: migrationsTable.present,
        retiredMigrationChecksum: retired[0]?.checksum ?? null,
      };
    });
  } catch (error) {
    fail([`Couldn't read the production database's identity: ${describeError(error)}`]);
  }

  console.log(
    [
      `database:            ${facts.database}`,
      `PostgreSQL:          ${Math.floor(facts.serverVersionNum / 10000)} (${facts.serverVersionNum})`,
      `Supabase markers:    authenticator role ${facts.hasSupabaseAuthenticatorRole ? "present" : "MISSING"}, auth schema ${facts.hasSupabaseAuthSchema ? "present" : "MISSING"}`,
      `${EXPECTED_PRODUCTION_DATABASE.eventTrigger}:          ${facts.eventTriggerEnabled === null ? "MISSING" : `present (evtenabled=${facts.eventTriggerEnabled})`}`,
      `_prisma_migrations:  ${facts.hasMigrationsTable ? "present" : "MISSING"}`,
      `history fingerprint: ${facts.retiredMigrationChecksum === RETIRED_MIGRATIONS[0].checksum ? "present" : "MISSING"}`,
    ].join("\n"),
  );

  const problems = databaseFactsProblems(facts);
  if (problems.length > 0) fail(problems);
  console.log("Verified: this is the production database.");
}

main().catch((error) => fail([describeError(error)]));
