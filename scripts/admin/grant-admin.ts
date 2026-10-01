/**
 * Grants the ADMIN role to an existing account.
 *
 *   DATABASE_URL="<target database>" npx tsx scripts/admin/grant-admin.ts you@example.com --confirm
 *
 * Without --confirm it only says what it would do. It prints the target
 * database host (never the password) so you can check you're pointed at the
 * right environment. See docs/launch/launch-runbook.md.
 */
import { PrismaClient } from "@prisma/client";
import { grantAdmin } from "../../src/lib/adminBootstrap";

async function main() {
  const email = process.argv[2];
  const confirmed = process.argv.includes("--confirm");
  const url = process.env.DATABASE_URL;
  if (!email || email.startsWith("--")) {
    console.error("Usage: npx tsx scripts/admin/grant-admin.ts <email> [--confirm]");
    process.exit(1);
  }
  if (!url) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }
  console.log(`Target database host: ${new URL(url).host}`);
  if (!confirmed) {
    console.log(`Dry run: would grant ADMIN to ${email}. Re-run with --confirm to apply.`);
    return;
  }
  const prisma = new PrismaClient({ datasourceUrl: url });
  try {
    const result = await grantAdmin(prisma, email);
    if (result.outcome === "refused") {
      console.error(`Refused: ${result.reason}`);
      process.exit(1);
    }
    console.log(
      result.outcome === "already_admin"
        ? `${email} is already an admin - nothing changed.`
        : `${email} is now an admin (was ${result.previousRole}). They must log in again.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main();
