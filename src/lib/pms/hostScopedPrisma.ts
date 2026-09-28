import { PrismaClient, type Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { BUILD_TIME_DATABASE_URL, isNextProductionBuild } from "@/lib/databaseIdentity";

const globalForHostScopedPrisma = globalThis as unknown as {
  pmsHostScopedPrisma: PrismaClient | undefined;
};

// Same build-time rule as src/lib/prisma.ts: `next build` never connects.
const hostScopedDatabaseUrl =
  process.env.PMS_HOST_SCOPED_DATABASE_URL && isNextProductionBuild()
    ? BUILD_TIME_DATABASE_URL
    : process.env.PMS_HOST_SCOPED_DATABASE_URL;

const hostScopedClient = hostScopedDatabaseUrl
  ? (globalForHostScopedPrisma.pmsHostScopedPrisma ??
    new PrismaClient({ datasources: { db: { url: hostScopedDatabaseUrl } } }))
  : null;

if (hostScopedClient && process.env.NODE_ENV !== "production") {
  globalForHostScopedPrisma.pmsHostScopedPrisma = hostScopedClient;
}

/** True once PMS_HOST_SCOPED_DATABASE_URL is set - lets a route/page note in its own response/log when it's running without the extra RLS layer, without duplicating the env check everywhere. */
export const pmsRowLevelSecurityConfigured = hostScopedClient !== null;

/**
 * Runs `fn` against the PMS tables' restricted, RLS-enforced database role
 * (see prisma/migrations/20260914070000_add_pms_row_level_security), with
 * the Postgres session variable app.current_host_id set to `hostId` for the
 * lifetime of one transaction. This is defense-in-depth *on top of*, never
 * instead of, every route's own explicit hostId ownership check: even a
 * route that forgot its own check could never read or write another host's
 * PmsConnection/PmsRoomMapping/PmsReservationLink/PmsSyncLog/PmsWebhookEvent
 * row through this path, because the database itself refuses it.
 *
 * Falls back to the regular, unscoped Prisma client (today's behavior -
 * application-layer checks only) when PMS_HOST_SCOPED_DATABASE_URL isn't
 * set. That variable points at new production infrastructure (a dedicated
 * non-superuser Postgres role) that has to be provisioned once before it
 * can be used - see the migration file's own comment for the exact setup
 * steps. Nothing breaks if it's never set up; every host-facing PMS route
 * simply keeps relying on its own ownership check alone, exactly as before
 * this migration existed.
 *
 * Never use this for the reconciliation cron or the inbound webhook
 * receiver - those are trusted system jobs that must see every host's
 * connections, not one host's own session, and should keep using the plain
 * `prisma` client from "@/lib/prisma".
 *
 * Keep `fn` to the DB read/write(s) that decide "does this belong to the
 * calling host" - never a PMS adapter network call (a slow or hung request
 * to Cloudbeds/SiteMinder/SuperControl) and never a multi-step operation
 * like runConnectionSync. Both of those hold a real Postgres connection and
 * transaction open for as long as they take, which is fine for one quick
 * query but bad practice (and a connection-pool risk) across an outbound
 * HTTP call or a whole sync run. The established pattern in every
 * /api/host/pms/* route: resolve and authorize the target row (connection,
 * mapping, etc.) via withHostScope first, then do any network call or
 * longer-running work afterwards against the plain `prisma` client, scoped
 * to the id you just got back - not to anything client-supplied.
 */
export async function withHostScope<T>(
  hostId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  if (!hostScopedClient) return fn(prisma);
  return hostScopedClient.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_host_id', ${hostId}, true)`;
    return fn(tx);
  });
}
