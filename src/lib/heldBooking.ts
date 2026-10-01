import type { Prisma } from "@prisma/client";
import { PENDING_BOOKING_HOLD_MINUTES } from "@/lib/availability";

/**
 * A guest's own still-held, unpaid, instant-book booking for exactly this
 * stay - what a repeat attempt (a double-click, or Back from checkout then
 * Reserve again) should get back instead of colliding with its own hold as
 * "dates not available". Shared by the availability check and booking
 * creation so both agree on what counts as "your own hold".
 */
export function heldRepeatBookingWhere(
  params: {
    guestId: string;
    checkIn: Date;
    checkOut: Date;
    guests: number;
  } & ({ listingId: string; roomTypeId?: undefined } | { roomTypeId: string; roomsBooked: number; listingId?: undefined }),
  now: Date = new Date(),
): Prisma.BookingWhereInput {
  return {
    guestId: params.guestId,
    ...(params.roomTypeId
      ? { roomTypeId: params.roomTypeId, roomsBooked: params.roomsBooked }
      : { listingId: params.listingId, roomTypeId: null }),
    checkIn: params.checkIn,
    checkOut: params.checkOut,
    guests: params.guests,
    status: "PENDING",
    paymentStatus: "UNPAID",
    approvalStatus: "NONE",
    promoCodeId: null,
    createdAt: { gte: new Date(now.getTime() - PENDING_BOOKING_HOLD_MINUTES * 60 * 1000) },
  };
}
