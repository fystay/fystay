/**
 * Shared plumbing for the production migration checks in scripts/db/. Only
 * .github/workflows/db-migrate-production.yml runs these; nothing in the
 * application or its build imports them.
 *
 * Every query here runs inside a READ ONLY transaction: the checks can look,
 * never touch. The one step that writes is `prisma migrate deploy`, run by
 * the workflow itself.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient, type Prisma } from "@prisma/client";
import type { LocalMigration } from "../../src/lib/migrationSafety/history";

/** The workflow passes the production secret under exactly this name, and only to the steps that need it. */
export function productionUrlFromEnv(): string | undefined {
  return process.env.PROD_DIRECT_URL || undefined;
}

export async function withReadOnlyTransaction<T>(
  url: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  const client = new PrismaClient({ datasourceUrl: url });
  try {
    return await client.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
        return fn(tx);
      },
      { timeout: 60_000, maxWait: 30_000 },
    );
  } finally {
    await client.$disconnect();
  }
}

/** Every prisma/migrations/<name>/migration.sql, with the SHA-256 checksum Prisma records for it. */
export function readLocalMigrations(migrationsDir = join(process.cwd(), "prisma", "migrations")): LocalMigration[] {
  return readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const file = join(migrationsDir, entry.name, "migration.sql");
      if (!existsSync(file)) throw new Error(`prisma/migrations/${entry.name} has no migration.sql`);
      return { name: entry.name, checksum: createHash("sha256").update(readFileSync(file)).digest("hex") };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Prisma's own errors name the host and user at most, never the password -
 * but print only the first line and the error code, to be certain.
 */
export function describeError(error: unknown): string {
  if (error && typeof error === "object") {
    const code = "code" in error && typeof error.code === "string" ? ` [${error.code}]` : "";
    const message = "message" in error && typeof error.message === "string" ? error.message : String(error);
    const firstLine = message.split("\n").map((line) => line.trim()).find((line) => line.length > 0) ?? "unknown error";
    return `${firstLine}${code}`;
  }
  return String(error);
}

export function fail(lines: string[]): never {
  for (const line of lines) console.log(`::error::${line}`);
  process.exit(1);
}
