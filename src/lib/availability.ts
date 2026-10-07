import { addDays, differenceInCalendarDays } from "date-fns";
import type { Prisma } from "@prisma/client";

export type BookedRange = { checkIn: Date; checkOut: Date };
export type RoomTypeBookedRange = BookedRange & { roomsBooked: number };

// A PENDING booking is created before the guest completes Stripe Checkout.
// Without an expiry, an abandoned checkout would block those dates for
// every other guest forever. CONFIRMED bookings always block; PENDING ones
// only block while recent enough that the guest might still complete it.
export const PENDING_BOOKING_HOLD_MINUTES = 30;

// Request-to-book (Listing.instantBook = false - see BookingApprovalStatus):
// how long a request holds its dates while the host hasn't yet responded.
// Much longer than PENDING_BOOKING_HOLD_MINUTES since a host, unlike a
// guest mid-checkout, isn't expected to be online right now.
export const REQUEST_HOLD_HOURS = 24;

/**
 * Prisma `where` clause selecting bookings that currently block
 * availability. A PENDING booking's hold window depends on which stage of
 * request-to-book it's at (see BookingApprovalStatus): NONE (instant book,
 * the common case) holds from creation for PENDING_BOOKING_HOLD_MINUTES,
 * exactly as before this existed; AWAITING holds from creation for the
 * much longer REQUEST_HOLD_HOURS, since the host - not the guest - is who
 * needs time to respond; APPROVED holds from the moment of approval (not
 * the original request) for the same short PENDING_BOOKING_HOLD_MINUTES a
 * guest now has to actually pay. DECLINED/EXPIRED never appear here: both
 * flip the booking's own status to CANCELLED immediately, which already
 * never blocks.
 */
export function blockingBookingWhere(now: Date = new Date()) {
  const holdCutoff = new Date(now.getTime() - PENDING_BOOKING_HOLD_MINUTES * 60 * 1000);
  const requestCutoff = new Date(now.getTime() - REQUEST_HOLD_HOURS * 60 * 60 * 1000);
  return {
    OR: [
      { status: "CONFIRMED" as const },
      {
        status: "PENDING" as const,
        approvalStatus: "NONE" as const,
        createdAt: { gte: holdCutoff },
      },
      {
        status: "PENDING" as const,
        approvalStatus: "AWAITING" as const,
        createdAt: { gte: requestCutoff },
      },
      {
        status: "PENDING" as const,
        approvalStatus: "APPROVED" as const,
        hostRespondedAt: { gte: holdCutoff },
      },
    ],
  };
}

/**
 * Whether this PENDING booking still holds its dates right now - the same
 * rule as blockingBookingWhere, for a booking already loaded. Checkout uses
 * it to notice a hold that lapsed while the guest was away.
 */
export function isBookingHoldActive(
  booking: {
    status: string;
    approvalStatus: string;
    createdAt: Date;
    hostRespondedAt: Date | null;
  },
  now: Date = new Date(),
): boolean {
  if (booking.status === "CONFIRMED") return true;
  if (booking.status !== "PENDING") return false;
  const holdMs = PENDING_BOOKING_HOLD_MINUTES * 60 * 1000;
  if (booking.approvalStatus === "NONE") {
    return now.getTime() - booking.createdAt.getTime() <= holdMs;
  }
  if (booking.approvalStatus === "AWAITING") {
    return now.getTime() - booking.createdAt.getTime() <= REQUEST_HOLD_HOURS * 60 * 60 * 1000;
  }
  if (booking.approvalStatus === "APPROVED" && booking.hostRespondedAt) {
    return now.getTime() - booking.hostRespondedAt.getTime() <= holdMs;
  }
  return false;
}

export function rangesOverlap(
  aStart: Date,
  aEnd: Date,
  bStart: Date,
  bEnd: Date,
): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export function isRangeAvailable(
  checkIn: Date,
  checkOut: Date,
  bookedRanges: BookedRange[],
): boolean {
  if (checkOut <= checkIn) return false;
  return bookedRanges.every(
    (range) => !rangesOverlap(checkIn, checkOut, range.checkIn, range.checkOut),
  );
}

export function nightsBetween(checkIn: Date, checkOut: Date): number {
  return Math.max(0, differenceInCalendarDays(checkOut, checkIn));
}

/**
 * The RoomType analogue of `isRangeAvailable`: instead of a single yes/no
 * per listing, a room type has `totalRooms` identical physical rooms, and a
 * request for `requestedRooms` of them succeeds only if every night of the
 * stay has enough of that inventory left uncommitted. With `totalRooms = 1`
 * and every `roomsBooked = 1` this is exactly equivalent to
 * `isRangeAvailable` - a strict generalization, not a parallel rule.
 *
 * A host-set or iCal-imported block still closes the room type entirely for
 * its range, same all-or-nothing semantics as a block does today - blocks
 * aren't countable inventory, they're "not for sale at all" for that span.
 */
export function isRoomTypeRangeAvailable(
  checkIn: Date,
  checkOut: Date,
  requestedRooms: number,
  totalRooms: number,
  bookedRanges: RoomTypeBookedRange[],
  blocks: { startDate: Date; endDate: Date }[] = [],
): boolean {
  if (checkOut <= checkIn) return false;
  if (requestedRooms < 1 || requestedRooms > totalRooms) return false;
  if (blocks.some((b) => rangesOverlap(checkIn, checkOut, b.startDate, b.endDate))) return false;

  const overlapping = bookedRanges.filter((r) =>
    rangesOverlap(checkIn, checkOut, r.checkIn, r.checkOut),
  );
  for (let night = checkIn; night < checkOut; night = addDays(night, 1)) {
    const occupied = overlapping
      .filter((r) => r.checkIn <= night && night < r.checkOut)
      .reduce((sum, r) => sum + r.roomsBooked, 0);
    if (occupied + requestedRooms > totalRooms) return false;
  }
  return true;
}

/**
 * A listing's minimum/maximum stay rule, kept independent of
 * `isRangeAvailable` per the extension-point note on `blockingRanges` below -
 * this is "is this stay length allowed at all", not "is this date free".
 * `maxNights` of null means no cap. Returns the guest-facing rejection
 * reason, or null when the stay length is fine.
 */
export function stayLengthError(
  nights: number,
  listing: { minNights: number; maxNights: number | null },
): string | null {
  if (nights < listing.minNights) {
    return `This listing requires a minimum stay of ${listing.minNights} night${listing.minNights === 1 ? "" : "s"}`;
  }
  if (listing.maxNights !== null && nights > listing.maxNights) {
    return `This listing allows a maximum stay of ${listing.maxNights} night${listing.maxNights === 1 ? "" : "s"}`;
  }
  return null;
}

/**
 * Merges a listing's blocking Bookings and its host-set AvailabilityBlocks
 * into the single list of ranges `isRangeAvailable` checks against. To a
 * guest, a manually blocked date and a reserved one are indistinguishable:
 * both simply aren't bookable. Every call site that decides whether a date
 * range can be booked (the availability-check endpoint, booking creation,
 * change requests, search filtering, and the widget's disabled calendar
 * days) should build its range list through this function rather than
 * passing bookings alone, so a block is never accidentally left out of one
 * of them.
 *
 * Extension point: future rules that aren't "is this specific date already
 * spoken for" (minimum/maximum stay, an advance-booking window, buffer days
 * between stays, seasonal availability) don't belong here. They're
 * independent predicates over a candidate date range and a listing, not
 * more entries in this range list, so add them as their own pure functions
 * and have callers run them alongside `isRangeAvailable` rather than
 * folding them into this merge.
 */
export function blockingRanges(
  bookings: BookedRange[],
  blocks: { startDate: Date; endDate: Date }[] = [],
): BookedRange[] {
  return [...bookings, ...blocks.map((b) => ({ checkIn: b.startDate, checkOut: b.endDate }))];
}

/**
 * The blocks that close one of a hotel's room types: its own, plus every
 * listing-wide block (roomTypeId null). An iCal import or a PMS sync can't
 * know about FYStay's room types, so the blocks it creates are listing-wide -
 * and "the whole property is unavailable" has to close every room type, not
 * none of them. Callers pass the listing's blocks with roomTypeId selected;
 * other room types' own blocks are left out.
 */
export function blocksForRoomType<B extends { startDate: Date; endDate: Date }>(
  roomTypeBlocks: B[],
  listingBlocks: (B & { roomTypeId: string | null })[],
): B[] {
  return [...roomTypeBlocks, ...listingBlocks.filter((block) => block.roomTypeId === null)];
}

/**
 * Re-checks a specific booking's dates for availability at approval time
 * (a change-request or a request-to-book being approved), scoped correctly
 * for both booking shapes: a HOTEL booking (roomTypeId set) is checked
 * against that room type's own inventory count via
 * isRoomTypeRangeAvailable, never the whole listing - checking every
 * booking on the listing regardless of room type/capacity (as this used to)
 * rejects perfectly available dates the moment any other room type, or the
 * same room type with capacity to spare, has an overlapping booking, which
 * is the normal state of an operating hotel, not an edge case. A
 * non-hotel booking is checked exactly as before, via isRangeAvailable
 * against the whole listing.
 *
 * Takes a transaction client so a writer can run it inside
 * withListingAvailabilityLock (see availabilityLock.ts) - the check is only
 * a guarantee when it runs under that lock in the same transaction as the
 * write it guards.
 */
export async function isRequestedRangeStillAvailable(
  prisma: Prisma.TransactionClient,
  params: {
    listingId: string;
    roomTypeId: string | null;
    roomsBooked: number;
    excludeBookingId: string;
    checkIn: Date;
    checkOut: Date;
  },
): Promise<boolean> {
  const { listingId, roomTypeId, roomsBooked, excludeBookingId, checkIn, checkOut } = params;

  if (roomTypeId) {
    const [roomTypeBookings, roomTypeBlocks, roomType] = await Promise.all([
      prisma.booking.findMany({
        where: {
          roomTypeId,
          id: { not: excludeBookingId },
          checkIn: { lt: checkOut },
          checkOut: { gt: checkIn },
          ...blockingBookingWhere(),
        },
        select: { checkIn: true, checkOut: true, roomsBooked: true },
      }),
      // The room type's own blocks and every listing-wide one - see
      // blocksForRoomType.
      prisma.availabilityBlock.findMany({
        where: { OR: [{ roomTypeId }, { listingId, roomTypeId: null }] },
        select: { startDate: true, endDate: true },
      }),
      prisma.roomType.findUnique({ where: { id: roomTypeId }, select: { totalRooms: true } }),
    ]);
    return isRoomTypeRangeAvailable(
      checkIn,
      checkOut,
      roomsBooked,
      roomType?.totalRooms ?? 0,
      roomTypeBookings,
      roomTypeBlocks,
    );
  }

  const [otherBookings, blocks] = await Promise.all([
    prisma.booking.findMany({
      where: { listingId, id: { not: excludeBookingId }, ...blockingBookingWhere() },
      select: { checkIn: true, checkOut: true },
    }),
    prisma.availabilityBlock.findMany({
      where: { listingId },
      select: { startDate: true, endDate: true },
    }),
  ]);
  return isRangeAvailable(checkIn, checkOut, blockingRanges(otherBookings, blocks));
}
