import { PrismaClient } from "@prisma/client";
import {
  createProviderRow,
  describeDatabaseTarget,
  formatDatabaseTarget,
  listProviderOverview,
  setProviderStatus,
  type AdminResult,
} from "../src/lib/hotelProviders/providerAdmin";

/**
 * Manage HotelProvider rows from a terminal - see providerAdmin.ts for the
 * safety rules. Usage:
 *
 *   npm run db:hotel-provider -- list
 *   npm run db:hotel-provider -- create <code> [--apply --confirm-host=<host>]
 *   npm run db:hotel-provider -- set-status <code> <ACTIVE|INACTIVE|COMING_SOON> [--apply --confirm-host=<host>]
 *
 * Writes are dry runs unless both --apply and a --confirm-host matching the
 * DATABASE_URL host are given. LIVE_HOTEL_PROVIDER_CODES (registry.ts)
 * remains the final gate for any external provider and can't be changed here.
 */

const USAGE = [
  "Usage:",
  "  npm run db:hotel-provider -- list",
  "  npm run db:hotel-provider -- create <code> [--apply --confirm-host=<host>]",
  "  npm run db:hotel-provider -- set-status <code> <ACTIVE|INACTIVE|COMING_SOON> [--apply --confirm-host=<host>]",
].join("\n");

const prisma = new PrismaClient();

function print(result: AdminResult): void {
  for (const line of result.lines) console.log(line);
  if (!result.ok) {
    console.error(result.error);
    process.exitCode = 1;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const flags = args.filter((arg) => arg.startsWith("--"));
  const positional = args.filter((arg) => !arg.startsWith("--"));
  const unknownFlags = flags.filter((flag) => flag !== "--apply" && !flag.startsWith("--confirm-host="));
  if (unknownFlags.length > 0) {
    console.error(`Unknown option(s): ${unknownFlags.join(" ")}\n${USAGE}`);
    process.exitCode = 1;
    return;
  }
  const apply = flags.includes("--apply");
  const confirmHost = flags.find((flag) => flag.startsWith("--confirm-host="))?.slice("--confirm-host=".length);
  const [command, code, status] = positional;

  // PrismaClient has loaded .env by this point, so this is the same
  // DATABASE_URL it will write to.
  await prisma.$connect();
  const target = describeDatabaseTarget(process.env.DATABASE_URL);
  if (!target) {
    console.error("DATABASE_URL is not set or not a valid URL.");
    process.exitCode = 1;
    return;
  }

  if (command === "list" && positional.length === 1) {
    console.log(`Target database: ${formatDatabaseTarget(target)}`);
    for (const row of await listProviderOverview(prisma)) {
      console.log(
        `${row.code}: ${row.registered ? "registered" : "NOT REGISTERED"}, db status ${row.dbStatus ?? "(no row)"}` +
          `${row.fixture ? ", fixture" : ""}${row.liveListed ? ", live-listed" : ""}`,
      );
      console.log(`  non-production: ${row.nonProduction}`);
      console.log(`  production:     ${row.production}`);
    }
    return;
  }
  if (command === "create" && code && positional.length === 2) {
    print(await createProviderRow(prisma, code, { apply, confirmHost, target }));
    return;
  }
  if (command === "set-status" && code && status && positional.length === 3) {
    print(await setProviderStatus(prisma, code, status, { apply, confirmHost, target }));
    return;
  }
  console.error(USAGE);
  process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
