import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import {
  blockingBookingWhere,
  blockingRanges,
  blocksForRoomType,
  isRangeAvailable,
  isRoomTypeRangeAvailable,
  nightsBetween,
  stayLengthError,
} from "@/lib/availability";
import {
  canRequestBookingChange,
  CHANGE_REQUEST_IN_PROGRESS_MESSAGE,
  changePriceDeltaCents,
  OUTSTANDING_CHANGE_REQUEST_WHERE,
} from "@/lib/changeRequests";
import { withListingAvailabilityLock } from "@/lib/availabilityLock";
import { withApiErrorHandling } from "@/lib/apiError";
import { parseStayDate, todayStayDate } from "@/lib/stayDates";

const createChangeRequestSchema = z.object({
  checkIn: z.string().min(1),
  checkOut: z.string().min(1),
  guests: z.number().int().min(1),
});

async function postHandler(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const parsed = createChangeRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const checkIn = parseStayDate(parsed.data.checkIn);
  const checkOut = parseStayDate(parsed.data.checkOut);
  if (!checkIn || !checkOut) {
    return NextResponse.json({ error: "Invalid dates" }, { status: 400 });
  }
  // Same rule as a new booking: a stay can't be moved into the past.
  if (checkIn < todayStayDate()) {
    return NextResponse.json({ error: "Check-in date must be in the future" }, { status: 400 });
  }

  const booking = await prisma.booking.findUnique({
    where: { id },
    include: {
      listing: {
        include: {
          bookings: {
            where: blockingBookingWhere(),
            select: { id: true, checkIn: true, checkOut: true },
          },
          availabilityBlocks: { select: { startDate: true, endDate: true, roomTypeId: true } },
        },
      },
      roomType: {
        include: {
          bookings: {
            where: blockingBookingWhere(),
            select: { id: true, checkIn: true, checkOut: true, roomsBooked: true },
          },
          availabilityBlocks: { select: { startDate: true, endDate: true } },
        },
      },
      changeRequests: { where: OUTSTANDING_CHANGE_REQUEST_WHERE, select: { id: true } },
    },
  });

  if (!booking) {
    return NextResponse.json({ error: "Booking not found" }, { status: 404 });
  }
  if (booking.guestId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (booking.changeRequests.length > 0) {
    return NextResponse.json({ error: CHANGE_REQUEST_IN_PROGRESS_MESSAGE }, { status: 409 });
  }
  if (!canRequestBookingChange(booking, false)) {
    return NextResponse.json(
      { error: "This booking isn't eligible for a change request right now" },
      { status: 409 },
    );
  }

  // A HOTEL booking (booking.roomTypeId set) is scoped to its own room
  // type's capacity/inventory/rate throughout this route, never the
  // listing's aggregate fields (min price / max capacity across room
  // types) - see api/bookings/route.ts's createRoomTypeBooking for the
  // same distinction at creation time.
  const { roomType } = booking;
  const maxGuests = roomType ? roomType.maxGuests * booking.roomsBooked : booking.listing.maxGuests;
  if (parsed.data.guests > maxGuests) {
    return NextResponse.json(
      { error: `This ${roomType ? "room type" : "listing"} sleeps up to ${maxGuests} guests` },
      { status: 400 },
    );
  }

  const nights = nightsBetween(checkIn, checkOut);
  const lengthError = stayLengthError(nights, booking.listing);
  if (lengthError) {
    return NextResponse.json({ error: lengthError }, { status: 400 });
  }

  const isAvailable = roomType
    ? isRoomTypeRangeAvailable(
        checkIn,
        checkOut,
        booking.roomsBooked,
        roomType.totalRooms,
        roomType.bookings.filter((b) => b.id !== booking.id),
        blocksForRoomType(roomType.availabilityBlocks, booking.listing.availabilityBlocks),
      )
    : isRangeAvailable(
        checkIn,
        checkOut,
        blockingRanges(
          booking.listing.bookings.filter((b) => b.id !== booking.id),
          booking.listing.availabilityBlocks,
        ),
      );
  if (!isAvailable) {
    return NextResponse.json({ error: "Those dates are not available" }, { status: 409 });
  }
  // Priced at the booking's own snapshotted rate and compared with its total
  // before credit/promo discounts - see changePriceDeltaCents. (This used to
  // price the new stay at the listing's rate today against the discounted
  // total, so a same-length change could charge the guest their discount
  // again, or a host's later price rise.)
  const priceDeltaCents = changePriceDeltaCents(booking, booking.listing, { checkIn, checkOut });

  // The in-progress check above is repeated under the listing's lock, so two
  // requests sent at once (a double submit, two tabs) can't both be created.
  const changeRequest = await withListingAvailabilityLock(prisma, booking.listingId, async (tx) => {
    const outstanding = await tx.bookingChangeRequest.count({
      where: { bookingId: booking.id, ...OUTSTANDING_CHANGE_REQUEST_WHERE },
    });
    if (outstanding > 0) return null;
    return tx.bookingChangeRequest.create({
      data: {
        bookingId: booking.id,
        requestedCheckIn: checkIn,
        requestedCheckOut: checkOut,
        requestedGuests: parsed.data.guests,
        priceDeltaCents,
        // Snapshotted now, since the booking itself gets overwritten once this
        // request is approved and applied - without this, "original vs new"
        // couldn't be shown accurately after the fact.
        originalCheckIn: booking.checkIn,
        originalCheckOut: booking.checkOut,
        originalGuests: booking.guests,
        originalTotalPriceCents: booking.totalPriceCents,
      },
    });
  });
  if (!changeRequest) {
    return NextResponse.json({ error: CHANGE_REQUEST_IN_PROGRESS_MESSAGE }, { status: 409 });
  }

  return NextResponse.json({ changeRequest }, { status: 201 });
}

export const POST = withApiErrorHandling(postHandler);
