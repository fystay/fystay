/**
 * Proves PROD_DIRECT_URL is the production database before
 * .github/workflows/db-migrate-production.yml migrates anything.
 *
 * Two independent halves, both required:
 *  - the connection string names the production Supabase project (the same
 *    detection src/lib/databaseIdentity.ts uses to keep previews off it) and
 *    is a migration-capable session/direct connection;
 *  - the server it reaches looks like that project from the inside: the
 *    expected database, Postgres major version, Supabase's own roles and
 *    schemas, the project's ensure_rls event trigger, and a migration history
 *    that includes the production-only retired row.
 *
 * Pure (no network, no process.env), and never includes a credential in any
 * message. Self-contained relative imports, because scripts/db/ runs it via tsx.
 */
import { findProductionDatabaseVariables, PRODUCTION_SUPABASE_PROJECT_REF } from "../databaseIdentity";
import { RETIRED_MIGRATIONS } from "./history";

export const EXPECTED_PRODUCTION_DATABASE = Object.freeze({
  projectRef: PRODUCTION_SUPABASE_PROJECT_REF,
  database: "postgres",
  postgresMajor: 17,
  eventTrigger: "ensure_rls",
});

/** Session pooler and direct connections both listen here; 6543 is the transaction pooler. */
const MIGRATION_PORT = "5432";

export function connectionStringProblems(url: string | undefined): string[] {
  if (!url) return ["PROD_DIRECT_URL is empty - the production Environment's secret isn't configured."];

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return ["PROD_DIRECT_URL isn't a valid URL."];
  }

  const problems: string[] = [];
  if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
    problems.push("PROD_DIRECT_URL isn't a postgresql:// connection string.");
  }
  if (findProductionDatabaseVariables({ DIRECT_URL: url }).length === 0) {
    problems.push(
      `PROD_DIRECT_URL doesn't identify the production Supabase project (${PRODUCTION_SUPABASE_PROJECT_REF}) ` +
        `in its user name or host.`,
    );
  }
  if ((parsed.port || MIGRATION_PORT) !== MIGRATION_PORT) {
    problems.push(
      `PROD_DIRECT_URL uses port ${parsed.port}. Migrations need the session pooler or a direct connection ` +
        `(port ${MIGRATION_PORT}), not the transaction pooler.`,
    );
  }
  if (parsed.searchParams.get("pgbouncer") === "true") {
    problems.push("PROD_DIRECT_URL has pgbouncer=true - that's the pooled runtime URL, not a migration connection.");
  }
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (database !== EXPECTED_PRODUCTION_DATABASE.database) {
    problems.push(`PROD_DIRECT_URL names database "${database}", expected "${EXPECTED_PRODUCTION_DATABASE.database}".`);
  }
  return problems;
}

/**
 * Values GitHub should mask before anything else runs. The runner already
 * masks the whole secret, but not a fragment of it (the password on its own,
 * or its percent-decoded form) if a tool ever printed one.
 */
export function valuesToMask(url: string | undefined): string[] {
  if (!url) return [];
  try {
    const { password } = new URL(url);
    if (!password) return [];
    return [...new Set([password, decodeURIComponent(password)])].filter((value) => value.length > 0);
  } catch {
    return [];
  }
}

/** What the server says about itself - gathered read-only by scripts/db/verify-production-target.ts. */
export type DatabaseFacts = {
  database: string;
  serverVersionNum: number;
  /** Supabase's own API role and auth schema - present on every Supabase project, absent elsewhere. */
  hasSupabaseAuthenticatorRole: boolean;
  hasSupabaseAuthSchema: boolean;
  /** pg_event_trigger.evtenabled for ensure_rls ("O", "R", "A" = enabled, "D" = disabled), or null if absent. */
  eventTriggerEnabled: string | null;
  hasMigrationsTable: boolean;
  /** Checksum of the retired migration's row, or null if the row isn't there. */
  retiredMigrationChecksum: string | null;
};

export function databaseFactsProblems(facts: DatabaseFacts): string[] {
  const expected = EXPECTED_PRODUCTION_DATABASE;
  const problems: string[] = [];

  if (facts.database !== expected.database) {
    problems.push(`Connected to database "${facts.database}", expected "${expected.database}".`);
  }
  const major = Math.floor(facts.serverVersionNum / 10000);
  if (major !== expected.postgresMajor) {
    problems.push(`Server is PostgreSQL ${major}, expected ${expected.postgresMajor}.`);
  }
  if (!facts.hasSupabaseAuthenticatorRole || !facts.hasSupabaseAuthSchema) {
    problems.push("Server doesn't have Supabase's authenticator role and auth schema - this isn't a Supabase project.");
  }
  if (facts.eventTriggerEnabled === null) {
    problems.push(`Event trigger ${expected.eventTrigger} is missing - production enables RLS on new tables with it.`);
  } else if (facts.eventTriggerEnabled === "D") {
    problems.push(`Event trigger ${expected.eventTrigger} exists but is disabled.`);
  }
  if (!facts.hasMigrationsTable) {
    problems.push("_prisma_migrations doesn't exist - this database has never been migrated, so it isn't production.");
  } else {
    const retired = RETIRED_MIGRATIONS[0];
    if (facts.retiredMigrationChecksum !== retired.checksum) {
      problems.push(
        `Production's history fingerprint is missing: no "${retired.name}" row with its recorded checksum. ` +
          `A preview or development database migrated from scratch never has it.`,
      );
    }
  }
  return problems;
}
