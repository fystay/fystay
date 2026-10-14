import { computeBookingPricing, type BookingPriceBreakdown } from "@/lib/pricing";
import { SMART_PRICING_V1, stayFinancials, type CommissionPolicy } from "@/lib/pricingPolicy";

/**
 * Smart pricing: a deterministic, rules-based price for one listing and one
 * stay, inside the limits the host set. Pure - every input is passed in, so
 * the same inputs always give the same price (no flicker between requests)
 * and every case is testable.
 *
 * What it does today, honestly:
 * - Reads demand from the data FYStay actually has: how booked the listing's
 *   own calendar is around the stay, how soon the stay is, and verified
 *   local events (Ticketmaster) when that data is fresh.
 * - Moves the host's own rates by fixed steps, capped, rounded to whole
 *   pounds, never outside the host's price bounds or below their minimum
 *   payout.
 * - Has no conversion model (FYStay doesn't yet record enough listing views
 *   and bookings to fit one) and no comparable-price source; both have an
 *   interface below, and until one exists the engine follows the rules'
 *   proposal rather than claiming to predict demand.
 * - Falls back to the host's own price whenever a decision can't be made.
 */

export type SmartPricingSettings = {
  enabled: boolean;
  /** Apply prices automatically; false = FYStay only suggests, the host's own price is charged. */
  autoApply: boolean;
  /** When the host agreed to smart pricing; nothing is applied without it. */
  consentAt: Date | null;
  minHostPayoutPerNightCents: number | null;
  targetHostPayoutPerNightCents: number | null;
  minGuestPricePerNightCents: number | null;
  maxGuestPricePerNightCents: number | null;
  maxAdjustmentPercent: number | null;
};

/** Engine-wide limits; a host can only narrow them. */
export const ENGINE_LIMITS = {
  stepPercent: 5,
  maxAdjustmentPercent: 15,
  /** Adjusted rates are rounded to whole pounds. */
  roundToCents: 100,
  occupancyWindowDays: 14,
  occupancyHighShare: 0.7,
  occupancyLowShare: 0.2,
  /** A quiet calendar only lowers the price this close to check-in. */
  lowDemandLeadDays: 14,
  /** Event data older than this is ignored. */
  eventFreshDays: 7,
} as const;

export type SignalConfidence = "high" | "medium" | "low" | "none";

/** One input to a decision, recorded with where it came from and how far to trust it. */
export type MarketSignal = {
  name: "occupancy" | "local_events" | "comparables" | "conversion";
  effectPercent: number;
  detail: string;
  source: string;
  observedAt: string | null;
  confidence: SignalConfidence;
};

export type DemandInputs = {
  today: Date;
  checkIn: Date;
  checkOut: Date;
  /** Nights booked or blocked on the listing's own calendar in the window around the stay. Null: not read. */
  occupancy: { bookedNights: number; windowNights: number } | null;
  /** Verified local events overlapping the stay in the listing's town. Null: no event source for this town. */
  localEvents: { count: number; lastFetchedAt: Date | null } | null;
};

/** Proposes a price change from demand inputs. Swappable for a validated statistical model later. */
export interface PricingStrategy {
  id: string;
  propose(inputs: DemandInputs): { adjustmentPercent: number; signals: MarketSignal[] };
}

/**
 * Estimates the chance a guest books at a candidate price. FYStay has none
 * yet; when one exists the engine maximises expected contribution with it.
 * Returning null for any candidate means "no defensible estimate".
 */
export interface ConversionModel {
  id: string;
  bookingProbability(candidate: { adjustmentPercent: number; guestTotalCents: number }): number | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export const rulesBaselineStrategy: PricingStrategy = {
  id: "rules-baseline-v1",
  propose(inputs) {
    const signals: MarketSignal[] = [];
    const leadDays = Math.round((inputs.checkIn.getTime() - inputs.today.getTime()) / DAY_MS);

    if (inputs.occupancy && inputs.occupancy.windowNights > 0) {
      const share = inputs.occupancy.bookedNights / inputs.occupancy.windowNights;
      const pct = Math.round(share * 100);
      let effect = 0;
      let detail = `${pct}% of nearby nights booked - normal demand`;
      if (share >= ENGINE_LIMITS.occupancyHighShare) {
        effect = ENGINE_LIMITS.stepPercent;
        detail = `${pct}% of nearby nights already booked - high demand`;
      } else if (share <= ENGINE_LIMITS.occupancyLowShare && leadDays <= ENGINE_LIMITS.lowDemandLeadDays) {
        effect = -ENGINE_LIMITS.stepPercent;
        detail = `only ${pct}% of nearby nights booked, ${leadDays} days before check-in - low demand`;
      }
      signals.push({ name: "occupancy", effectPercent: effect, detail, source: "FYStay calendar", observedAt: inputs.today.toISOString(), confidence: "high" });
    }

    if (inputs.localEvents) {
      const fetched = inputs.localEvents.lastFetchedAt;
      const fresh = fetched !== null && inputs.today.getTime() - fetched.getTime() <= ENGINE_LIMITS.eventFreshDays * DAY_MS;
      if (!fresh) {
        signals.push({ name: "local_events", effectPercent: 0, detail: "event data out of date - ignored", source: "Ticketmaster", observedAt: fetched?.toISOString() ?? null, confidence: "none" });
      } else if (inputs.localEvents.count > 0) {
        signals.push({
          name: "local_events",
          effectPercent: ENGINE_LIMITS.stepPercent,
          detail: `${inputs.localEvents.count} local event${inputs.localEvents.count === 1 ? "" : "s"} during the stay`,
          source: "Ticketmaster",
          observedAt: fetched!.toISOString(),
          confidence: "medium",
        });
      }
    }

    signals.push({ name: "comparables", effectPercent: 0, detail: "no comparable-price source yet", source: "none", observedAt: null, confidence: "none" });

    return { adjustmentPercent: signals.reduce((sum, s) => sum + s.effectPercent, 0), signals };
  },
};

export type ConstraintCheck = { name: "min_host_payout" | "target_host_payout" | "guest_price_bounds" | "adjustment_cap"; ok: boolean; detail: string };

export type PriceCandidate = {
  adjustmentPercent: number;
  pricePerNightCents: number;
  weekendPricePerNightCents: number | null;
  guestTotalCents: number;
  hostPayoutCents: number;
  hostPayoutPerNightCents: number;
  contributionCents: number;
  bookingProbability: number | null;
  meetsMinPayout: boolean;
};

export type SmartPriceDecision = {
  strategyId: string;
  conversionModelId: string | null;
  policyVersion: string;
  outcome: "adjusted" | "unchanged" | "constrained";
  proposedAdjustmentPercent: number;
  adjustmentPercent: number;
  /** The chosen stay's breakdown, under the smart-pricing policy. */
  pricing: BookingPriceBreakdown;
  /** The stay at the host's own rates, under the same policy - what a fallback charges. */
  basePricing: BookingPriceBreakdown;
  signals: MarketSignal[];
  constraints: ConstraintCheck[];
  candidates: PriceCandidate[];
  explanation: string;
};

export type StayInput = {
  nights: number;
  pricePerNightCents: number;
  weekendPricePerNightCents: number | null;
  weekendNights: number;
  weeklyDiscountPercent: number | null;
  monthlyDiscountPercent: number | null;
  lastMinuteDiscountPercent: number | null;
};

const pounds = (cents: number) => `£${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;

function adjustedRate(rate: number, percent: number, settings: SmartPricingSettings): number {
  if (percent === 0) return rate;
  let adjusted = Math.round((rate * (100 + percent)) / 100 / ENGINE_LIMITS.roundToCents) * ENGINE_LIMITS.roundToCents;
  if (settings.minGuestPricePerNightCents !== null) adjusted = Math.max(adjusted, settings.minGuestPricePerNightCents);
  if (settings.maxGuestPricePerNightCents !== null) adjusted = Math.min(adjusted, settings.maxGuestPricePerNightCents);
  return Math.max(adjusted, 1);
}

/**
 * Chooses the stay's price. Every candidate is checked against the host's
 * minimum payout; with a conversion model the one with the highest expected
 * contribution wins, otherwise the one nearest the strategy's proposal - in
 * both cases the smaller change wins a tie. If no candidate pays the host
 * their minimum, the host's own price is kept and the decision says why.
 */
export function decideSmartPrice(params: {
  stay: StayInput;
  settings: SmartPricingSettings;
  demand: DemandInputs;
  policy?: CommissionPolicy;
  strategy?: PricingStrategy;
  conversionModel?: ConversionModel | null;
}): SmartPriceDecision {
  const { stay, settings, demand, policy = SMART_PRICING_V1, strategy = rulesBaselineStrategy, conversionModel = null } = params;
  const nights = Math.max(1, stay.nights);
  const cap = Math.max(0, Math.min(ENGINE_LIMITS.maxAdjustmentPercent, settings.maxAdjustmentPercent ?? ENGINE_LIMITS.maxAdjustmentPercent));
  const step = ENGINE_LIMITS.stepPercent;
  const quantize = (p: number) => Math.max(-cap, Math.min(cap, Math.round(p / step) * step));

  const priceAt = (percent: number, baseAccommodationCents?: number) => {
    const pricePerNightCents = adjustedRate(stay.pricePerNightCents, percent, settings);
    const weekend = stay.weekendPricePerNightCents === null ? null : Math.max(pricePerNightCents, adjustedRate(stay.weekendPricePerNightCents, percent, settings));
    return computeBookingPricing({
      nights: stay.nights,
      pricePerNightCents,
      weekendPricePerNightCents: weekend,
      weekendNights: stay.weekendNights,
      weeklyDiscountPercent: stay.weeklyDiscountPercent,
      monthlyDiscountPercent: stay.monthlyDiscountPercent,
      lastMinuteDiscountPercent: stay.lastMinuteDiscountPercent,
      commissionPolicy: policy,
      baseAccommodationCents,
    });
  };

  const basePricing = priceAt(0);
  const baseAccommodationCents = basePricing.totalPriceCents;
  const proposal = strategy.propose(demand);
  const proposedAdjustmentPercent = quantize(proposal.adjustmentPercent);

  const candidates: PriceCandidate[] = [];
  for (let percent = -cap; percent <= cap; percent += step) {
    const pricing = priceAt(percent, baseAccommodationCents);
    const money = stayFinancials({ accommodationCents: pricing.totalPriceCents, platformFeeCents: pricing.hostCommissionCents });
    const hostPayoutPerNightCents = Math.floor(money.hostPayoutCents / nights);
    candidates.push({
      adjustmentPercent: percent,
      pricePerNightCents: pricing.nightlyPriceCents,
      weekendPricePerNightCents: pricing.weekendNightlyPriceCents,
      guestTotalCents: pricing.totalPriceCents,
      hostPayoutCents: money.hostPayoutCents,
      hostPayoutPerNightCents,
      contributionCents: money.contributionCents,
      bookingProbability: conversionModel?.bookingProbability({ adjustmentPercent: percent, guestTotalCents: pricing.totalPriceCents }) ?? null,
      meetsMinPayout: settings.minHostPayoutPerNightCents === null || hostPayoutPerNightCents >= settings.minHostPayoutPerNightCents,
    });
  }

  const valid = candidates.filter((c) => c.meetsMinPayout);
  const closerToZero = (a: PriceCandidate, b: PriceCandidate) => Math.abs(a.adjustmentPercent) - Math.abs(b.adjustmentPercent);
  let chosen: PriceCandidate | undefined;
  const modelled = conversionModel && valid.length > 0 && valid.every((c) => c.bookingProbability !== null);
  if (modelled) {
    chosen = [...valid].sort((a, b) => b.bookingProbability! * b.contributionCents - a.bookingProbability! * a.contributionCents || closerToZero(a, b))[0];
  } else if (valid.length > 0) {
    chosen = [...valid].sort(
      (a, b) => Math.abs(a.adjustmentPercent - proposedAdjustmentPercent) - Math.abs(b.adjustmentPercent - proposedAdjustmentPercent) || closerToZero(a, b),
    )[0];
  }

  const outcome: SmartPriceDecision["outcome"] = !chosen ? "constrained" : chosen.adjustmentPercent === 0 ? "unchanged" : "adjusted";
  const adjustmentPercent = chosen?.adjustmentPercent ?? 0;
  const pricing = adjustmentPercent === 0 ? basePricing : priceAt(adjustmentPercent, baseAccommodationCents);
  const final = chosen ?? candidates.find((c) => c.adjustmentPercent === 0)!;

  const constraints: ConstraintCheck[] = [
    {
      name: "min_host_payout",
      ok: final.meetsMinPayout,
      detail:
        settings.minHostPayoutPerNightCents === null
          ? "no minimum set"
          : `${pounds(final.hostPayoutPerNightCents)} a night against a minimum of ${pounds(settings.minHostPayoutPerNightCents)}`,
    },
    {
      name: "target_host_payout",
      ok: settings.targetHostPayoutPerNightCents === null || final.hostPayoutPerNightCents >= settings.targetHostPayoutPerNightCents,
      detail:
        settings.targetHostPayoutPerNightCents === null
          ? "no target set"
          : candidates.every((c) => c.hostPayoutPerNightCents < settings.targetHostPayoutPerNightCents!)
            ? `target ${pounds(settings.targetHostPayoutPerNightCents)} a night can't be reached within your price limits`
            : `${pounds(final.hostPayoutPerNightCents)} a night against a target of ${pounds(settings.targetHostPayoutPerNightCents)}`,
    },
    { name: "guest_price_bounds", ok: true, detail: "nightly prices kept within your minimum and maximum" },
    { name: "adjustment_cap", ok: Math.abs(adjustmentPercent) <= cap, detail: `changes limited to ±${cap}%` },
  ];

  const reasons = proposal.signals.filter((s) => s.effectPercent !== 0).map((s) => s.detail);
  const explanation =
    outcome === "constrained"
      ? `Your own price was kept: no price within your limits pays your minimum of ${pounds(settings.minHostPayoutPerNightCents ?? 0)} a night.`
      : outcome === "unchanged"
        ? `Your own price applies${reasons.length ? ` (${reasons.join("; ")}, within your limits)` : " - no demand signal for these dates"}.`
        : `${adjustmentPercent > 0 ? "Raised" : "Lowered"} ${Math.abs(adjustmentPercent)}% for these dates: ${reasons.join("; ")}.`;

  return {
    strategyId: strategy.id,
    conversionModelId: modelled ? conversionModel!.id : null,
    policyVersion: policy.version,
    outcome,
    proposedAdjustmentPercent,
    adjustmentPercent,
    pricing,
    basePricing,
    signals: proposal.signals,
    constraints,
    candidates,
    explanation,
  };
}

/** Why a host's smart-pricing settings can't be saved, or null. Checked by the settings API and form alike. */
export function smartPricingSettingsError(
  settings: Omit<SmartPricingSettings, "consentAt">,
  listing: { pricePerNightCents: number; weekendPricePerNightCents: number | null },
  basePayoutPerNightCents: number,
): string | null {
  const money = [settings.minHostPayoutPerNightCents, settings.targetHostPayoutPerNightCents, settings.minGuestPricePerNightCents, settings.maxGuestPricePerNightCents];
  if (money.some((v) => v !== null && (!Number.isInteger(v) || v <= 0 || v > 1_000_000))) return "Amounts must be whole pence between 1p and £10,000";
  if (settings.maxAdjustmentPercent !== null && (!Number.isInteger(settings.maxAdjustmentPercent) || settings.maxAdjustmentPercent < 0 || settings.maxAdjustmentPercent > ENGINE_LIMITS.maxAdjustmentPercent)) {
    return `The most a price can change is between 0% and ${ENGINE_LIMITS.maxAdjustmentPercent}%`;
  }
  const { minGuestPricePerNightCents: minP, maxGuestPricePerNightCents: maxP, minHostPayoutPerNightCents: minPay, targetHostPayoutPerNightCents: target } = settings;
  if (minP !== null && maxP !== null && minP > maxP) return "The lowest nightly price can't be above the highest";
  if (minP !== null && minP > listing.pricePerNightCents) return "The lowest nightly price can't be above your own nightly price";
  const highestOwn = listing.weekendPricePerNightCents ?? listing.pricePerNightCents;
  if (maxP !== null && maxP < highestOwn) return "The highest nightly price can't be below your own prices";
  if (minPay !== null && target !== null && minPay > target) return "Your minimum payout can't be above your target payout";
  if (minPay !== null && minPay > basePayoutPerNightCents) {
    return `Your minimum payout can't be above what your own price pays you (${pounds(basePayoutPerNightCents)} a night)`;
  }
  if (settings.enabled && settings.minHostPayoutPerNightCents === null) return "Set the minimum you'll accept per night before turning smart pricing on";
  return null;
}
