import type { Prisma, PrismaClient } from "@prisma/client";
import { computeBookingPricing, stayRates, type BookingPriceBreakdown } from "@/lib/pricing";
import { commissionDecision, CURRENT_DYNAMIC_POLICY, LEGACY_FIXED_10, stayFinancials, type CommissionDecision, type CommissionPolicy } from "@/lib/pricingPolicy";
import { decideSmartPrice, type DemandInputs, type SmartPriceDecision, type SmartPricingSettings } from "@/lib/dynamicPricing";
import { loadMarketDemand } from "@/lib/marketDemand";
import { lastMinuteDiscountFor } from "@/lib/deals";
import { nightsBetween } from "@/lib/availability";
import { smartPricingMode } from "@/lib/smartPricingMode";

/**
 * The one quote for a single-unit listing stay - what the booking widget,
 * the availability preview and booking creation all price with, so the
 * guest is charged what they were shown.
 *
 * - SMART_PRICING_MODE off (the default): the host's own price under the
 *   fixed 10% (LEGACY_FIXED_10), always. This is also the rollback.
 * - shadow: the same charge; at booking creation the dynamic price and
 *   commission are worked out for every listing and recorded beside it
 *   (PriceDecision + a "pricing_shadow_comparison" log) - nothing a guest
 *   pays or a host receives changes.
 * - on: a listing whose host agreed to the current dynamic policy
 *   (hostOptedIn) is charged the dynamic commission - at the smart price
 *   when they chose automatic prices, at their own price when they only
 *   want suggestions. Every other listing keeps the fixed 10%, with the
 *   dynamic figures recorded in shadow.
 *
 * Anything going wrong in the dynamic path falls back to the fixed 10% at
 * the host's own price.
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
  smartPricingConsentPolicyVersion: string | null;
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
  /** How the charged commission was worked out. */
  commission: CommissionDecision;
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

/**
 * Whether the host turned smart pricing on, set a minimum payout and agreed
 * to the CURRENT dynamic policy. Agreement to an older version doesn't
 * count: a new policy version needs the host's agreement again, and until
 * then the listing is charged the fixed 10%.
 */
export function hostOptedIn(listing: QuoteListing): boolean {
  return (
    listing.smartPricingEnabled &&
    listing.smartPricingConsentAt !== null &&
    listing.smartPricingConsentPolicyVersion === CURRENT_DYNAMIC_POLICY.version &&
    listing.smartPricingMinPayoutCents !== null
  );
}

/** guestsSeeSmartPrices as a database filter (the mode is checked separately). */
export const SMART_PRICED_FOR_GUESTS_WHERE = {
  smartPricingEnabled: true,
  smartPricingAutoApply: true,
  smartPricingConsentAt: { not: null },
  smartPricingConsentPolicyVersion: CURRENT_DYNAMIC_POLICY.version,
  smartPricingMinPayoutCents: { not: null },
} satisfies Prisma.ListingWhereInput;

/** Whether guests are shown (and charged) smart prices for this listing right now. */
export function guestsSeeSmartPrices(listing: QuoteListing, env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return smartPricingMode(env) === "on" && hostOptedIn(listing) && listing.smartPricingAutoApply;
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
    commission: commissionDecision(LEGACY_FIXED_10, { accommodationCents: pricing.totalPriceCents }),
    smartPricing: null,
  };
}

/** Shadow settings for a listing whose host hasn't opted in: no limits of theirs to apply, so only the engine's. */
const SHADOW_DEFAULTS: SmartPricingSettings = {
  enabled: true,
  autoApply: false,
  consentAt: null,
  minHostPayoutPerNightCents: null,
  targetHostPayoutPerNightCents: null,
  minGuestPricePerNightCents: null,
  maxGuestPricePerNightCents: null,
  maxAdjustmentPercent: null,
};

/**
 * Quotes a stay. `shadow: true` (booking creation only, so previews don't
 * write anything) also works out and records the dynamic figures for
 * listings that aren't charged them.
 */
export async function quoteListingStay(
  db: Db,
  listing: QuoteListing,
  stay: { checkIn: Date; checkOut: Date; today: Date },
  env: Readonly<Record<string, string | undefined>> = process.env,
  options: { shadow?: boolean } = {},
): Promise<StayQuote> {
  const legacy = legacyQuote(listing, stay.checkIn, stay.checkOut);
  const mode = smartPricingMode(env);
  if (mode === "off") return legacy;
  const live = mode === "on" && hostOptedIn(listing);
  if (!live && !options.shadow) return legacy;

  const use: SmartPricingUse = !live ? "shadow" : listing.smartPricingAutoApply ? "applied" : "suggested";
  try {
    const rates = stayRates(listing, stay.checkIn, stay.checkOut);
    const [market, localEvents] = await Promise.all([loadMarketDemand(db, listing.city, stay), localEventsFor(db, listing.city, stay.checkIn, stay.checkOut)]);
    const demand: DemandInputs = { today: stay.today, checkIn: stay.checkIn, checkOut: stay.checkOut, market, localEvents };
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
      settings: hostOptedIn(listing) ? smartPricingSettings(listing) : SHADOW_DEFAULTS,
      demand,
      policy: CURRENT_DYNAMIC_POLICY,
    });
    if (decision.outcome === "constrained") {
      console.warn("smart_pricing_constrained", { listingId: listing.id, explanation: decision.explanation });
    }
    if (use === "shadow") return { ...legacy, smartPricing: { use, decision } };
    const applied = use === "applied";
    const pricing = applied ? decision.pricing : decision.basePricing;
    const commission = applied ? decision.commission : decision.baseCommission;
    return {
      pricing,
      policy: CURRENT_DYNAMIC_POLICY,
      commissionRateBps: commission.rateBps,
      lastMinuteDiscountPercent: legacy.lastMinuteDiscountPercent,
      basePriceSubtotalCents: pricing.totalPriceCents === decision.basePricing.totalPriceCents ? null : decision.basePricing.totalPriceCents,
      commission,
      smartPricing: { use, decision },
    };
  } catch (error) {
    // Never block a booking on the dynamic path: the fixed 10% at the host's own price applies.
    console.error("smart_pricing_failed", { listingId: listing.id, error: error instanceof Error ? error.message : String(error) });
    return legacy;
  }
}

const CONFIDENCE_RANK = ["none", "low", "medium", "high"] as const;

/**
 * Records what was charged and what the dynamic policy proposed, side by
 * side, with every input and reason - for audit, for calibrating the
 * policy from real bookings, and for the shadow comparison. Holds no guest
 * data. Also logs the comparison.
 */
export async function recordPriceDecision(db: Db, listingId: string, stay: { checkIn: Date; checkOut: Date }, quote: StayQuote): Promise<string | null> {
  if (!quote.smartPricing) return null;
  const { decision, use } = quote.smartPricing;
  const proposed = stayFinancials({ accommodationCents: decision.pricing.totalPriceCents, platformFeeCents: decision.pricing.hostCommissionCents });
  const charged = stayFinancials({ accommodationCents: quote.pricing.totalPriceCents, platformFeeCents: quote.pricing.hostCommissionCents });
  // The best-supported signal's confidence: "none" means the decision rests on the baseline alone.
  const { demand, season } = decision.assessment;
  const confidence = CONFIDENCE_RANK[Math.max(CONFIDENCE_RANK.indexOf(demand.confidence), CONFIDENCE_RANK.indexOf(season.confidence))];
  console.info("pricing_shadow_comparison", {
    listingId,
    use,
    confidence,
    charged: { policy: quote.policy.version, totalCents: charged.guestTotalCents, feeCents: charged.platformFeeCents, hostPayoutCents: charged.hostPayoutCents },
    proposed: { policy: decision.policyVersion, totalCents: proposed.guestTotalCents, feeCents: proposed.platformFeeCents, hostPayoutCents: proposed.hostPayoutCents, rateBps: decision.commission.rateBps },
  });
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
      dataConfidence: confidence,
      proposedAdjustmentPercent: decision.proposedAdjustmentPercent,
      adjustmentPercent: decision.adjustmentPercent,
      baseAccommodationCents: decision.basePricing.totalPriceCents,
      chosenAccommodationCents: decision.pricing.totalPriceCents,
      commissionRateBps: decision.commission.rateBps,
      hostPayoutCents: proposed.hostPayoutCents,
      platformFeeCents: proposed.platformFeeCents,
      estimatedContributionCents: proposed.contributionCents,
      chargedPolicyVersion: quote.policy.version,
      chargedAccommodationCents: charged.guestTotalCents,
      chargedPlatformFeeCents: charged.platformFeeCents,
      chargedHostPayoutCents: charged.hostPayoutCents,
      inputs: JSON.parse(
        JSON.stringify({
          assessment: decision.assessment,
          signals: decision.signals,
          commission: { proposed: decision.commission, charged: quote.commission },
          constraints: decision.constraints,
          candidates: decision.candidates,
        }),
      ),
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
    // Shadow decisions are linked too: the comparison is per booking.
    priceDecisionId,
  };
}
