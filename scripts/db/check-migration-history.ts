/**
 * Compares production's _prisma_migrations with this commit's
 * prisma/migrations, read-only. Run before `prisma migrate deploy` (pending
 * migrations expected) and after it (none may remain). Exits 1 on anything
 * unsafe; never repairs history. See src/lib/migrationSafety/history.ts.
 *
 *   PROD_DIRECT_URL=... npx tsx scripts/db/check-migration-history.ts --before-deploy
 *   PROD_DIRECT_URL=... npx tsx scripts/db/check-migration-history.ts --after-deploy
 */
import { appendFileSync } from "node:fs";
import { evaluateMigrationHistory, type MigrationHistoryRow } from "../../src/lib/migrationSafety/history";
import { describeError, fail, productionUrlFromEnv, readLocalMigrations, withReadOnlyTransaction } from "./productionDatabase";

async function main() {
  const mode = process.argv[2];
  if (mode !== "--before-deploy" && mode !== "--after-deploy") {
    fail(["Usage: check-migration-history.ts --before-deploy | --after-deploy"]);
  }
  const url = productionUrlFromEnv();
  if (!url) fail(["PROD_DIRECT_URL is empty."]);

  const local = readLocalMigrations();
  let rows: MigrationHistoryRow[];
  try {
    rows = await withReadOnlyTransaction(url, (tx) =>
      tx.$queryRaw<MigrationHistoryRow[]>`
        SELECT migration_name AS "migrationName", checksum, started_at AS "startedAt",
               finished_at AS "finishedAt", rolled_back_at AS "rolledBackAt"
        FROM public._prisma_migrations ORDER BY started_at`,
    );
  } catch (error) {
    fail([`Couldn't read _prisma_migrations: ${describeError(error)}`]);
  }

  const report = evaluateMigrationHistory(rows, local);
  const problems = [...report.problems];
  if (mode === "--after-deploy" && report.pending.length > 0) {
    problems.push(`Still pending after deploy: ${report.pending.join(", ")}`);
  }

  const lines = [
    `Local migrations in this commit: ${local.length}`,
    `Applied in production:           ${report.appliedCount}`,
    `Accepted retired rows:           ${report.retired.join(", ") || "none"}`,
    `Previously failed, re-applied:   ${report.resolvedFailures.join(", ") || "none"}`,
    `Pending:                         ${report.pending.length === 0 ? "none" : report.pending.length}`,
    ...report.pending.map((name) => `  - ${name}`),
  ];
  console.log(lines.join("\n"));

  if (process.env.GITHUB_STEP_SUMMARY) {
    const heading = mode === "--before-deploy" ? "Migration history before deploy" : "Migration history after deploy";
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### ${heading}\n\n\`\`\`\n${lines.join("\n")}\n\`\`\`\n\n`);
  }

  if (problems.length > 0) fail(problems);
  console.log(mode === "--before-deploy" ? "History is safe to deploy onto." : "History is complete and consistent.");
}

main().catch((error) => fail([describeError(error)]));
