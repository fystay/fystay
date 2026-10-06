import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { withHostScope } from "@/lib/pms/hostScopedPrisma";
import { parseProvider } from "@/lib/pms/routeHelpers";
import { withApiErrorHandling } from "@/lib/apiError";

/** The "view errors" detail behind the integrations page's summary card - the last 20 sync attempts for this connection, most recent first. */
async function getHandler(_request: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider: providerParam } = await params;
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const provider = parseProvider(providerParam);
  if (!provider) return NextResponse.json({ error: "Unknown provider" }, { status: 400 });

  const logs = await withHostScope(session.user.id, async (tx) => {
    const connection = await tx.pmsConnection.findUnique({
      where: { hostId_provider: { hostId: session.user.id, provider } },
    });
    if (!connection) return null;

    return tx.pmsSyncLog.findMany({
      where: { connectionId: connection.id },
      orderBy: { startedAt: "desc" },
      take: 20,
    });
  });

  if (!logs) return NextResponse.json({ error: "Not connected" }, { status: 404 });
  return NextResponse.json({ logs });
}

export const GET = withApiErrorHandling(getHandler);
