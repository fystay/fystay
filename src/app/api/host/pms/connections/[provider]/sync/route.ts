import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { withHostScope } from "@/lib/pms/hostScopedPrisma";
import { parseProvider } from "@/lib/pms/routeHelpers";
import { runConnectionSync } from "@/lib/pms/sync";
import { withApiErrorHandling } from "@/lib/apiError";

// A sync fans out to one live API call per mapped room (rates,
// restrictions, reservations) - generous but bounded, matching the same
// "stay inside Vercel Hobby's 60s ceiling" reasoning the other cron/sync
// routes in this codebase already use.
export const maxDuration = 60;

/** The host-facing "Sync now" button - runs the same full pull the nightly reconciliation cron does, on demand, for one connection. */
async function postHandler(_request: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider: providerParam } = await params;
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "HOST") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const provider = parseProvider(providerParam);
  if (!provider) return NextResponse.json({ error: "Unknown provider" }, { status: 400 });

  const connection = await withHostScope(session.user.id, (tx) =>
    tx.pmsConnection.findUnique({
      where: { hostId_provider: { hostId: session.user.id, provider } },
    }),
  );
  if (!connection) return NextResponse.json({ error: "Not connected" }, { status: 404 });

  // Plain client, not withHostScope: runConnectionSync makes real outbound
  // calls to the PMS per mapped room and can run for tens of seconds - see
  // withHostScope's own comment for why that must never happen inside its
  // transaction. connection.id was already authorized above.
  const summary = await runConnectionSync(prisma, connection.id);
  return NextResponse.json({ summary });
}

export const POST = withApiErrorHandling(postHandler);
