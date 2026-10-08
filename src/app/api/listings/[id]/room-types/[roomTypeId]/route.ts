import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { httpUrlSchema, listingFieldSchemas } from "@/lib/validation";
import { recomputeListingAggregatesFromRoomTypes } from "@/lib/roomTypeAggregates";
import { withApiErrorHandling } from "@/lib/apiError";

const updateRoomTypeSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(2000).nullable().optional(),
  pricePerNightCents: listingFieldSchemas.pricePerNightCents.optional(),
  maxGuests: z.number().int().min(1).max(50).optional(),
  bedrooms: z.number().int().min(0).max(50).optional(),
  beds: z.number().int().min(1).max(50).optional(),
  bathrooms: z.number().int().min(0).max(50).optional(),
  photos: z.array(httpUrlSchema).min(1).optional(),
  // Down to 0 pauses the room type (it will always fail the capacity
  // check for new bookings) without deleting it or its booking history.
  totalRooms: z.number().int().min(0).max(500).optional(),
});

async function loadOwnedRoomType(
  listingId: string,
  roomTypeId: string,
  userId: string,
) {
  const roomType = await prisma.roomType.findUnique({
    where: { id: roomTypeId },
    include: { listing: { select: { id: true, hostId: true } } },
  });
  if (!roomType || roomType.listing.id !== listingId) return { error: "Not found" as const, status: 404 };
  if (roomType.listing.hostId !== userId) return { error: "Forbidden" as const, status: 403 };
  return { roomType };
}

async function patchHandler(
  request: Request,
  { params }: { params: Promise<{ id: string; roomTypeId: string }> },
) {
  const { id, roomTypeId } = await params;
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await loadOwnedRoomType(id, roomTypeId, session.user.id);
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  const body = await request.json();
  const parsed = updateRoomTypeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const updated = await prisma.$transaction(async (tx) => {
    const roomType = await tx.roomType.update({
      where: { id: roomTypeId },
      data: parsed.data,
    });
    await recomputeListingAggregatesFromRoomTypes(tx, id);
    return roomType;
  });

  return NextResponse.json({ roomType: updated });
}

async function deleteHandler(
  _request: Request,
  { params }: { params: Promise<{ id: string; roomTypeId: string }> },
) {
  const { id, roomTypeId } = await params;
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await loadOwnedRoomType(id, roomTypeId, session.user.id);
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  // Mirrors the DB's own onDelete: Restrict on Booking.roomType with a
  // friendlier error - a room type with real (any-status) booking history
  // must never be deleted out from under those records.
  const bookingCount = await prisma.booking.count({ where: { roomTypeId } });
  if (bookingCount > 0) {
    return NextResponse.json(
      { error: "This room type has bookings and can't be deleted" },
      { status: 409 },
    );
  }

  const listing = await prisma.listing.findUniqueOrThrow({
    where: { id },
    select: { published: true },
  });
  if (listing.published) {
    const otherRoomTypes = await prisma.roomType.count({
      where: { listingId: id, id: { not: roomTypeId } },
    });
    if (otherRoomTypes === 0) {
      return NextResponse.json(
        { error: "A published hotel needs at least one room type - unpublish it first" },
        { status: 409 },
      );
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.roomType.delete({ where: { id: roomTypeId } });
    await recomputeListingAggregatesFromRoomTypes(tx, id);
  });

  return NextResponse.json({ ok: true });
}

export const PATCH = withApiErrorHandling(patchHandler);
export const DELETE = withApiErrorHandling(deleteHandler);
