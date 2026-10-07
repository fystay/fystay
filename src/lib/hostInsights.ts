import { hostPayoutCents, hostRevenueCents, type RevenueBooking } from "@/lib/hostStats";

/**
 * Everything the host dashboard, bookings and earnings pages show about a
 * host's business, computed from their own bookings - pure functions, so
 * every figure on those pages is unit-tested rather than assembled inline.
 *
 * Conventions, so the figures agree with each other everywhere:
 * - Money is the host's share (hostRevenueCents): what Stripe transfers to
 *   them, after any refund. Never the guest's total.
 * - A stay counts towards the month it checks in (Airbnb's convention, and
 *   the one the dashboard already used), so a month's figure doesn't move
 *   about as a stay spans a month boundary.
 * - Stay dates are calendar dates stored as UTC midnight (stayDates.ts);
 *   "today" is the date in the UK, where every FYStay listing is.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export type InsightBooking = RevenueBooking & {
  id: string;
  reference: string;
  listingId: string;
  status: "PENDING" | "CONFIRMED" | "CANCELLED" | "COMPLETED" | "REFUNDED";
  approvalStatus: "NONE" | "AWAITING" | "APPROVED" | "DECLINED" | "EXPIRED";
  paidAt: Date | null;
  checkIn: Date;
  checkOut: Date;
  nights: number;
  guests: number;
  guestName: string;
  nightlyPriceCents: number;
  lengthOfStayDiscountCents: number;
  roomsBooked: number;
  createdAt: Date;
};

export type InsightListing = {
  id: string;
  title: string;
  published: boolean;
  suspendedAt: Date | null;
  /** Bookable units: 1 for a home, the total rooms across room types for a hotel. */
  units: number;
};

/** The UK calendar date of `now`, as that date's UTC midnight (how stay dates are stored). */
export function ukToday(now: Date = new Date()): Date {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return new Date(Date.UTC(get("year"), get("month") - 1, get("day")));
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

/** [start, end) of the month `offset` months from the one containing `day`. */
export function monthRange(day: Date, offset = 0): { start: Date; end: Date } {
  const start = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth() + offset, 1));
  const end = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth() + offset + 1, 1));
  return { start, end };
}

/** A stay that's happening or happened: paid for and not cancelled. */
export function isLiveStay(b: Pick<InsightBooking, "status">): boolean {
  return b.status === "CONFIRMED" || b.status === "COMPLETED";
}

function overlapNights(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): number {
  const start = Math.max(aStart.getTime(), bStart.getTime());
  const end = Math.min(aEnd.getTime(), bEnd.getTime());
  return end > start ? Math.round((end - start) / DAY_MS) : 0;
}

// --- Today ------------------------------------------------------------------

export type TodayView<B> = {
  arrivals: B[];
  departures: B[];
  inHouse: B[];
  /** Published listings with a guest staying tonight. */
  occupiedTonight: number;
  /** Published, unsuspended listings. */
  bookableListings: number;
};

export function todayView<B extends InsightBooking>(
  listings: InsightListing[],
  bookings: B[],
  today: Date,
): TodayView<B> {
  const live = bookings.filter(isLiveStay);
  const day = today.getTime();
  const arrivals = live.filter((b) => b.checkIn.getTime() === day);
  const departures = live.filter((b) => b.checkOut.getTime() === day);
  const inHouse = live.filter((b) => b.checkIn.getTime() <= day && b.checkOut.getTime() > day);
  const bookable = listings.filter((l) => l.published && !l.suspendedAt);
  const bookableIds = new Set(bookable.map((l) => l.id));
  const occupied = new Set(inHouse.filter((b) => bookableIds.has(b.listingId)).map((b) => b.listingId));
  return {
    arrivals,
    departures,
    inHouse,
    occupiedTonight: occupied.size,
    bookableListings: bookable.length,
  };
}

// --- Money and performance over a period ------------------------------------

export type PeriodSummary = {
  /** Host's share of stays checking in in the period, after refunds. */
  earnedCents: number;
  /** The part of earnedCents for stays that have already started. */
  hostedCents: number;
  /** The part still to come (checks in after today). */
  upcomingCents: number;
  bookings: number;
  nights: number;
  /** Nightly rate guests paid, after length-of-stay discounts. Null with no stays. */
  averageNightlyCents: number | null;
  /** Host's share per booking. Null with no stays. */
  averageBookingCents: number | null;
  averageStayNights: number | null;
  /** Paid bookings in the period that were later cancelled, as a %. Null with none paid. */
  cancellationRate: number | null;
  // The money breakdown behind earnedCents, for the "where did this come from" view.
  guestPaidCents: number;
  fystayFeeCents: number;
  refundedCents: number;
};

export function summarizePeriod(bookings: InsightBooking[], start: Date, end: Date, today: Date): PeriodSummary {
  const inPeriod = bookings.filter((b) => b.checkIn >= start && b.checkIn < end && b.paidAt !== null);
  const live = inPeriod.filter(isLiveStay);
  const cancelled = inPeriod.filter((b) => b.status === "CANCELLED");

  let earnedCents = 0;
  let hostedCents = 0;
  let guestPaidCents = 0;
  let fystayFeeCents = 0;
  let refundedCents = 0;
  // Cancelled-but-partly-kept bookings still earn the host their share of
  // what wasn't refunded - counted in money, not in stays or nights.
  for (const b of inPeriod) {
    const net = hostRevenueCents(b);
    earnedCents += net;
    if (b.checkIn <= today) hostedCents += net;
    if (net > 0 || isLiveStay(b)) {
      guestPaidCents += b.totalPriceCents;
      refundedCents += b.refundedAmountCents ?? 0;
      fystayFeeCents += b.totalPriceCents - (b.refundedAmountCents ?? 0) - net;
    }
  }

  const nights = live.reduce((sum, b) => sum + b.nights * b.roomsBooked, 0);
  const roomRevenue = live.reduce(
    (sum, b) => sum + b.nightlyPriceCents * b.nights - b.lengthOfStayDiscountCents,
    0,
  );
  const liveNights = live.reduce((sum, b) => sum + b.nights, 0);

  return {
    earnedCents,
    hostedCents,
    upcomingCents: earnedCents - hostedCents,
    bookings: live.length,
    nights,
    averageNightlyCents: liveNights > 0 ? Math.round(roomRevenue / liveNights) : null,
    averageBookingCents: live.length > 0 ? Math.round(live.reduce((s, b) => s + hostRevenueCents(b), 0) / live.length) : null,
    averageStayNights: live.length > 0 ? Math.round((liveNights / live.length) * 10) / 10 : null,
    cancellationRate:
      live.length + cancelled.length > 0
        ? Math.round((cancelled.length / (live.length + cancelled.length)) * 100)
        : null,
    guestPaidCents,
    fystayFeeCents: Math.max(0, fystayFeeCents),
    refundedCents,
  };
}

export type Occupancy = { bookedNights: number; availableNights: number; rate: number | null };

/**
 * Booked unit-nights over [start, end) across published listings, against
 * every unit-night they had (rooms × nights for a hotel). Null when nothing
 * was bookable - "0% full" and "nothing to fill" mean different things.
 */
export function occupancy(listings: InsightListing[], bookings: InsightBooking[], start: Date, end: Date): Occupancy {
  const open = listings.filter((l) => l.published && !l.suspendedAt);
  const openIds = new Set(open.map((l) => l.id));
  const days = Math.round((end.getTime() - start.getTime()) / DAY_MS);
  const availableNights = open.reduce((sum, l) => sum + l.units * days, 0);
  let bookedNights = 0;
  for (const b of bookings) {
    if (!isLiveStay(b) || !openIds.has(b.listingId)) continue;
    bookedNights += overlapNights(start, end, b.checkIn, b.checkOut) * b.roomsBooked;
  }
  bookedNights = Math.min(bookedNights, availableNights);
  return {
    bookedNights,
    availableNights,
    rate: availableNights > 0 ? Math.round((bookedNights / availableNights) * 100) : null,
  };
}

export type MonthPoint = { start: Date; earnedCents: number };

/** The host's share by check-in month, for the last `months` months up to and including today's. */
export function monthlyEarnings(bookings: InsightBooking[], today: Date, months = 12): MonthPoint[] {
  const points: MonthPoint[] = [];
  for (let offset = -(months - 1); offset <= 0; offset++) {
    const { start, end } = monthRange(today, offset);
    let earnedCents = 0;
    for (const b of bookings) {
      if (b.checkIn >= start && b.checkIn < end) earnedCents += hostRevenueCents(b);
    }
    points.push({ start, earnedCents });
  }
  return points;
}

/** Highest month ever, by check-in, excluding the current one. Null with no earning month. */
export function bestPastMonth(bookings: InsightBooking[], today: Date): MonthPoint | null {
  const current = monthRange(today).start.getTime();
  const byMonth = new Map<number, number>();
  for (const b of bookings) {
    const net = hostRevenueCents(b);
    if (net <= 0) continue;
    const month = Date.UTC(b.checkIn.getUTCFullYear(), b.checkIn.getUTCMonth(), 1);
    if (month >= current) continue;
    byMonth.set(month, (byMonth.get(month) ?? 0) + net);
  }
  let best: MonthPoint | null = null;
  for (const [month, earnedCents] of byMonth) {
    if (!best || earnedCents > best.earnedCents) best = { start: new Date(month), earnedCents };
  }
  return best;
}

export type ListingPerformance = {
  listingId: string;
  earnedCents: number;
  bookings: number;
  occupancyRate: number | null;
};

export function listingPerformance(
  listings: InsightListing[],
  bookings: InsightBooking[],
  start: Date,
  end: Date,
  today: Date,
): ListingPerformance[] {
  return listings.map((listing) => {
    const own = bookings.filter((b) => b.listingId === listing.id);
    const summary = summarizePeriod(own, start, end, today);
    return {
      listingId: listing.id,
      earnedCents: summary.earnedCents,
      bookings: summary.bookings,
      occupancyRate: occupancy([listing], own, start, end).rate,
    };
  });
}

/** Percentage change, rounded; null when there's no base to compare with. */
export function percentChange(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

// --- Encouragement ----------------------------------------------------------

export type Highlight = { kind: "milestone" | "trend" | "streak" | "nudge"; text: string };

/**
 * Up to three short, true statements about how the host is doing - the
 * dashboard's light touch of motivation. Every one is derived from the
 * host's own figures and only shown when it's good news or a clear next
 * step; nothing is invented, and nothing nags.
 */
export function highlights(input: {
  thisMonth: PeriodSummary;
  lastMonthCents: number;
  best: MonthPoint | null;
  occupancyNow: number | null;
  occupancyLastMonth: number | null;
  averageRating: number | null;
  reviewCount: number;
  upcomingStays: number;
  formatMoney: (cents: number) => string;
}): Highlight[] {
  const out: Highlight[] = [];
  const { thisMonth, best, formatMoney } = input;

  if (best && thisMonth.earnedCents > 0) {
    if (thisMonth.earnedCents > best.earnedCents) {
      out.push({ kind: "milestone", text: "This is your best month yet." });
    } else {
      const gap = best.earnedCents - thisMonth.earnedCents;
      if (gap <= best.earnedCents * 0.5) {
        out.push({ kind: "milestone", text: `You're ${formatMoney(gap)} away from your best month.` });
      }
    }
  }

  const change = percentChange(thisMonth.earnedCents, input.lastMonthCents);
  if (change !== null && change >= 5) {
    out.push({ kind: "trend", text: `Earnings are up ${change}% on last month.` });
  } else if (
    input.occupancyNow !== null &&
    input.occupancyLastMonth !== null &&
    input.occupancyNow - input.occupancyLastMonth >= 5
  ) {
    out.push({
      kind: "trend",
      text: `Occupancy is up ${input.occupancyNow - input.occupancyLastMonth} points on last month.`,
    });
  }

  if (input.averageRating !== null && input.averageRating >= 4.7 && input.reviewCount >= 3) {
    out.push({
      kind: "streak",
      text: `Guests rate you ${input.averageRating.toFixed(1)}★ across ${input.reviewCount} reviews.`,
    });
  }

  if (out.length < 3 && input.upcomingStays > 0) {
    out.push({
      kind: "nudge",
      text: `${input.upcomingStays} upcoming stay${input.upcomingStays === 1 ? "" : "s"} booked.`,
    });
  }

  return out.slice(0, 3);
}

// --- Listing quality --------------------------------------------------------

export type HealthListing = {
  id: string;
  description: string;
  photos: string[];
  amenities: string[];
  address: string | null;
  checkInTime: string | null;
  checkInInstructions: string | null;
  quietHoursStart: string | null;
  additionalRules: string | null;
  weeklyDiscountPercent: number | null;
  cleaningFeeCents: number;
};

export type HealthItem = { key: string; label: string; done: boolean; hint: string };

export const MIN_GOOD_PHOTOS = 5;
export const MIN_GOOD_DESCRIPTION = 200;
export const MIN_GOOD_AMENITIES = 6;

/**
 * What makes a listing convert - the same things Airbnb's listing-quality
 * checklist looks at, limited to what FYStay's listing form can actually
 * hold. Each item carries the one-line reason it matters, so the checklist
 * reads as advice rather than a form to fill in.
 */
export function listingHealth(listing: HealthListing): { score: number; items: HealthItem[] } {
  const items: HealthItem[] = [
    {
      key: "photos",
      label: `At least ${MIN_GOOD_PHOTOS} photos`,
      done: listing.photos.length >= MIN_GOOD_PHOTOS,
      hint: "Guests decide from the photos first - show every room.",
    },
    {
      key: "description",
      label: "A full description",
      done: listing.description.trim().length >= MIN_GOOD_DESCRIPTION,
      hint: "Say what's special about the place and the area.",
    },
    {
      key: "amenities",
      label: `${MIN_GOOD_AMENITIES}+ amenities`,
      done: listing.amenities.length >= MIN_GOOD_AMENITIES,
      hint: "Search filters use amenities - list everything you offer.",
    },
    {
      key: "address",
      label: "Address",
      done: Boolean(listing.address?.trim()),
      hint: "Shared with guests only once they've booked.",
    },
    {
      key: "checkin",
      label: "Check-in time and instructions",
      done: Boolean(listing.checkInTime?.trim()) && Boolean(listing.checkInInstructions?.trim()),
      hint: "Fewer questions from guests on arrival day.",
    },
    {
      key: "rules",
      label: "House rules",
      done: Boolean(listing.quietHoursStart?.trim()) || Boolean(listing.additionalRules?.trim()),
      hint: "Clear expectations mean fewer surprises for both sides.",
    },
    {
      key: "weekly",
      label: "A weekly discount",
      done: (listing.weeklyDiscountPercent ?? 0) > 0,
      hint: "Longer stays mean fewer changeovers.",
    },
  ];
  const score = Math.round((items.filter((i) => i.done).length / items.length) * 100);
  return { score, items };
}

/** Host's share before refunds - re-exported so pages don't reach into hostStats for it. */
export { hostPayoutCents, hostRevenueCents };
