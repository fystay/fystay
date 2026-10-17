import type { Prisma, PrismaClient } from "@prisma/client";

/**
 * What FYStay's own bookings say about demand in a town - the only demand
 * data FYStay has. No competitor prices, no bought-in market data.
 *
 * Deliberately not used as demand: a listing's own full calendar (it can be
 * full because the host blocked it, or because it's priced too low) and
 * host blocks or calendar imports (they aren't bookings). Only paid FYStay
 * bookings (CONFIRMED or COMPLETED) for single-unit listings count.
 *
 * Every figure is a share of the town's active listing-nights. The
 * historical figures use today's listing count as the denominator, an
 * approximation recorded as such; small samples are flagged by the
 * engine's thresholds (assessDemand in dynamicPricing.ts), which then use
 * no adjustment at all.
 */
export type MarketDemand = {
  town: string;
  activeListings: number;
  /** Paid bookings made in the last 180 days. */
  bookingsLast180Days: number;
  /** Days since the earliest booking read. */
  historyDays: number;
  /** Share of the town's listing-nights for the stay's dates already booked. */
  forwardShare: number;
  /**
   * Over the last 180 days, the share of the town's listing-nights that were
   * already booked this many days before the night - the usual booking pace
   * at this lead time. Null with no listings.
   */
  paceShare: number | null;
  /** The stay's calendar month last year against the trailing year. Null without the history. */
  seasonalIndex: number | null;
  /** Bookings in that month last year (the seasonal sample size). */
  seasonSampleBookings: number;
};

export type DemandBooking = { checkIn: Date; checkOut: Date; createdAt: Date };

const DAY_MS = 24 * 60 * 60 * 1000;
export const DEMAND_HISTORY_DAYS = 400;
const PACE_WINDOW_DAYS = 180;

function overlapNights(booking: DemandBooking, from: number, to: number, include: (night: number) => boolean = () => true): number {
  let count = 0;
  const start = Math.max(booking.checkIn.getTime(), from);
  const end = Math.min(booking.checkOut.getTime(), to);
  for (let t = start; t < end; t += DAY_MS) if (include(t)) count++;
  return count;
}

export function summariseMarketDemand(params: {
  town: string;
  activeListings: number;
  bookings: DemandBooking[];
  checkIn: Date;
  checkOut: Date;
  today: Date;
}): MarketDemand {
  const { town, activeListings, bookings, checkIn, checkOut } = params;
  const today = params.today.getTime();
  const stayNights = Math.max(1, Math.round((checkOut.getTime() - checkIn.getTime()) / DAY_MS));
  const leadMs = Math.max(0, checkIn.getTime() - today);
  const share = (nights: number, days: number) => (activeListings > 0 ? Math.min(1, nights / (activeListings * days)) : 0);
  const sum = (f: (b: DemandBooking) => number) => bookings.reduce((total, b) => total + f(b), 0);

  const forwardShare = share(sum((b) => overlapNights(b, checkIn.getTime(), checkOut.getTime())), stayNights);
  const paceFrom = today - PACE_WINDOW_DAYS * DAY_MS;
  const paceShare =
    activeListings > 0 ? share(sum((b) => overlapNights(b, paceFrom, today, (night) => b.createdAt.getTime() <= night - leadMs)), PACE_WINDOW_DAYS) : null;

  const earliest = bookings.reduce((min, b) => Math.min(min, b.createdAt.getTime()), today);
  const historyDays = Math.floor((today - earliest) / DAY_MS);

  let seasonalIndex: number | null = null;
  let seasonSampleBookings = 0;
  const monthStart = Date.UTC(checkIn.getUTCFullYear() - 1, checkIn.getUTCMonth(), 1);
  const monthEnd = Date.UTC(checkIn.getUTCFullYear() - 1, checkIn.getUTCMonth() + 1, 1);
  if (activeListings > 0 && monthEnd <= today && monthStart >= today - DEMAND_HISTORY_DAYS * DAY_MS) {
    const inMonth = bookings.filter((b) => b.checkIn.getTime() < monthEnd && b.checkOut.getTime() > monthStart);
    seasonSampleBookings = inMonth.length;
    const monthShare = share(sum((b) => overlapNights(b, monthStart, monthEnd)), Math.round((monthEnd - monthStart) / DAY_MS));
    const yearShare = share(sum((b) => overlapNights(b, today - 365 * DAY_MS, today)), 365);
    seasonalIndex = yearShare > 0 ? monthShare / yearShare : null;
  }

  return {
    town,
    activeListings,
    bookingsLast180Days: bookings.filter((b) => b.createdAt.getTime() >= paceFrom).length,
    historyDays,
    forwardShare,
    paceShare,
    seasonalIndex,
    seasonSampleBookings,
  };
}

type Db = PrismaClient | Prisma.TransactionClient;

/** Reads the town's paid FYStay bookings and active listings. Null when the listing has no town. */
export async function loadMarketDemand(db: Db, city: string, stay: { checkIn: Date; checkOut: Date; today: Date }): Promise<MarketDemand | null> {
  const town = city.trim();
  if (!town) return null;
  const sameTown = { equals: town, mode: "insensitive" as const };
  const [activeListings, bookings] = await Promise.all([
    db.listing.count({ where: { city: sameTown, published: true, suspendedAt: null, propertyType: { not: "HOTEL" } } }),
    db.booking.findMany({
      where: {
        roomTypeId: null,
        status: { in: ["CONFIRMED", "COMPLETED"] },
        listing: { city: sameTown },
        checkOut: { gte: new Date(stay.today.getTime() - DEMAND_HISTORY_DAYS * DAY_MS) },
      },
      select: { checkIn: true, checkOut: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 5000,
    }),
  ]);
  return summariseMarketDemand({ town, activeListings, bookings, ...stay });
}
