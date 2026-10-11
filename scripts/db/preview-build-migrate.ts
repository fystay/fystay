/**
 * Runs before `next build` on Vercel (package.json "vercel-build"). On every
 * build except a Preview build that opted in with PREVIEW_DB_MIGRATE=1 it
 * does nothing - Production is migrated only by the approved GitHub workflow
 * (docs/production-database-migrations.md). For that Preview build it
 * applies the committed migrations, and the idempotent demo seed when
 * PREVIEW_DB_SEED=1, to the Backup project's isolated Preview schema - after
 * previewMigrationDecision has checked every connection string, and without
 * ever printing one.
 */
import { execFileSync } from "node:child_process";
import { previewMigrationDecision } from "../../src/lib/previewDatabase";

const decision = previewMigrationDecision(process.env);
if (!decision.run) {
  console.log(`Preview database: not migrating (${decision.reason}).`);
  process.exit(0);
}

console.log("Preview database: applying migrations to the isolated Preview schema.");
execFileSync("npx", ["prisma", "migrate", "deploy"], { stdio: "inherit" });

if (decision.seed) {
  console.log("Preview database: seeding demo data (idempotent).");
  // Over the session connection: the seed is many statements in a row.
  execFileSync("npx", ["tsx", "prisma/seed.ts"], {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: process.env.DIRECT_URL },
  });
}
