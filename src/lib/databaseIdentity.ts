/**
 * Database identity protection: a non-production Vercel deployment (preview
 * or development) must never hold credentials for the production database.
 *
 * Previews used to share the production DATABASE_URL, so every guard keyed
 * on VERCEL_ENV alone ("seeding is fine on preview") was really a guard on
 * the production database. This check keys on the credential itself instead:
 * every production connection string and Supabase key identifies the
 * production project by its ref - in the pooler username
 * (postgres.<ref>), the direct host (db.<ref>.supabase.co), the API URL
 * (https://<ref>.supabase.co) and the ref claim of a legacy service_role
 * JWT - so a deployment that isn't production and still carries one of them
 * is misconfigured, and refuses to build or serve rather than connect.
 *
 * Enforced at build time by next.config.ts (the deployment never goes live)
 * and again at runtime by src/lib/prisma.ts and src/lib/storage.ts.
 *
 * Scoped to Vercel deployments (VERCEL=1). Local runs are deliberately not
 * covered here: the operator CLIs in prisma/ (e.g. `npm run
 * db:hotel-provider`) are meant to target the production database from a
 * terminal, and load src/lib/prisma.ts transitively. They carry their own
 * explicit target confirmation.
 *
 * Self-contained (no "@/" imports) because next.config.ts loads it before
 * the app's path aliases exist.
 */

/** Anything env-shaped - process.env, or a plain object in tests. */
type EnvSource = Readonly<Record<string, string | undefined>>;

/**
 * The production Supabase project (see the comments on the production-scoped
 * Vercel environment variables). Not a secret - it is already public in
 * NEXT_PUBLIC_SUPABASE_URL. If production ever moves to a new project, this
 * constant moves with it.
 */
export const PRODUCTION_SUPABASE_PROJECT_REF = "wzatjhyfwtmxdxfmurkm";

/** Every variable that carries a database connection, or a Supabase endpoint or key. */
export const DATABASE_IDENTITY_VARIABLES = [
  "DATABASE_URL",
  "DIRECT_URL",
  "PMS_HOST_SCOPED_DATABASE_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;

/**
 * The project ref inside a legacy Supabase API key (a JWT whose payload has
 * `ref`). Newer `sb_secret_...` keys don't embed the project, so they return
 * null - for those, NEXT_PUBLIC_SUPABASE_URL (checked alongside) is what
 * identifies the project. Never verifies or logs the key.
 */
function supabaseJwtProjectRef(key: string): string | null {
  const parts = key.split(".");
  if (parts.length !== 3) return null;
  try {
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const payload: unknown = JSON.parse(atob(padded));
    if (payload && typeof payload === "object" && "ref" in payload && typeof payload.ref === "string") {
      return payload.ref;
    }
    return null;
  } catch {
    return null;
  }
}

function identifiesProductionProject(value: string): boolean {
  return (
    value.toLowerCase().includes(PRODUCTION_SUPABASE_PROJECT_REF) ||
    supabaseJwtProjectRef(value) === PRODUCTION_SUPABASE_PROJECT_REF
  );
}

/** Names (never values) of the variables in `env` that point at the production project. */
export function findProductionDatabaseVariables(env: EnvSource): string[] {
  return DATABASE_IDENTITY_VARIABLES.filter((name) => {
    const value = env[name];
    return typeof value === "string" && value !== "" && identifiesProductionProject(value);
  });
}

/**
 * Why this environment must refuse to run, or null if it's fine. Fails closed
 * on Vercel: anything other than VERCEL_ENV=production (preview, development,
 * or unset) counts as non-production.
 */
export function productionDatabaseRefusal(env: EnvSource): string | null {
  if (env.VERCEL !== "1") return null;
  if (env.VERCEL_ENV === "production") return null;

  const variables = findProductionDatabaseVariables(env);
  if (variables.length === 0) return null;

  return (
    `Refusing to run: ${variables.join(", ")} ${variables.length === 1 ? "points" : "point"} at the production Supabase project ` +
    `(${PRODUCTION_SUPABASE_PROJECT_REF}), but this is a non-production Vercel deployment ` +
    `(VERCEL_ENV=${env.VERCEL_ENV ?? "unset"}). Preview deployments must use the separate ` +
    `fystay-preview project - scope the production values to the Production environment only.`
  );
}

export function assertNoProductionDatabaseOutsideProduction(env: EnvSource = process.env): void {
  const refusal = productionDatabaseRefusal(env);
  if (refusal) throw new Error(refusal);
}

/**
 * True while `next build` runs. Next sets NEXT_PHASE in the build process
 * and its prerender workers inherit it; it is never this value at runtime.
 */
export function isNextProductionBuild(env: EnvSource = process.env): boolean {
  return env.NEXT_PHASE === "phase-production-build";
}

/**
 * The datasource every Prisma client uses during `next build`: a reserved,
 * unresolvable host (RFC 2606 .invalid), so a build never needs - or opens -
 * a database connection, whatever credentials the build environment holds.
 * A page that queries while being prerendered gets a connection error
 * instead of data: Next then either renders that route per request (what it
 * did for the homepage before it was marked force-dynamic) or fails the
 * build - it can't read from, or bake in, a real database either way.
 */
export const BUILD_TIME_DATABASE_URL =
  "postgresql://build:build@database-access-is-disabled-during-next-build.invalid:5432/none";
