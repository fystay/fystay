import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { withHostScope } from "@/lib/pms/hostScopedPrisma";
import { parseProvider } from "@/lib/pms/routeHelpers";
import { withApiErrorHandling } from "@/lib/apiError";

/** Removes a room mapping - the PMS room and the FYStay listing/room type it pointed at are both untouched; only the link (and any future sync against it) stops. Past AvailabilityBlock/PmsReservationLink rows already created from it are left in place, same as disconnecting an iCal import leaves its previously-synced blocks. */
async function deleteHandler(
  _request: Request,
  { params }: { params: Promise<{ provider: string; mappingId: string }> },
) {
  const { provider: providerParam, mappingId } = await params;
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const provider = parseProvider(providerParam);
  if (!provider) return NextResponse.json({ error: "Unknown provider" }, { status: 400 });

  const deleted = await withHostScope(session.user.id, async (tx) => {
    const mapping = await tx.pmsRoomMapping.findUnique({
      where: { id: mappingId },
      include: { connection: true },
    });
    if (!mapping || mapping.connection.hostId !== session.user.id || mapping.connection.provider !== provider) {
      return false;
    }
    await tx.pmsRoomMapping.delete({ where: { id: mappingId } });
    return true;
  });

  if (!deleted) return NextResponse.json({ error: "Mapping not found" }, { status: 404 });
  return NextResponse.json({ deleted: true });
}

export const DELETE = withApiErrorHandling(deleteHandler);
