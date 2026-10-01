import { NextResponse } from "next/server";
import { withApiErrorHandling } from "@/lib/apiError";
import { isAuthorizedCronRequest } from "@/lib/cronAuth";
import { prisma } from "@/lib/prisma";
import { runConnectionSync } from "@/lib/pms/sync";

// One full pull (rates, restrictions, reservations) per mapped room across
// every connected PMS connection - same "stay inside Vercel Hobby's 60s
// ceiling" reasoning as the other cron/sync routes in this codebase.
export const maxDuration = 60;

type ConnectionSyncResult = {
  connectionId: string;
  provider: string;
  status: "synced" | "failed";
  recordCount?: number;
  errors?: string[];
};

/**
 * Nightly background sync for every CONNECTED PmsConnection - see
 * vercel.json for the schedule. This is the backstop that keeps a
 * connection's mapped rooms in sync even for a provider with no webhook
 * support at all (SiteMinder/SuperControl today), and it's also what a
 * webhook-supporting provider falls back to for anything its webhook
 * delivery missed or this app couldn't verify. The host-triggered "Sync
 * now" button (POST /api/host/pms/connections/[provider]/sync) covers the
 * immediate case; this is what runs even if nobody presses it. One
 * connection failing outright (bad credentials, the PMS down) is logged
 * and skipped, not fatal to every other host's sync in the same run -
 * same resilience pattern as sync-ical-imports.
 */
async function getHandler(request: Request) {
  if (!isAuthorizedCronRequest(request, process.env.PMS_RECONCILE_CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const connections = await prisma.pmsConnection.findMany({
    where: { status: "CONNECTED" },
    select: { id: true, provider: true },
  });

  const results: ConnectionSyncResult[] = [];
  for (const connection of connections) {
    try {
      const summary = await runConnectionSync(prisma, connection.id);
      results.push({
        connectionId: connection.id,
        provider: connection.provider,
        status: "synced",
        recordCount: summary.recordCount,
        errors: summary.errors,
      });
    } catch (error) {
      console.error(`PMS reconcile failed for connection ${connection.id}:`, error);
      results.push({ connectionId: connection.id, provider: connection.provider, status: "failed" });
    }
  }

  return NextResponse.json({ syncedAt: new Date().toISOString(), connections: results });
}

export const GET = withApiErrorHandling(getHandler);
