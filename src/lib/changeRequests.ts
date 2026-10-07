import type { Prisma } from "@prisma/client";
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

export const BOOKING_NOT_CHANGEABLE_MESSAGE =
  "This booking can no longer be changed - it has been cancelled or the stay has started.";

/**
 * Whether a change already asked for can still go ahead - approved, paid
 * for, or applied: the booking must still be CONFIRMED and not yet begun,
 * the same rule as asking for one (canRequestBookingChange). A booking
 * cancelled after the guest asked must never have new dates applied to it or
 * a difference refunded on top of its cancellation refund.
 */
export function isBookingStillChangeable(booking: ChangeableBooking, now: Date = new Date()): boolean {
  return booking.status === "CONFIRMED" && booking.checkIn > now;
}

/**
 * What a booking cost before referral credit and promo code discounts - the
 * figure a change's new price is compared with. Those discounts were spent
 * once, on the original booking, and stay with it: comparing a re-priced stay
 * against the discounted total would charge them back as a "difference".
 */
export function bookingGrossTotalCents(booking: {
  totalPriceCents: number;
  creditAppliedCents: number;
  promoDiscountCents: number;
}): number {
  return booking.totalPriceCents + booking.creditAppliedCents + booking.promoDiscountCents;
}

/**
 * The price difference for changing a booking to `requestedNights`, priced
 * like for like: the booking's own snapshotted nightly rate (the whole
 * reservation's, rooms included), cleaning fee and last-minute deal - not
 * the listing's rate today, which the host may have changed since - and
 * compared with the booking's gross total. So a change of dates for the same
 * number of nights costs nothing, whatever the listing charges now.
 *
 * Weekly/monthly percentages aren't snapshotted on a booking, so the
 * listing's current ones decide whether a longer or shorter stay qualifies.
 *
 * The discounts stay fixed amounts off the new stay, so a refund can't be
 * more than the guest actually paid: a shorter stay that now costs less
 * than the credit and promo already applied refunds everything paid and
 * no more.
 */
export function changePriceDeltaCents(
  booking: {
    nightlyPriceCents: number;
    cleaningFeeCents: number;
    lastMinuteDiscountPercent: number | null;
    totalPriceCents: number;
    creditAppliedCents: number;
    promoDiscountCents: number;
  },
  listing: { weeklyDiscountPercent: number | null; monthlyDiscountPercent: number | null },
  requestedNights: number,
): number {
  const grossDeltaCents = computePriceDeltaCents({
    requestedNights,
    pricePerNightCents: booking.nightlyPriceCents,
    cleaningFeeCents: booking.cleaningFeeCents,
    weeklyDiscountPercent: listing.weeklyDiscountPercent,
    monthlyDiscountPercent: listing.monthlyDiscountPercent,
    lastMinuteDiscountPercent: booking.lastMinuteDiscountPercent,
    currentTotalPriceCents: bookingGrossTotalCents(booking),
  });
  return Math.max(grossDeltaCents, -booking.totalPriceCents);
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

/**
 * A change request still in flight: awaiting the host, or approved with a
 * difference the guest hasn't paid yet. A booking has at most one of these
 * at a time - each request's price difference is worked out against the
 * booking as it stood when the guest asked, so a second one approved or
 * paid alongside it would stack its difference on top of a stay the first
 * had already changed.
 */
export const OUTSTANDING_CHANGE_REQUEST_WHERE = {
  OR: [{ status: "PENDING" }, { status: "APPROVED", paidAt: null, priceDeltaCents: { gt: 0 } }],
} satisfies Prisma.BookingChangeRequestWhereInput;

export const CHANGE_REQUEST_IN_PROGRESS_MESSAGE =
  "This booking already has a date change in progress - withdraw it or finish paying for it first.";

/**
 * Whether the booking is still exactly the stay a change request was priced
 * against (its original* snapshot). Once any other change has moved its
 * dates or total, this request's difference no longer describes the move
 * from here to its requested dates, so it must not be applied.
 */
export function bookingMatchesChangeSnapshot(
  booking: { checkIn: Date; checkOut: Date; totalPriceCents: number },
  change: { originalCheckIn: Date; originalCheckOut: Date; originalTotalPriceCents: number },
): boolean {
  return (
    booking.checkIn.getTime() === change.originalCheckIn.getTime() &&
    booking.checkOut.getTime() === change.originalCheckOut.getTime() &&
    booking.totalPriceCents === change.originalTotalPriceCents
  );
}
