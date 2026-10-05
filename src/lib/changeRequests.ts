import { computeBookingPricing, splitBookingChange } from "@/lib/pricing";
import { nightsBetween } from "@/lib/availability";

export type CancellableBooking = {
  status: string;
  checkIn: Date;
};

/** A guest may cancel a booking any time before its stay begins. */
export function canCancelBooking(booking: CancellableBooking, now: Date = new Date()): boolean {
  return (
    (booking.status === "PENDING" || booking.status === "CONFIRMED") && booking.checkIn > now
  );
}

export type ChangeableBooking = {
  status: string;
  checkIn: Date;
};

/**
 * A guest may request a date/guest change on a CONFIRMED, upcoming booking,
 * as long as it doesn't already have a pending request awaiting the host's
 * response.
 */
export function canRequestBookingChange(
  booking: ChangeableBooking,
  hasPendingRequest: boolean,
  now: Date = new Date(),
): boolean {
  return booking.status === "CONFIRMED" && booking.checkIn > now && !hasPendingRequest;
}

/** Positive: the guest owes more. Negative: the guest is due a refund. */
export function computePriceDeltaCents(params: {
  requestedNights: number;
  pricePerNightCents: number;
  cleaningFeeCents?: number;
  weeklyDiscountPercent?: number | null;
  monthlyDiscountPercent?: number | null;
  /** The booking's own snapshotted last-minute deal (Booking.lastMinuteDiscountPercent), kept through a change. */
  lastMinuteDiscountPercent?: number | null;
  currentTotalPriceCents: number;
}): number {
  const {
    requestedNights,
    pricePerNightCents,
    cleaningFeeCents,
    weeklyDiscountPercent,
    monthlyDiscountPercent,
    lastMinuteDiscountPercent,
    currentTotalPriceCents,
  } = params;
  const { totalPriceCents } = computeBookingPricing({
    nights: requestedNights,
    pricePerNightCents,
    cleaningFeeCents,
    weeklyDiscountPercent,
    monthlyDiscountPercent,
    lastMinuteDiscountPercent,
  });
  return totalPriceCents - currentTotalPriceCents;
}

/**
 * The booking's stay and price fields once a change is applied - shared by
 * a paid change (applyApprovedChange in the pay route) and a refunded or
 * no-cost one (respond/route.ts). The
 * service fee moves by FYStay's share of the difference and the night count
 * follows the new dates, so the booking's own breakdown stays true for any
 * later change, refund or receipt.
 */
export function bookingFieldsAfterChange(
  booking: Parameters<typeof splitBookingChange>[1],
  change: { requestedCheckIn: Date; requestedCheckOut: Date; requestedGuests: number; priceDeltaCents: number },
) {
  const { platformShareCents } = splitBookingChange(change.priceDeltaCents, booking);
  return {
    checkIn: change.requestedCheckIn,
    checkOut: change.requestedCheckOut,
    nights: nightsBetween(change.requestedCheckIn, change.requestedCheckOut),
    guests: change.requestedGuests,
    totalPriceCents: booking.totalPriceCents + change.priceDeltaCents,
    serviceFeeCents: booking.serviceFeeCents + platformShareCents,
  };
}
