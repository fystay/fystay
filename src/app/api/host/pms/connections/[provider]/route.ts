import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { withHostScope } from "@/lib/pms/hostScopedPrisma";
import { parseProvider } from "@/lib/pms/routeHelpers";
import { withApiErrorHandling } from "@/lib/apiError";

/** Disconnects a provider: clears the stored credentials outright (never left encrypted-but-unused) and flips status back to DISCONNECTED. Room mappings and sync history are kept, not deleted, so reconnecting the same provider later doesn't force the host to redo their room mapping from scratch. */
async function deleteHandler(_request: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider: providerParam } = await params;
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const provider = parseProvider(providerParam);
  if (!provider) return NextResponse.json({ error: "Unknown provider" }, { status: 400 });

  const disconnected = await withHostScope(session.user.id, async (tx) => {
    const connection = await tx.pmsConnection.findUnique({
      where: { hostId_provider: { hostId: session.user.id, provider } },
    });
    if (!connection) return false;

    await tx.pmsConnection.update({
      where: { id: connection.id },
      data: {
        status: "DISCONNECTED",
        credentialsCiphertext: null,
        tokenExpiresAt: null,
        disconnectedAt: new Date(),
      },
    });
    return true;
  });

  if (!disconnected) return NextResponse.json({ error: "Not connected" }, { status: 404 });
  return NextResponse.json({ disconnected: true });
}

export const DELETE = withApiErrorHandling(deleteHandler);
