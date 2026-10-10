import { hostPayoutCents, hostRevenueCents, type RevenueBooking } from "@/lib/hostStats";
import { bookingNightlySubtotalCents } from "@/lib/pricing";

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
  /** When money last went back to the guest; tells a refunded cancellation from a payment refunded on arrival. */
  refundedAt?: Date | null;
  checkIn: Date;
  checkOut: Date;
  nights: number;
  guests: number;
  guestName: string;
  nightlyPriceCents: number;
  weekendNights?: number;
  weekendNightlyPriceCents?: number | null;
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

/**
 * A stay the host had and then lost to a cancellation - what the
 * cancellation rate counts. Not every CANCELLED booking with a payment is
 * one: a payment that could never confirm its booking (the dates were taken
 * by the time it landed, the amount was wrong, the booking had already
 * lapsed) is refunded in full by the Stripe webhook in the same write that
 * records it, so the host never had that stay. Told apart by:
 * - PAID / PARTIALLY_REFUNDED: the guest kept some money in, which only a
 *   cancellation of a confirmed stay under its policy does;
 * - REFUNDED: a cancellation refunds some time after the stay was paid and
 *   confirmed, whereas the webhook's paidAt and refundedAt are written
 *   together - so a refund more than a minute after payment counts.
 */
const REFUNDED_ON_ARRIVAL_MS = 60 * 1000;

function wasCancelledAfterConfirming(b: InsightBooking): boolean {
  if (b.status !== "CANCELLED") return false;
  if (b.paymentStatus === "PAID" || b.paymentStatus === "PARTIALLY_REFUNDED") return true;
  if (b.paymentStatus !== "REFUNDED" || !b.paidAt || !b.refundedAt) return false;
  return b.refundedAt.getTime() - b.paidAt.getTime() > REFUNDED_ON_ARRIVAL_MS;
}

export function summarizePeriod(bookings: InsightBooking[], start: Date, end: Date, today: Date): PeriodSummary {
  const inPeriod = bookings.filter(
    (b) => b.checkIn >= start && b.checkIn < end && (b.paidAt !== null || b.paymentStatus !== "UNPAID" || isLiveStay(b)),
  );
  const live = inPeriod.filter(isLiveStay);
  const cancelled = inPeriod.filter(wasCancelledAfterConfirming);

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
    (sum, b) => sum + bookingNightlySubtotalCents(b) - b.lengthOfStayDiscountCents,
    0,
  );
  const liveNights = live.reduce((sum, b) => sum + b.nights, 0);

  return {
    earnedCents,
    hostedCents,
    upcomingCents: earnedCents - hostedCents,
    bookings: live.length,
    nights,
    // Averages in whole pounds: "£74.86 a night" is false precision.
    averageNightlyCents: liveNights > 0 ? Math.round(roomRevenue / liveNights / 100) * 100 : null,
    averageBookingCents:
      live.length > 0 ? Math.round(live.reduce((s, b) => s + hostRevenueCents(b), 0) / live.length / 100) * 100 : null,
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
      // Credit for what every new listing already has, so a host who has
      // just filled in the form doesn't see "0% complete".
      key: "basics",
      label: "Title, description, price and a photo",
      done: listing.photos.length > 0 && listing.description.trim().length > 0,
      hint: "The essentials guests need to find and book you.",
    },
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

// --- Earnings periods -------------------------------------------------------

export type PeriodKey = "today" | "week" | "month" | "last-month" | "year" | "custom";

export type Period = {
  key: PeriodKey;
  label: string;
  start: Date;
  end: Date;
  /** The same length of time immediately before, for "vs" comparisons. Null for custom ranges. */
  previous: { start: Date; end: Date; label: string } | null;
};

const MAX_CUSTOM_DAYS = 3 * 366;

/**
 * [start, end) for each earnings period, in UK calendar dates. Weeks start
 * on Monday. A custom range is inclusive of both picked dates, capped at
 * three years, and falls back to this month if it's missing or backwards.
 */
export function earningsPeriod(key: string | undefined, today: Date, from?: Date | null, to?: Date | null): Period {
  const month = monthRange(today);
  const monthLabel = (d: Date) => d.toLocaleString("en-GB", { month: "long", timeZone: "UTC" });
  switch (key) {
    case "today":
      return {
        key: "today",
        label: "Today",
        start: today,
        end: addDays(today, 1),
        previous: { start: addDays(today, -7), end: addDays(today, -6), label: "the same day last week" },
      };
    case "week": {
      const start = addDays(today, -((today.getUTCDay() + 6) % 7));
      return {
        key: "week",
        label: "This week",
        start,
        end: addDays(start, 7),
        previous: { start: addDays(start, -7), end: start, label: "last week" },
      };
    }
    case "last-month": {
      const last = monthRange(today, -1);
      const before = monthRange(today, -2);
      return {
        key: "last-month",
        label: monthLabel(last.start),
        start: last.start,
        end: last.end,
        previous: { ...before, label: monthLabel(before.start) },
      };
    }
    case "year": {
      const start = new Date(Date.UTC(today.getUTCFullYear(), 0, 1));
      const end = new Date(Date.UTC(today.getUTCFullYear() + 1, 0, 1));
      return {
        key: "year",
        label: String(today.getUTCFullYear()),
        start,
        end,
        previous: {
          start: new Date(Date.UTC(today.getUTCFullYear() - 1, 0, 1)),
          end: start,
          label: String(today.getUTCFullYear() - 1),
        },
      };
    }
    case "custom":
      if (from && to && to >= from && to.getTime() - from.getTime() <= MAX_CUSTOM_DAYS * DAY_MS) {
        return { key: "custom", label: "Custom range", start: from, end: addDays(to, 1), previous: null };
      }
    // falls through to this month
    default: {
      const last = monthRange(today, -1);
      return {
        key: "month",
        label: monthLabel(month.start),
        start: month.start,
        end: month.end,
        previous: { ...last, label: monthLabel(last.start) },
      };
    }
  }
}

// --- Calendar conflicts -----------------------------------------------------

export type CalendarBlock = {
  id: string;
  listingId: string;
  roomTypeId: string | null;
  startDate: Date;
  endDate: Date;
  source: "HOST" | "ICAL_IMPORT" | "PMS_IMPORT";
};

export type CalendarConflict = { listingId: string; bookingId: string; blockId: string; from: Date; to: Date };

/**
 * A FYStay stay overlapping dates another channel says are taken (an
 * imported iCal or PMS block) - most likely a double booking, because the
 * other site's calendar reached FYStay after the guest booked here. A
 * host's own block over a stay isn't a conflict: they can see both.
 * Single-unit listings only; a hotel's rooms legitimately overlap.
 */
export function findCalendarConflicts(
  listings: Pick<InsightListing, "id" | "units">[],
  bookings: Pick<InsightBooking, "id" | "listingId" | "status" | "checkIn" | "checkOut">[],
  blocks: CalendarBlock[],
): CalendarConflict[] {
  const singleUnit = new Set(listings.filter((l) => l.units <= 1).map((l) => l.id));
  const conflicts: CalendarConflict[] = [];
  for (const block of blocks) {
    if (block.source === "HOST" || !singleUnit.has(block.listingId)) continue;
    for (const b of bookings) {
      if (b.listingId !== block.listingId || !isLiveStay(b)) continue;
      if (b.checkIn < block.endDate && block.startDate < b.checkOut) {
        conflicts.push({
          listingId: b.listingId,
          bookingId: b.id,
          blockId: block.id,
          from: new Date(Math.max(b.checkIn.getTime(), block.startDate.getTime())),
          to: new Date(Math.min(b.checkOut.getTime(), block.endDate.getTime())),
        });
      }
    }
  }
  return conflicts;
}
