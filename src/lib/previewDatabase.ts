import { findProductionDatabaseVariables, PRODUCTION_SUPABASE_PROJECT_REF } from "./databaseIdentity";
import type { EnvSource } from "./deploymentEnvironment";

/**
 * Preview's database, inside the FYStay Backup Supabase project
 * ("fystaybackup"): its own schema, owned by its own restricted login, so a
 * Preview can never read or write the project's other schemas - the backup
 * itself and anything restored into it.
 */
export const BACKUP_SUPABASE_PROJECT_REF = "sqkpixwvugrxllrxlexs";
export const PREVIEW_DATABASE_SCHEMA = "fystay_preview";
export const PREVIEW_DATABASE_ROLE = "fystay_preview_app";

export type PreviewMigrationDecision =
  | { run: false; reason: string }
  | { run: true; seed: boolean };

/** The Supabase project a connection string names: the pooler user ("role.ref") or the direct host ("db.ref.supabase.co"). */
function supabaseProjectRef(url: URL): string | null {
  const userRef = decodeURIComponent(url.username).split(".")[1];
  if (userRef) return userRef;
  const hostRef = url.hostname.match(/^db\.([a-z0-9]+)\.supabase\.co$/)?.[1];
  return hostRef ?? null;
}

function connectionProblems(name: string, value: string | undefined, { direct }: { direct: boolean }): string[] {
  if (!value) return [`${name} is not set`];
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return [`${name} isn't a valid connection string`];
  }
  const problems: string[] = [];
  if (supabaseProjectRef(url) !== BACKUP_SUPABASE_PROJECT_REF) {
    problems.push(`${name} must name the Backup project (${BACKUP_SUPABASE_PROJECT_REF})`);
  }
  if (decodeURIComponent(url.username).split(".")[0] !== PREVIEW_DATABASE_ROLE) {
    problems.push(`${name} must connect as ${PREVIEW_DATABASE_ROLE}, the login limited to the Preview schema`);
  }
  if (url.searchParams.get("schema") !== PREVIEW_DATABASE_SCHEMA) {
    problems.push(`${name} must set schema=${PREVIEW_DATABASE_SCHEMA}`);
  }
  if (direct && url.port !== "5432") {
    problems.push(`${name} must use port 5432 (session pooler or direct), not the transaction pooler`);
  }
  return problems;
}

/**
 * Whether this build may migrate (and seed) Preview's database, decided
 * before anything connects. Production never migrates from a build - it has
 * its own approved GitHub workflow - so only a Preview build with
 * PREVIEW_DB_MIGRATE=1 runs, and only against the Backup project's Preview
 * schema as its restricted login. Anything else that asked to migrate is
 * refused outright, failing the build, rather than skipped quietly.
 */
export function previewMigrationDecision(env: EnvSource): PreviewMigrationDecision {
  if (env.VERCEL_ENV !== "preview") return { run: false, reason: `not a Preview build (VERCEL_ENV=${env.VERCEL_ENV ?? "unset"})` };
  if (env.PREVIEW_DB_MIGRATE !== "1") return { run: false, reason: "PREVIEW_DB_MIGRATE isn't 1 for this branch" };

  const production = findProductionDatabaseVariables(env);
  if (production.length > 0) {
    throw new Error(
      `Refusing to migrate: ${production.join(", ")} point at the production project (${PRODUCTION_SUPABASE_PROJECT_REF}).`,
    );
  }
  const problems = [
    ...connectionProblems("DATABASE_URL", env.DATABASE_URL, { direct: false }),
    ...connectionProblems("DIRECT_URL", env.DIRECT_URL, { direct: true }),
  ];
  if (problems.length > 0) throw new Error(`Refusing to migrate Preview's database: ${problems.join("; ")}.`);

  return { run: true, seed: env.PREVIEW_DB_SEED === "1" };
}
