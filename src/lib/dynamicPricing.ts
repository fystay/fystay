import { computeBookingPricing, type BookingPriceBreakdown } from "@/lib/pricing";
import {
  commissionDecision,
  CURRENT_DYNAMIC_POLICY,
  stayFinancials,
  type CommissionContext,
  type CommissionDecision,
  type CommissionPolicy,
  type SignalConfidence,
  type SignalLevel,
} from "@/lib/pricingPolicy";
import type { MarketDemand } from "@/lib/marketDemand";

export type { SignalConfidence, SignalLevel };

/**
 * Smart pricing: a deterministic, rules-based price for one listing and one
 * stay, inside the limits the host set. Pure - every input is passed in, so
 * the same inputs always give the same price (no flicker between requests)
 * and every case is testable.
 *
 * What it does, honestly:
 * - Reads demand only from FYStay's own paid bookings in the listing's town
 *   (marketDemand.ts): how booked the stay's dates are against the town's
 *   usual booking pace at the same lead time, and the stay's month against
 *   the town's year. A listing's own full calendar is not treated as demand.
 * - Uses each signal only when its sample is big enough; otherwise it
 *   records the uncertainty and leaves the host's own price (the baseline).
 * - Verified local events (Ticketmaster) count only when that feed is fresh.
 * - Moves the host's own rates by fixed steps, capped, rounded to whole
 *   pounds, never outside the host's price bounds or below their minimum
 *   payout.
 * - Has no conversion model and no comparable-price source; both have an
 *   interface below, and until one exists the engine follows the rules'
 *   proposal rather than claiming to predict demand.
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
  /** Demand is read only this close to check-in; further out there's too little booked to compare. */
  demandLeadDays: 60,
  /** Low demand only lowers the price this close to check-in. */
  lowDemandLeadDays: 14,
  /** Minimum sample before town demand is used at all. */
  minActiveListings: 5,
  minBookings180Days: 10,
  /** Sample for "high" rather than "medium" confidence. */
  highConfidenceListings: 20,
  highConfidenceBookings: 50,
  /** Booked share against the usual pace at this lead time. */
  paceHighRatio: 1.5,
  paceLowRatio: 0.5,
  /** Seasonality needs a year of history and enough bookings in the month. */
  seasonMinHistoryDays: 365,
  seasonMinBookings: 10,
  seasonHighIndex: 1.3,
  seasonLowIndex: 0.7,
  /** Event data older than this is ignored. */
  eventFreshDays: 7,
} as const;

/** One input to a decision, recorded with where it came from and how far to trust it. */
export type MarketSignal = {
  name: "demand" | "season" | "local_events" | "comparables" | "conversion";
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
  /** FYStay's own bookings in the listing's town. Null: no town or not read. */
  market: MarketDemand | null;
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

type Assessed = { level: SignalLevel; confidence: SignalConfidence; detail: string };

/** How far to trust what FYStay's own data says about demand and season - the same reading for price and commission. */
export type DemandAssessment = {
  leadDays: number;
  townActiveListings: number | null;
  demand: Assessed;
  season: Assessed;
};

const pct = (share: number) => `${Math.round(share * 100)}%`;

export function assessDemand(inputs: DemandInputs): DemandAssessment {
  const leadDays = Math.max(0, Math.round((inputs.checkIn.getTime() - inputs.today.getTime()) / DAY_MS));
  const m = inputs.market;
  const L = ENGINE_LIMITS;
  if (!m) {
    const none: Assessed = { level: "normal", confidence: "none", detail: "no FYStay booking data for this town - baseline used" };
    return { leadDays, townActiveListings: null, demand: none, season: none };
  }

  let demand: Assessed;
  if (m.activeListings < L.minActiveListings || m.bookingsLast180Days < L.minBookings180Days) {
    demand = {
      level: "normal",
      confidence: "none",
      detail: `too little FYStay data in ${m.town} (${m.activeListings} listings, ${m.bookingsLast180Days} bookings in 180 days) - baseline used`,
    };
  } else if (leadDays > L.demandLeadDays) {
    demand = { level: "normal", confidence: "low", detail: `more than ${L.demandLeadDays} days ahead - too early to read demand` };
  } else if (!m.paceShare) {
    demand = { level: "normal", confidence: "low", detail: `no usual booking pace at ${leadDays} days ahead to compare with - baseline used` };
  } else {
    const confidence: SignalConfidence = m.activeListings >= L.highConfidenceListings && m.bookingsLast180Days >= L.highConfidenceBookings ? "high" : "medium";
    const ratio = m.forwardShare / m.paceShare;
    const reading = `${pct(m.forwardShare)} of ${m.town}'s nights for these dates booked, against a usual ${pct(m.paceShare)} at ${leadDays} days ahead`;
    if (ratio >= L.paceHighRatio) {
      demand = { level: "high", confidence, detail: `${reading} - booking faster than usual` };
    } else if (ratio <= L.paceLowRatio && leadDays <= L.lowDemandLeadDays) {
      demand = { level: "low", confidence, detail: `${reading} - booking slower than usual` };
    } else {
      demand = { level: "normal", confidence, detail: `${reading} - usual demand` };
    }
  }

  let season: Assessed;
  if (m.historyDays < L.seasonMinHistoryDays || m.seasonalIndex === null || m.seasonSampleBookings < L.seasonMinBookings) {
    season = { level: "normal", confidence: "none", detail: "less than a year of FYStay bookings for this month - no seasonal adjustment" };
  } else {
    const index = m.seasonalIndex;
    const level: SignalLevel = index >= L.seasonHighIndex ? "high" : index <= L.seasonLowIndex ? "low" : "normal";
    season = { level, confidence: "medium", detail: `this month last year ran at ${Math.round(index * 100)}% of ${m.town}'s yearly average` };
  }
  return { leadDays, townActiveListings: m.activeListings, demand, season };
}

const reliable = (c: SignalConfidence) => c === "high" || c === "medium";

export const rulesBaselineStrategy: PricingStrategy = {
  id: "rules-baseline-v2",
  propose(inputs) {
    const signals: MarketSignal[] = [];
    const { demand, season } = assessDemand(inputs);
    const step = ENGINE_LIMITS.stepPercent;
    const observedAt = inputs.today.toISOString();
    const effect = (a: Assessed) => (!reliable(a.confidence) ? 0 : a.level === "high" ? step : a.level === "low" ? -step : 0);

    signals.push({ name: "demand", effectPercent: effect(demand), detail: demand.detail, source: "FYStay bookings in the town", observedAt, confidence: demand.confidence });
    signals.push({ name: "season", effectPercent: effect(season), detail: season.detail, source: "FYStay bookings in the town", observedAt, confidence: season.confidence });

    if (inputs.localEvents) {
      const fetched = inputs.localEvents.lastFetchedAt;
      const fresh = fetched !== null && inputs.today.getTime() - fetched.getTime() <= ENGINE_LIMITS.eventFreshDays * DAY_MS;
      if (!fresh) {
        signals.push({ name: "local_events", effectPercent: 0, detail: "event data out of date - ignored", source: "Ticketmaster", observedAt: fetched?.toISOString() ?? null, confidence: "none" });
      } else if (inputs.localEvents.count > 0) {
        signals.push({
          name: "local_events",
          effectPercent: step,
          detail: `${inputs.localEvents.count} local event${inputs.localEvents.count === 1 ? "" : "s"} during the stay`,
          source: "Ticketmaster",
          observedAt: fetched!.toISOString(),
          confidence: "medium",
        });
      }
    }

    signals.push({ name: "comparables", effectPercent: 0, detail: "no reliable comparable-price source - not used", source: "none", observedAt: null, confidence: "none" });

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
  /** The chosen stay's breakdown, under the dynamic commission. */
  pricing: BookingPriceBreakdown;
  /** The stay at the host's own rates, under the same commission - what "suggest only" charges. */
  basePricing: BookingPriceBreakdown;
  /** How FYStay's fee on the chosen price was worked out. */
  commission: CommissionDecision;
  /** How FYStay's fee at the host's own price was worked out. */
  baseCommission: CommissionDecision;
  assessment: DemandAssessment;
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
  const { stay, settings, demand, policy = CURRENT_DYNAMIC_POLICY, strategy = rulesBaselineStrategy, conversionModel = null } = params;
  const nights = Math.max(1, stay.nights);
  const cap = Math.max(0, Math.min(ENGINE_LIMITS.maxAdjustmentPercent, settings.maxAdjustmentPercent ?? ENGINE_LIMITS.maxAdjustmentPercent));
  const step = ENGINE_LIMITS.stepPercent;
  const quantize = (p: number) => Math.max(-cap, Math.min(cap, Math.round(p / step) * step));
  const assessment = assessDemand(demand);
  const minStayPayout = settings.minHostPayoutPerNightCents === null ? null : settings.minHostPayoutPerNightCents * nights;

  // Candidates are judged without the host-minimum fee cap, so smart pricing
  // never picks a price that only works because FYStay waived its fee; the
  // price actually charged has the cap (see commissionDecision).
  const context = (protectHost: boolean): CommissionContext => ({
    leadDays: assessment.leadDays,
    demand: assessment.demand,
    season: assessment.season,
    townActiveListings: assessment.townActiveListings,
    hostMinPayoutCents: protectHost ? minStayPayout : null,
  });
  const priceAt = (percent: number, protectHost: boolean, baseAccommodationCents?: number) => {
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
      commissionContext: context(protectHost),
    });
  };

  const basePricing = priceAt(0, true);
  const baseAccommodationCents = basePricing.totalPriceCents;
  const proposal = strategy.propose(demand);
  const proposedAdjustmentPercent = quantize(proposal.adjustmentPercent);

  const candidates: PriceCandidate[] = [];
  for (let percent = -cap; percent <= cap; percent += step) {
    const pricing = priceAt(percent, false, baseAccommodationCents);
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
  const pricing = adjustmentPercent === 0 ? basePricing : priceAt(adjustmentPercent, true, baseAccommodationCents);
  const commission = commissionDecision(policy, { ...context(true), accommodationCents: pricing.totalPriceCents, baseAccommodationCents });
  const baseCommission = commissionDecision(policy, { ...context(true), accommodationCents: baseAccommodationCents });
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
    commission,
    baseCommission,
    assessment,
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
    return `Your minimum payout can't be above what your own price pays you at FYStay's lowest commission (${pounds(basePayoutPerNightCents)} a night)`;
  }
  if (settings.enabled && settings.minHostPayoutPerNightCents === null) return "Set the minimum you'll accept per night before turning smart pricing on";
  return null;
}
