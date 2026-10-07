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
import { parseStayDate } from "@/lib/stayDates";
import { withListingAvailabilityLock } from "@/lib/availabilityLock";

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

  const startDate = parseStayDate(parsed.data.startDate);
  const endDate = parseStayDate(parsed.data.endDate);
  if (!startDate || !endDate) {
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
  }

  // The overlap check and the insert run under the listing's availability
  // lock (see availabilityLock.ts), so a booking or approval for these dates
  // can't land between the check passing and the block being written.
  const block = await withListingAvailabilityLock(prisma, id, async (tx) => {
    if (roomTypeId) {
      const [roomType, bookings, blocks] = await Promise.all([
        tx.roomType.findUniqueOrThrow({ where: { id: roomTypeId }, select: { totalRooms: true } }),
        tx.booking.findMany({
          where: {
            roomTypeId,
            ...blockingBookingWhere(),
            checkIn: { lt: endDate },
            checkOut: { gt: startDate },
          },
          select: { checkIn: true, checkOut: true, roomsBooked: true },
        }),
        // Its own blocks and the listing-wide ones (see blocksForRoomType).
        tx.availabilityBlock.findMany({
          where: { OR: [{ roomTypeId }, { listingId: id, roomTypeId: null }] },
          select: { startDate: true, endDate: true },
        }),
      ]);

      // A block always closes the room type entirely for its range, so it's
      // checked as "no capacity left at all" - i.e. a request for every
      // remaining room, not just one.
      if (
        !isRoomTypeRangeAvailable(startDate, endDate, roomType.totalRooms, roomType.totalRooms, bookings, blocks)
      ) {
        return null;
      }

      return tx.availabilityBlock.create({
        data: { listingId: id, roomTypeId, startDate, endDate, reason: parsed.data.reason },
      });
    }

    const [bookings, blocks] = await Promise.all([
      tx.booking.findMany({
        where: { listingId: id, ...blockingBookingWhere() },
        select: { checkIn: true, checkOut: true },
      }),
      tx.availabilityBlock.findMany({
        where: { listingId: id },
        select: { startDate: true, endDate: true },
      }),
    ]);

    if (!isRangeAvailable(startDate, endDate, blockingRanges(bookings, blocks))) return null;

    return tx.availabilityBlock.create({
      data: { listingId: id, startDate, endDate, reason: parsed.data.reason },
    });
  });

  if (!block) {
    return NextResponse.json(
      {
        error: roomTypeId
          ? "Those dates overlap an existing booking or block for this room type"
          : "Those dates overlap an existing booking or block",
      },
      { status: 409 },
    );
  }

  return NextResponse.json({ block }, { status: 201 });
}

export const POST = withApiErrorHandling(postHandler);
