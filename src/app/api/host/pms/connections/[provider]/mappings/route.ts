import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { withHostScope } from "@/lib/pms/hostScopedPrisma";
import { parseProvider } from "@/lib/pms/routeHelpers";
import { withApiErrorHandling } from "@/lib/apiError";

const upsertMappingSchema = z.object({
  externalRoomId: z.string().min(1),
  externalRoomName: z.string().min(1).nullable().optional(),
  listingId: z.string().min(1),
  roomTypeId: z.string().min(1).nullable().optional(),
});

/** Creates or updates which FYStay listing (or, for a HOTEL listing, which of its room types) a PMS room maps to - upserted on (connectionId, externalRoomId), so re-submitting the same PMS room just updates its target rather than creating a second mapping. */
async function postHandler(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider: providerParam } = await params;
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "HOST") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const provider = parseProvider(providerParam);
  if (!provider) return NextResponse.json({ error: "Unknown provider" }, { status: 400 });

  const body = await request.json().catch(() => null);
  const parsed = upsertMappingSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  const { externalRoomId, externalRoomName, listingId, roomTypeId } = parsed.data;

  const result = await withHostScope(session.user.id, async (tx) => {
    const connection = await tx.pmsConnection.findUnique({
      where: { hostId_provider: { hostId: session.user.id, provider } },
    });
    if (!connection) return { error: "Not connected", status: 404 } as const;

    // Ownership check: the listing (and, if given, the room type under it)
    // must belong to this host - the same "never trust a client-supplied id
    // without an ownership check" pattern every other host-scoped route in
    // this codebase follows.
    const listing = await tx.listing.findUnique({
      where: { id: listingId },
      select: { id: true, hostId: true, propertyType: true },
    });
    if (!listing || listing.hostId !== session.user.id) {
      return { error: "Listing not found", status: 404 } as const;
    }
    if (roomTypeId) {
      const roomType = await tx.roomType.findUnique({ where: { id: roomTypeId }, select: { listingId: true } });
      if (!roomType || roomType.listingId !== listingId) {
        return { error: "Room type does not belong to that listing", status: 400 } as const;
      }
    } else if (listing.propertyType === "HOTEL") {
      return {
        error: "A HOTEL listing needs a specific room type to map to, not the listing itself",
        status: 400,
      } as const;
    }

    const mapping = await tx.pmsRoomMapping.upsert({
      where: { connectionId_externalRoomId: { connectionId: connection.id, externalRoomId } },
      create: {
        connectionId: connection.id,
        externalRoomId,
        externalRoomName: externalRoomName ?? null,
        listingId,
        roomTypeId: roomTypeId ?? null,
      },
      update: { externalRoomName: externalRoomName ?? null, listingId, roomTypeId: roomTypeId ?? null },
    });
    return { mapping } as const;
  });

  if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ mapping: result.mapping }, { status: 201 });
}

export const POST = withApiErrorHandling(postHandler);
