import { applyDiscountsToApplicationFee } from "@/lib/pricing";

const MS_PER_DAY = 1000 * 60 * 60 * 24;

export type RevenueBooking = {
  totalPriceCents: number;
  serviceFeeCents: number;
  taxCents: number;
  creditAppliedCents: number;
  promoDiscountCents: number;
  refundedAmountCents: number | null;
  paymentStatus: "UNPAID" | "PAID" | "PARTIALLY_REFUNDED" | "REFUNDED";
};

/**
 * What the host actually earns from one booking, in cents - exactly what
 * Stripe transfers to them at checkout: the amount the guest paid minus
 * FYStay's application fee (the guest service fee and tax, less any
 * referral credit or promo code FYStay absorbs - see /api/checkout and
 * applyDiscountsToApplicationFee). That's the whole stay (every night,
 * after any weekly/monthly/last-minute discount) plus the cleaning fee. A
 * refund reduces this proportionally, on the assumption a refund returns
 * the same percentage of every line in the price breakdown (how
 * cancellation refunds are computed throughout this app - see
 * cancellationPolicy.ts).
 */
export function hostRevenueCents(booking: RevenueBooking): number {
  if (booking.paymentStatus === "UNPAID" || booking.totalPriceCents <= 0) return 0;
  const hostGrossCents = hostPayoutCents(booking);
  const refundedCents = booking.refundedAmountCents ?? 0;
  const keptFraction = Math.max(0, 1 - refundedCents / booking.totalPriceCents);
  return Math.round(hostGrossCents * keptFraction);
}

/** The host's transfer for a booking before any refund - the same sum /api/checkout sends to Stripe. */
export function hostPayoutCents(booking: Omit<RevenueBooking, "refundedAmountCents" | "paymentStatus">): number {
  const applicationFeeCents = applyDiscountsToApplicationFee(
    booking.serviceFeeCents + booking.taxCents,
    booking.creditAppliedCents + booking.promoDiscountCents,
  );
  return Math.max(0, booking.totalPriceCents - applicationFeeCents);
}

export type EarningsBooking = RevenueBooking & { checkIn: Date };

export type EarningsSummary = {
  totalCents: number;
  thisMonthCents: number;
  upcoming30DaysCents: number;
};

/**
 * totalCents: lifetime, every booking regardless of date.
 * thisMonthCents: bookings checking in during the reference date's calendar
 * month (a simple, stable "how much is this month's business worth" figure).
 * upcoming30DaysCents: bookings checking in over the next 30 days from the
 * reference date, a closer proxy for "what's coming up".
 */
export function summarizeEarnings(
  bookings: EarningsBooking[],
  referenceDate: Date = new Date(),
): EarningsSummary {
  const monthStart = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), 1);
  const monthEnd = new Date(referenceDate.getFullYear(), referenceDate.getMonth() + 1, 1);
  const upcomingEnd = new Date(referenceDate.getTime() + 30 * MS_PER_DAY);

  let totalCents = 0;
  let thisMonthCents = 0;
  let upcoming30DaysCents = 0;

  for (const booking of bookings) {
    const revenue = hostRevenueCents(booking);
    if (revenue === 0) continue;
    totalCents += revenue;
    if (booking.checkIn >= monthStart && booking.checkIn < monthEnd) {
      thisMonthCents += revenue;
    }
    if (booking.checkIn >= referenceDate && booking.checkIn < upcomingEnd) {
      upcoming30DaysCents += revenue;
    }
  }

  return { totalCents, thisMonthCents, upcoming30DaysCents };
}

export type OccupancyListing = { id: string; published: boolean };
export type OccupancyBooking = {
  listingId: string;
  checkIn: Date;
  checkOut: Date;
  status: "PENDING" | "CONFIRMED" | "CANCELLED" | "COMPLETED" | "REFUNDED";
};

function overlapNights(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): number {
  const start = aStart > bStart ? aStart : bStart;
  const end = aEnd < bEnd ? aEnd : bEnd;
  const ms = end.getTime() - start.getTime();
  return ms > 0 ? Math.round(ms / MS_PER_DAY) : 0;
}

/**
 * Booked nights across published listings, within [referenceDate,
 * referenceDate + windowDays), as a percentage of total available nights in
 * that window. Null (never 0) when there are no published listings, since
 * "0% occupied" and "nothing to occupy" mean very different things to a
 * host. Unpublished listings are excluded from both the numerator and
 * denominator - they're not open for booking, so they shouldn't drag the
 * rate down.
 */
export function computeOccupancyRate(params: {
  listings: OccupancyListing[];
  bookings: OccupancyBooking[];
  referenceDate?: Date;
  windowDays?: number;
}): number | null {
  const { listings, bookings, referenceDate = new Date(), windowDays = 30 } = params;
  const published = listings.filter((l) => l.published);
  if (published.length === 0) return null;

  const windowStart = new Date(
    referenceDate.getFullYear(),
    referenceDate.getMonth(),
    referenceDate.getDate(),
  );
  const windowEnd = new Date(windowStart.getTime() + windowDays * MS_PER_DAY);
  const publishedIds = new Set(published.map((l) => l.id));

  let bookedNights = 0;
  for (const booking of bookings) {
    if (!publishedIds.has(booking.listingId)) continue;
    if (booking.status !== "CONFIRMED" && booking.status !== "COMPLETED") continue;
    bookedNights += overlapNights(windowStart, windowEnd, booking.checkIn, booking.checkOut);
  }

  const availableNights = published.length * windowDays;
  return Math.round((bookedNights / availableNights) * 100);
}

export type ConversationForStats = {
  hostId: string;
  guestId: string;
  messages: { senderId: string; createdAt: Date }[];
};

export type HostResponseStats = {
  /** Null when the host has no guest-initiated conversations yet. */
  responseRate: number | null;
  /** Median minutes from a guest's first message to the host's first reply, across conversations that got one. Null when none did. */
  medianResponseMinutes: number | null;
};

function median(numbers: number[]): number {
  const sorted = [...numbers].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Only counts conversations a guest actually started (their message comes
 * first) - a conversation the host opened themselves isn't a test of how
 * responsive they are to guests. Response rate is "did the host ever reply
 * at all", not bounded to any particular window, matching what this
 * schema can actually attest to; medianResponseMinutes is computed only
 * over conversations that did get a reply, so one guest the host never
 * answered doesn't silently vanish from the rate but also doesn't drag
 * the timing figure toward infinity.
 */
export function computeHostResponseStats(conversations: ConversationForStats[]): HostResponseStats {
  const guestInitiated = conversations
    .map((c) => ({ ...c, messages: [...c.messages].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()) }))
    .filter((c) => c.messages.length > 0 && c.messages[0].senderId === c.guestId);

  if (guestInitiated.length === 0) {
    return { responseRate: null, medianResponseMinutes: null };
  }

  const responseMinutes: number[] = [];
  for (const conversation of guestInitiated) {
    const guestFirstMessage = conversation.messages[0];
    const hostReply = conversation.messages.find(
      (m) => m.senderId === conversation.hostId && m.createdAt > guestFirstMessage.createdAt,
    );
    if (hostReply) {
      responseMinutes.push((hostReply.createdAt.getTime() - guestFirstMessage.createdAt.getTime()) / 60_000);
    }
  }

  return {
    responseRate: Math.round((responseMinutes.length / guestInitiated.length) * 100),
    medianResponseMinutes: responseMinutes.length > 0 ? median(responseMinutes) : null,
  };
}

/** Airbnb-style bucketed phrasing rather than a raw "47 minutes" figure, which reads as more precise than a median of a handful of replies actually supports. */
export function formatResponseTime(minutes: number): string {
  if (minutes <= 60) return "within an hour";
  if (minutes <= 6 * 60) return "within a few hours";
  if (minutes <= 24 * 60) return "within a day";
  return "within a few days";
}

// Deliberately below Airbnb's own Superhost bar (10 trips / 4.8 / 90%
// response) - this app has nowhere near Airbnb's volume of hosts or
// bookings, and a badge that's practically unreachable is worse than no
// badge at all. "Great Host" (not "Superhost") on purpose: that name is
// Airbnb's own trademark, and this isn't the same program.
export const GREAT_HOST_MIN_COMPLETED_BOOKINGS = 5;
export const GREAT_HOST_MIN_AVERAGE_RATING = 4.8;
export const GREAT_HOST_MIN_RESPONSE_RATE = 90;

export type GreatHostCriteria = {
  completedBookings: number;
  averageRating: number | null;
  responseRate: number | null;
};

/**
 * A host-wide, not listing-wide, distinction - the same reasoning as
 * hostReviewCount/computeHostResponseStats elsewhere in this file. Every
 * threshold has to be actually met, not just "on average" - a host with
 * a great rating but who never replies to messages isn't what this badge
 * is meant to promise a guest.
 */
export function isGreatHost(criteria: GreatHostCriteria): boolean {
  return (
    criteria.completedBookings >= GREAT_HOST_MIN_COMPLETED_BOOKINGS &&
    criteria.averageRating !== null &&
    criteria.averageRating >= GREAT_HOST_MIN_AVERAGE_RATING &&
    criteria.responseRate !== null &&
    criteria.responseRate >= GREAT_HOST_MIN_RESPONSE_RATE
  );
}
