import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import {
  blockingBookingWhere,
  blockingRanges,
  isRangeAvailable,
  isRoomTypeRangeAvailable,
} from "@/lib/availability";
import { isValidBlockRange } from "@/lib/availabilityBlocks";
import { withApiErrorHandling } from "@/lib/apiError";

const createBlockSchema = z.object({
  startDate: z.string().min(1),
  endDate: z.string().min(1),
  reason: z.string().trim().max(200).optional(),
  roomTypeId: z.string().min(1).optional(),
});

/** A host manually closing a date range on their own listing's calendar. */
async function postHandler(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const listing = await prisma.listing.findUnique({ where: { id } });
  if (!listing) {
    return NextResponse.json({ error: "Listing not found" }, { status: 404 });
  }
  if (listing.hostId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const parsed = createBlockSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }
  if (listing.propertyType === "HOTEL" && !parsed.data.roomTypeId) {
    return NextResponse.json(
      { error: "A hotel listing's blocks must specify a room type" },
      { status: 400 },
    );
  }
  if (listing.propertyType !== "HOTEL" && parsed.data.roomTypeId) {
    return NextResponse.json(
      { error: "Only a hotel listing's blocks can specify a room type" },
      { status: 400 },
    );
  }

  const startDate = new Date(parsed.data.startDate);
  const endDate = new Date(parsed.data.endDate);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return NextResponse.json({ error: "Invalid dates" }, { status: 400 });
  }
  if (!isValidBlockRange(startDate, endDate)) {
    return NextResponse.json(
      { error: "End date must be after the start date" },
      { status: 400 },
    );
  }

  const { roomTypeId } = parsed.data;

  if (roomTypeId) {
    const roomType = await prisma.roomType.findUnique({ where: { id: roomTypeId } });
    if (!roomType || roomType.listingId !== id) {
      return NextResponse.json({ error: "Room type not found" }, { status: 404 });
    }

    const [bookings, blocks] = await Promise.all([
      prisma.booking.findMany({
        where: {
          roomTypeId,
          ...blockingBookingWhere(),
          checkIn: { lt: endDate },
          checkOut: { gt: startDate },
        },
        select: { checkIn: true, checkOut: true, roomsBooked: true },
      }),
      prisma.availabilityBlock.findMany({
        where: { roomTypeId },
        select: { startDate: true, endDate: true },
      }),
    ]);

    // A block always closes the room type entirely for its range, so it's
    // checked as "no capacity left at all" - i.e. a request for every
    // remaining room, not just one.
    if (
      !isRoomTypeRangeAvailable(startDate, endDate, roomType.totalRooms, roomType.totalRooms, bookings, blocks)
    ) {
      return NextResponse.json(
        { error: "Those dates overlap an existing booking or block for this room type" },
        { status: 409 },
      );
    }

    const block = await prisma.availabilityBlock.create({
      data: { listingId: id, roomTypeId, startDate, endDate, reason: parsed.data.reason },
    });

    return NextResponse.json({ block }, { status: 201 });
  }

  const [bookings, blocks] = await Promise.all([
    prisma.booking.findMany({
      where: { listingId: id, ...blockingBookingWhere() },
      select: { checkIn: true, checkOut: true },
    }),
    prisma.availabilityBlock.findMany({
      where: { listingId: id },
      select: { startDate: true, endDate: true },
    }),
  ]);

  if (!isRangeAvailable(startDate, endDate, blockingRanges(bookings, blocks))) {
    return NextResponse.json(
      { error: "Those dates overlap an existing booking or block" },
      { status: 409 },
    );
  }

  const block = await prisma.availabilityBlock.create({
    data: { listingId: id, startDate, endDate, reason: parsed.data.reason },
  });

  return NextResponse.json({ block }, { status: 201 });
}

export const POST = withApiErrorHandling(postHandler);
