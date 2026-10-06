import type { Prisma } from "@prisma/client";
import { todayStayDate } from "@/lib/stayDates";

/**
 * Deals - what the homepage's "Last Minute Deals" row shows. Two kinds, both
 * real by construction (UK rules on price claims: a "deal" or "was" price
 * has to be genuine):
 *
 * - A last-minute deal: a host-set percentage off the nightly rate for a
 *   stay that checks in within a short window of the day it's booked. It's
 *   charged, not just advertised - computeBookingPricing applies it - and
 *   never stacks with a weekly/monthly discount (the larger one wins).
 * - A price drop: a host lowered a nightly price that had been charged for
 *   at least PRICE_HELD_BEFORE_DROP_DAYS. The earlier price is shown as the
 *   "was" price for PRICE_DROP_SHOWN_DAYS after the drop, then retires.
 */

export const LAST_MINUTE_MIN_PERCENT = 5;
export const LAST_MINUTE_MAX_PERCENT = 50;
/** How close to check-in a last-minute deal can apply, in days. */
export const LAST_MINUTE_WINDOW_OPTIONS = [3, 7, 14] as const;

export const PRICE_HELD_BEFORE_DROP_DAYS = 28;
export const PRICE_DROP_SHOWN_DAYS = 28;

const DAY_MS = 24 * 60 * 60 * 1000;

type LastMinuteSettings = { lastMinuteDiscountPercent: number | null; lastMinuteWindowDays: number | null };

export function hasLastMinuteDeal(listing: LastMinuteSettings): boolean {
  return Boolean(listing.lastMinuteDiscountPercent && listing.lastMinuteWindowDays);
}

/** Whole days from today to a stay date (both calendar dates), negative for the past. */
export function daysUntilStay(checkIn: Date, now: Date = new Date()): number {
  return Math.round((todayStayDate(checkIn).getTime() - todayStayDate(now).getTime()) / DAY_MS);
}

/**
 * The last-minute percentage a stay checking in on `checkIn` gets if booked
 * at `now`, or null when the listing has no deal or the stay is outside its
 * window. Day 0 (checking in today) through windowDays all qualify.
 */
export function lastMinuteDiscountFor(listing: LastMinuteSettings, checkIn: Date, now: Date = new Date()): number | null {
  if (!hasLastMinuteDeal(listing)) return null;
  const days = daysUntilStay(checkIn, now);
  return days >= 0 && days <= listing.lastMinuteWindowDays! ? listing.lastMinuteDiscountPercent! : null;
}

type PriceDropFields = {
  pricePerNightCents: number;
  priceDropFromCents: number | null;
  priceDroppedAt: Date | null;
};

/** The listing's current price drop - the genuine earlier price and the saving - or null. */
export function activePriceDrop(
  listing: PriceDropFields,
  now: Date = new Date(),
): { fromCents: number; percentOff: number } | null {
  const { pricePerNightCents, priceDropFromCents, priceDroppedAt } = listing;
  if (!priceDropFromCents || !priceDroppedAt) return null;
  if (priceDropFromCents <= pricePerNightCents) return null;
  if (now.getTime() - priceDroppedAt.getTime() > PRICE_DROP_SHOWN_DAYS * DAY_MS) return null;
  return {
    fromCents: priceDropFromCents,
    percentOff: Math.round(((priceDropFromCents - pricePerNightCents) / priceDropFromCents) * 100),
  };
}

/**
 * The price-tracking fields to save alongside a host's change to the
 * nightly price (merge into the same update). A drop only records a "was"
 * price when the old price had been charged for PRICE_HELD_BEFORE_DROP_DAYS;
 * a further cut inside a live drop keeps the original "was" price (still the
 * last price genuinely held); raising the price back to the "was" price or
 * above ends the drop.
 */
export function priceChangeFields(
  listing: PriceDropFields & { priceChangedAt: Date | null; createdAt: Date },
  newPriceCents: number,
  now: Date = new Date(),
): Prisma.ListingUpdateInput {
  const oldPriceCents = listing.pricePerNightCents;
  if (newPriceCents === oldPriceCents) return {};

  const heldSince = listing.priceChangedAt ?? listing.createdAt;
  const heldLongEnough = now.getTime() - heldSince.getTime() >= PRICE_HELD_BEFORE_DROP_DAYS * DAY_MS;
  const liveDrop = activePriceDrop(listing, now);

  let drop: Prisma.ListingUpdateInput;
  if (newPriceCents < oldPriceCents) {
    drop = heldLongEnough
      ? { priceDropFromCents: oldPriceCents, priceDroppedAt: now }
      : liveDrop
        ? {}
        : { priceDropFromCents: null, priceDroppedAt: null };
  } else {
    drop = liveDrop && newPriceCents < liveDrop.fromCents ? {} : { priceDropFromCents: null, priceDroppedAt: null };
  }
  return { ...drop, priceChangedAt: now };
}

/**
 * Listings that might have a deal right now, for a database query - a
 * last-minute deal set, or a price drop recent enough to show. Confirm each
 * with listingDeal(), which also checks the drop is still below its "was".
 */
export function possibleDealWhere(now: Date = new Date()): Prisma.ListingWhereInput {
  return {
    OR: [
      { lastMinuteDiscountPercent: { not: null }, lastMinuteWindowDays: { not: null } },
      {
        priceDropFromCents: { not: null },
        priceDroppedAt: { gte: new Date(now.getTime() - PRICE_DROP_SHOWN_DAYS * DAY_MS) },
      },
    ],
  };
}

/**
 * The nightly rate shown on a card for a last-minute deal: the full rate
 * less the deal, rounded to the penny exactly as checkout rounds a one-night
 * stay (computeBookingPricing), so the card never promises a price checkout
 * won't charge.
 */
export function dealNightlyPriceCents(pricePerNightCents: number, percentOff: number): number {
  return pricePerNightCents - Math.round((pricePerNightCents * percentOff) / 100);
}

export type ListingDeal =
  | { kind: "last_minute"; percentOff: number; windowDays: number }
  | { kind: "price_drop"; percentOff: number; fromCents: number };

/** The listing's headline deal (the bigger saving if it has both), or null. */
export function listingDeal(listing: LastMinuteSettings & PriceDropFields, now: Date = new Date()): ListingDeal | null {
  const drop = activePriceDrop(listing, now);
  const lastMinute = hasLastMinuteDeal(listing)
    ? { kind: "last_minute" as const, percentOff: listing.lastMinuteDiscountPercent!, windowDays: listing.lastMinuteWindowDays! }
    : null;
  if (drop && (!lastMinute || drop.percentOff >= lastMinute.percentOff)) {
    return { kind: "price_drop", percentOff: drop.percentOff, fromCents: drop.fromCents };
  }
  return lastMinute;
}
