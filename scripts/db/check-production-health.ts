/**
 * After `prisma migrate deploy`: the schema the app expects is really there,
 * and nothing is exposed. Read-only; exits 1 on a problem (the migration has
 * already happened by then, so this is an alarm, not a gate - it never
 * attempts a rollback).
 *
 *   PROD_DIRECT_URL=... npx tsx scripts/db/check-production-health.ts
 */
import { Prisma } from "@prisma/client";
import { describeError, fail, productionUrlFromEnv, withReadOnlyTransaction } from "./productionDatabase";

async function main() {
  const url = productionUrlFromEnv();
  if (!url) fail(["PROD_DIRECT_URL is empty."]);

  const expectedTables = Prisma.dmmf.datamodel.models.map((model) => model.dbName ?? model.name).sort();

  let tables: { name: string; rls: boolean }[];
  try {
    tables = await withReadOnlyTransaction(url, (tx) =>
      tx.$queryRaw<{ name: string; rls: boolean }[]>`
        SELECT c.relname AS name, c.relrowsecurity AS rls
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
        ORDER BY c.relname`,
    );
  } catch (error) {
    fail([`Couldn't read the production schema: ${describeError(error)}`]);
  }

  const present = new Set(tables.map((table) => table.name));
  const missing = expectedTables.filter((name) => !present.has(name));
  // Supabase exposes every public table through its REST API; production's
  // ensure_rls trigger turns RLS on for each new one. A table without it is
  // readable with the project's public anon key.
  const withoutRls = tables.filter((table) => !table.rls).map((table) => table.name);

  console.log(
    [
      `Prisma models:             ${expectedTables.length}`,
      `Tables in public:          ${tables.length}`,
      `Model tables missing:      ${missing.join(", ") || "none"}`,
      `Tables without RLS:        ${withoutRls.join(", ") || "none"}`,
    ].join("\n"),
  );

  const problems = [
    ...missing.map((name) => `Table "${name}" from schema.prisma doesn't exist in production.`),
    ...withoutRls.map((name) => `Table "${name}" has row-level security disabled - it's exposed through Supabase's API.`),
  ];
  if (problems.length > 0) fail(problems);
  console.log("Healthy: every model table exists and every public table has RLS enabled.");
}

main().catch((error) => fail([describeError(error)]));
