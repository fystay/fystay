import type { Prisma, PrismaClient } from "@prisma/client";
import { computeBookingPricing, stayRates, type BookingPriceBreakdown } from "@/lib/pricing";
import { effectiveRateBps, LEGACY_FIXED_10, SMART_PRICING_V1, stayFinancials, type CommissionPolicy } from "@/lib/pricingPolicy";
import { decideSmartPrice, ENGINE_LIMITS, type DemandInputs, type SmartPriceDecision, type SmartPricingSettings } from "@/lib/dynamicPricing";
import { lastMinuteDiscountFor } from "@/lib/deals";
import { nightsBetween } from "@/lib/availability";
import { smartPricingMode } from "@/lib/smartPricingMode";

/**
 * The one quote for a single-unit listing stay - what the booking widget,
 * the availability preview and booking creation all price with, so the
 * guest is charged what they were shown. Decides between the host's own
 * price under the fixed 10% (every listing, unless smart pricing is on for
 * it) and a smart price (src/lib/dynamicPricing.ts):
 *
 * - SMART_PRICING_MODE off (the default): the host's own price, always.
 * - shadow: the host's own price is charged; the smart price is worked out
 *   and recorded for comparison only.
 * - on: for a listing whose host turned smart pricing on and agreed to it,
 *   the smart price is charged when they chose automatic prices, and only
 *   suggested (their own price charged) when they want to approve changes.
 *
 * Anything going wrong in the smart path falls back to the host's own price.
 */

export type QuoteListing = {
  id: string;
  city: string;
  pricePerNightCents: number;
  weekendPricePerNightCents: number | null;
  weeklyDiscountPercent: number | null;
  monthlyDiscountPercent: number | null;
  lastMinuteDiscountPercent: number | null;
  lastMinuteWindowDays: number | null;
  smartPricingEnabled: boolean;
  smartPricingAutoApply: boolean;
  smartPricingConsentAt: Date | null;
  smartPricingMinPayoutCents: number | null;
  smartPricingTargetPayoutCents: number | null;
  smartPricingMinPriceCents: number | null;
  smartPricingMaxPriceCents: number | null;
  smartPricingMaxAdjustmentPercent: number | null;
};

export type SmartPricingUse = "applied" | "shadow" | "suggested";

export type StayQuote = {
  pricing: BookingPriceBreakdown;
  policy: CommissionPolicy;
  /** The effective commission rate, stored on the booking. */
  commissionRateBps: number;
  lastMinuteDiscountPercent: number | null;
  /** The accommodation at the host's own rates, when a smart price differs from it. */
  basePriceSubtotalCents: number | null;
  smartPricing: { use: SmartPricingUse; decision: SmartPriceDecision } | null;
};

type Db = PrismaClient | Prisma.TransactionClient;

export function smartPricingSettings(listing: QuoteListing): SmartPricingSettings {
  return {
    enabled: listing.smartPricingEnabled,
    autoApply: listing.smartPricingAutoApply,
    consentAt: listing.smartPricingConsentAt,
    minHostPayoutPerNightCents: listing.smartPricingMinPayoutCents,
    targetHostPayoutPerNightCents: listing.smartPricingTargetPayoutCents,
    minGuestPricePerNightCents: listing.smartPricingMinPriceCents,
    maxGuestPricePerNightCents: listing.smartPricingMaxPriceCents,
    maxAdjustmentPercent: listing.smartPricingMaxAdjustmentPercent,
  };
}

/** Whether the host has turned smart pricing on and agreed to it - nothing is priced without both. */
export function hostOptedIn(listing: QuoteListing): boolean {
  return listing.smartPricingEnabled && listing.smartPricingConsentAt !== null && listing.smartPricingMinPayoutCents !== null;
}

/** guestsSeeSmartPrices as a database filter (the mode is checked separately). */
export const SMART_PRICED_FOR_GUESTS_WHERE = {
  smartPricingEnabled: true,
  smartPricingAutoApply: true,
  smartPricingConsentAt: { not: null },
  smartPricingMinPayoutCents: { not: null },
} satisfies Prisma.ListingWhereInput;

/** Whether guests are shown (and charged) smart prices for this listing right now. */
export function guestsSeeSmartPrices(listing: QuoteListing, env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return smartPricingMode(env) === "on" && hostOptedIn(listing) && listing.smartPricingAutoApply;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Nights booked or blocked on the listing's own calendar in the window around the stay (the stay itself excluded). */
export function occupancyAround(
  stay: { checkIn: Date; checkOut: Date },
  ranges: { checkIn: Date; checkOut: Date }[],
  windowDays: number = ENGINE_LIMITS.occupancyWindowDays,
): { bookedNights: number; windowNights: number } {
  const nights: number[] = [];
  for (let t = stay.checkIn.getTime() - windowDays * DAY_MS; t < stay.checkIn.getTime(); t += DAY_MS) nights.push(t);
  for (let t = stay.checkOut.getTime(); t < stay.checkOut.getTime() + windowDays * DAY_MS; t += DAY_MS) nights.push(t);
  const booked = nights.filter((t) => ranges.some((r) => r.checkIn.getTime() <= t && t < r.checkOut.getTime())).length;
  return { bookedNights: booked, windowNights: nights.length };
}

async function localEventsFor(db: Db, city: string, checkIn: Date, checkOut: Date): Promise<DemandInputs["localEvents"]> {
  const town = await db.localTown.findFirst({ where: { name: { equals: city.trim(), mode: "insensitive" } }, select: { slug: true } });
  if (!town) return null;
  const [count, latest] = await Promise.all([
    db.localEvent.count({ where: { townSlug: town.slug, startsAt: { lt: checkOut }, OR: [{ endsAt: { gte: checkIn } }, { endsAt: null, startsAt: { gte: checkIn } }] } }),
    db.localEvent.aggregate({ where: { townSlug: town.slug }, _max: { lastFetchedAt: true } }),
  ]);
  return { count, lastFetchedAt: latest._max.lastFetchedAt };
}

function legacyQuote(listing: QuoteListing, checkIn: Date, checkOut: Date): StayQuote {
  const lastMinuteDiscountPercent = lastMinuteDiscountFor(listing, checkIn);
  const pricing = computeBookingPricing({
    nights: nightsBetween(checkIn, checkOut),
    ...stayRates(listing, checkIn, checkOut),
    weeklyDiscountPercent: listing.weeklyDiscountPercent,
    monthlyDiscountPercent: listing.monthlyDiscountPercent,
    lastMinuteDiscountPercent,
  });
  return {
    pricing,
    policy: LEGACY_FIXED_10,
    commissionRateBps: LEGACY_FIXED_10.baseRateBps,
    lastMinuteDiscountPercent,
    basePriceSubtotalCents: null,
    smartPricing: null,
  };
}

/**
 * Quotes a stay. `ranges` are the listing's blocking bookings and blocks
 * (the caller already loads them for its availability check).
 */
export async function quoteListingStay(
  db: Db,
  listing: QuoteListing,
  stay: { checkIn: Date; checkOut: Date; today: Date; ranges: { checkIn: Date; checkOut: Date }[] },
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<StayQuote> {
  const legacy = legacyQuote(listing, stay.checkIn, stay.checkOut);
  const mode = smartPricingMode(env);
  if (mode === "off" || !hostOptedIn(listing)) return legacy;

  const use: SmartPricingUse = mode === "shadow" ? "shadow" : listing.smartPricingAutoApply ? "applied" : "suggested";
  try {
    const rates = stayRates(listing, stay.checkIn, stay.checkOut);
    const decision = decideSmartPrice({
      stay: {
        nights: nightsBetween(stay.checkIn, stay.checkOut),
        pricePerNightCents: rates.pricePerNightCents,
        weekendPricePerNightCents: rates.weekendPricePerNightCents,
        weekendNights: rates.weekendNights,
        weeklyDiscountPercent: listing.weeklyDiscountPercent,
        monthlyDiscountPercent: listing.monthlyDiscountPercent,
        lastMinuteDiscountPercent: legacy.lastMinuteDiscountPercent,
      },
      settings: smartPricingSettings(listing),
      demand: {
        today: stay.today,
        checkIn: stay.checkIn,
        checkOut: stay.checkOut,
        occupancy: occupancyAround(stay, stay.ranges),
        localEvents: await localEventsFor(db, listing.city, stay.checkIn, stay.checkOut),
      },
      policy: SMART_PRICING_V1,
    });
    if (decision.outcome === "constrained") {
      console.warn("smart_pricing_constrained", { listingId: listing.id, explanation: decision.explanation });
    }
    if (use !== "applied") return { ...legacy, smartPricing: { use, decision } };
    const pricing = decision.pricing;
    return {
      pricing,
      policy: SMART_PRICING_V1,
      commissionRateBps: effectiveRateBps(pricing.hostCommissionCents, pricing.totalPriceCents),
      lastMinuteDiscountPercent: legacy.lastMinuteDiscountPercent,
      basePriceSubtotalCents: pricing.totalPriceCents === decision.basePricing.totalPriceCents ? null : decision.basePricing.totalPriceCents,
      smartPricing: { use, decision },
    };
  } catch (error) {
    // Never block a booking on smart pricing: the host's own price applies.
    console.error("smart_pricing_failed", { listingId: listing.id, error: error instanceof Error ? error.message : String(error) });
    return legacy;
  }
}

/**
 * Records a smart-pricing decision for audit (applied, shadow or suggested)
 * and returns its id for the booking. Holds no guest data.
 */
export async function recordPriceDecision(db: Db, listingId: string, stay: { checkIn: Date; checkOut: Date }, quote: StayQuote): Promise<string | null> {
  if (!quote.smartPricing) return null;
  const { decision, use } = quote.smartPricing;
  const money = stayFinancials({ accommodationCents: decision.pricing.totalPriceCents, platformFeeCents: decision.pricing.hostCommissionCents });
  const record = await db.priceDecision.create({
    data: {
      listingId,
      checkIn: stay.checkIn,
      checkOut: stay.checkOut,
      mode: use,
      strategyId: decision.strategyId,
      conversionModelId: decision.conversionModelId,
      policyVersion: decision.policyVersion,
      outcome: decision.outcome,
      proposedAdjustmentPercent: decision.proposedAdjustmentPercent,
      adjustmentPercent: decision.adjustmentPercent,
      baseAccommodationCents: decision.basePricing.totalPriceCents,
      chosenAccommodationCents: decision.pricing.totalPriceCents,
      hostPayoutCents: money.hostPayoutCents,
      platformFeeCents: money.platformFeeCents,
      estimatedContributionCents: money.contributionCents,
      inputs: JSON.parse(JSON.stringify({ signals: decision.signals, constraints: decision.constraints, candidates: decision.candidates })),
      explanation: decision.explanation,
    },
    select: { id: true },
  });
  return record.id;
}

/** The fields every new booking stores about how it was priced. */
export function bookingPricingSnapshot(quote: StayQuote, priceDecisionId: string | null) {
  return {
    pricingPolicyVersion: quote.policy.version,
    commissionRateBps: quote.commissionRateBps,
    basePriceSubtotalCents: quote.basePriceSubtotalCents,
    priceDecisionId: quote.smartPricing?.use === "applied" ? priceDecisionId : null,
  };
}
