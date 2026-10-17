/**
 * FYStay's commission policies - the one place a commission rate lives.
 *
 * How money moves (unchanged by this module, see /api/checkout): the guest
 * pays the stay's price and nothing on top; Stripe moves it to the host's
 * Connect account as a destination charge and FYStay keeps its fee as the
 * application fee. Referral credit and promo codes are FYStay's marketing
 * cost, taken out of that fee, never the host's payout. Stripe's processing
 * fee on a destination charge is paid by the platform, so it comes out of
 * FYStay's fee too - the host's payout is never reduced by it.
 *
 * Every booking stores the policy version and effective rate it was priced
 * with (Booking.pricingPolicyVersion / commissionRateBps), so a later policy
 * change never reprices a booking that already exists. A booking with no
 * version predates this module and was priced with LEGACY_FIXED_10.
 *
 * Commercial figures here are business decisions, not engineering ones: see
 * docs/pricing-policy.md for the formula, the reason for each input, and
 * which figures need the owner's approval.
 */

/** Basis points: 1000 = 10%. Integer so no rate is ever a float. */
export type BasisPoints = number;

export type SignalConfidence = "high" | "medium" | "low" | "none";
export type SignalLevel = "high" | "normal" | "low";

/**
 * A commission policy: a base rate plus adjustments, each tied to a business
 * reason and, where it reads market data, applied only when that data is
 * reliable. Every figure in DYNAMIC_COMMISSION_V1 is provisional until the
 * owner approves it (docs/pricing-policy.md, "Decisions needed").
 */
export type CommissionPolicy = {
  /** Stored on every booking priced with it; never reused for different figures. */
  version: string;
  label: string;
  baseRateBps: BasisPoints;
  /** The rate is always kept within these, whatever the adjustments add up to. */
  minRateBps: BasisPoints;
  maxRateBps: BasisPoints;
  /**
   * Booking value: the first band the stay's accommodation is below applies
   * (null = no upper limit). Per-booking costs (Stripe's 20p, support,
   * payment risk) are a bigger share of a small booking than a large one.
   */
  valueBands: { belowCents: number | null; adjustBps: BasisPoints }[];
  /**
   * Bookings made this far ahead: more likely to be cancelled, and on a
   * refund Stripe keeps its processing fee - FYStay's cost.
   */
  longLead: { fromDays: number; adjustBps: BasisPoints } | null;
  /** Applied up for high demand, down for low - only when the demand data is medium or high confidence. */
  demandAdjustBps: BasisPoints;
  /** The same for seasonality from FYStay's own history (none until FYStay has a year of it). */
  seasonAdjustBps: BasisPoints;
  /**
   * Market depth: fewer than this many active FYStay listings in the town -
   * a lower rate while FYStay builds supply there. Listing counts are
   * FYStay's own data, so this is never a guess.
   */
  thinMarket: { belowListings: number; adjustBps: BasisPoints } | null;
  /**
   * FYStay's share of any amount smart pricing adds above the host's own
   * price, on top of the rate. 0: a price rise goes to the host at the rate.
   */
  upliftShareBps: BasisPoints;
  /**
   * The fee covers at least the estimated Stripe processing fee plus this
   * much (within maxRateBps), so a booking never costs FYStay money to take.
   * Null: no floor.
   */
  minContributionCents: number | null;
};

/**
 * The fixed 10% every booking has used since 11 Oct 2026. Kept only for:
 * bookings priced before versions existed (pricingPolicyVersion null),
 * listings whose host hasn't agreed to the dynamic policy, hotel room types,
 * and rollback (SMART_PRICING_MODE=off). Never a new default.
 */
export const LEGACY_FIXED_10: CommissionPolicy = {
  version: "fixed-10-v1",
  label: "Fixed 10% commission",
  baseRateBps: 1000,
  minRateBps: 1000,
  maxRateBps: 1000,
  valueBands: [],
  longLead: null,
  demandAdjustBps: 0,
  seasonAdjustBps: 0,
  thinMarket: null,
  upliftShareBps: 0,
  minContributionCents: null,
};

/**
 * The dynamic commission. PROVISIONAL figures, chosen to be explainable and
 * close to today's 10% so the shadow comparison is meaningful - the owner
 * approves (or replaces) them before any host is charged under it, and a
 * change is a new version, never an edit (bookings keep their version).
 */
export const DYNAMIC_COMMISSION_V1: CommissionPolicy = {
  version: "dynamic-v1",
  label: "FYStay dynamic commission",
  baseRateBps: 1000,
  minRateBps: 800,
  maxRateBps: 1500,
  valueBands: [
    { belowCents: 15_000, adjustBps: 150 },
    { belowCents: 60_000, adjustBps: 0 },
    { belowCents: 150_000, adjustBps: -50 },
    { belowCents: null, adjustBps: -100 },
  ],
  longLead: { fromDays: 120, adjustBps: 50 },
  demandAdjustBps: 50,
  seasonAdjustBps: 50,
  thinMarket: { belowListings: 5, adjustBps: -100 },
  upliftShareBps: 1000,
  minContributionCents: 50,
};

/** The dynamic policy hosts are asked to agree to now; a new version needs their agreement again. */
export const CURRENT_DYNAMIC_POLICY = DYNAMIC_COMMISSION_V1;

const POLICIES: Record<string, CommissionPolicy> = {
  [LEGACY_FIXED_10.version]: LEGACY_FIXED_10,
  [DYNAMIC_COMMISSION_V1.version]: DYNAMIC_COMMISSION_V1,
};

/** The policy a booking was priced with; bookings from before versions existed used the fixed 10%. */
export function policyForVersion(version: string | null | undefined): CommissionPolicy {
  return (version && POLICIES[version]) || LEGACY_FIXED_10;
}

const applyBps = (cents: number, bps: BasisPoints) => Math.round((cents * bps) / 10_000);

/** What the commission can respond to beyond the stay's price. Every field is optional: missing data adds nothing. */
export type CommissionContext = {
  /** Days from booking to check-in. */
  leadDays?: number | null;
  demand?: { level: SignalLevel; confidence: SignalConfidence } | null;
  season?: { level: SignalLevel; confidence: SignalConfidence } | null;
  /** Active single-unit FYStay listings in the town. Null: unknown. */
  townActiveListings?: number | null;
  /**
   * The host's minimum payout for the whole stay. FYStay's fee is reduced
   * (down to the policy's minimum rate) rather than pay the host less.
   */
  hostMinPayoutCents?: number | null;
};

export type CommissionComponent = {
  name: "base" | "booking_value" | "lead_time" | "demand" | "season" | "market" | "rate_bounds" | "uplift_share" | "cost_floor" | "host_minimum" | "accommodation_cap";
  /** Change to the rate (bps) or, for fee-level steps, to the fee (pence). */
  bps?: BasisPoints;
  cents?: number;
  reason: string;
};

export type CommissionDecision = {
  policyVersion: string;
  feeCents: number;
  /** The fee as basis points of the accommodation (stored on the booking). */
  rateBps: BasisPoints;
  components: CommissionComponent[];
};

const reliable = (c: SignalConfidence | undefined) => c === "high" || c === "medium";
const money = (cents: number) => `£${(cents / 100).toFixed(2)}`;

/**
 * FYStay's fee on a stay, and why. `baseAccommodationCents` is the stay at
 * the host's own price (the same as accommodationCents unless smart pricing
 * changed it). Steps, in order:
 *  1. rate = base + booking value + lead time + demand + season + market,
 *     kept within [minRate, maxRate];
 *  2. fee = accommodation x rate, plus the uplift share of any smart-pricing rise;
 *  3. raised to cover the estimated card fee + minimum contribution, never
 *     beyond maxRate;
 *  4. lowered so the host gets their minimum payout, never below minRate;
 *  5. never more than the accommodation itself.
 * Integer pence and basis points, rounded to the nearest penny per step.
 */
export function commissionDecision(
  policy: CommissionPolicy,
  stay: { accommodationCents: number; baseAccommodationCents?: number } & CommissionContext,
): CommissionDecision {
  const accommodation = Math.max(0, stay.accommodationCents);
  const base = Math.max(0, stay.baseAccommodationCents ?? accommodation);
  const components: CommissionComponent[] = [{ name: "base", bps: policy.baseRateBps, reason: "base rate" }];
  let rate = policy.baseRateBps;
  const adjust = (component: CommissionComponent) => {
    if (!component.bps) return;
    rate += component.bps;
    components.push(component);
  };

  const band = policy.valueBands.find((b) => b.belowCents === null || accommodation < b.belowCents);
  if (band) {
    adjust({
      name: "booking_value",
      bps: band.adjustBps,
      reason: band.adjustBps > 0 ? `small booking (under ${money(band.belowCents ?? 0)}): fixed per-booking costs` : `larger booking: per-booking costs spread further`,
    });
  }
  if (policy.longLead && stay.leadDays !== null && stay.leadDays !== undefined && stay.leadDays >= policy.longLead.fromDays) {
    adjust({ name: "lead_time", bps: policy.longLead.adjustBps, reason: `booked ${stay.leadDays} days ahead: higher cancellation exposure` });
  }
  if (stay.demand && stay.demand.level !== "normal" && reliable(stay.demand.confidence)) {
    adjust({ name: "demand", bps: stay.demand.level === "high" ? policy.demandAdjustBps : -policy.demandAdjustBps, reason: `${stay.demand.level} demand (${stay.demand.confidence} confidence)` });
  }
  if (stay.season && stay.season.level !== "normal" && reliable(stay.season.confidence)) {
    adjust({ name: "season", bps: stay.season.level === "high" ? policy.seasonAdjustBps : -policy.seasonAdjustBps, reason: `${stay.season.level} season (${stay.season.confidence} confidence)` });
  }
  if (policy.thinMarket && stay.townActiveListings !== null && stay.townActiveListings !== undefined && stay.townActiveListings < policy.thinMarket.belowListings) {
    adjust({ name: "market", bps: policy.thinMarket.adjustBps, reason: `${stay.townActiveListings} active FYStay listing${stay.townActiveListings === 1 ? "" : "s"} in the town: building supply` });
  }
  const boundedRate = Math.min(Math.max(rate, policy.minRateBps), policy.maxRateBps);
  if (boundedRate !== rate) components.push({ name: "rate_bounds", bps: boundedRate - rate, reason: `kept within ${formatRate(policy.minRateBps)}-${formatRate(policy.maxRateBps)}` });

  const maxFee = applyBps(accommodation, policy.maxRateBps);
  const minFee = applyBps(accommodation, policy.minRateBps);
  let fee = applyBps(accommodation, boundedRate);
  const uplift = applyBps(Math.max(0, accommodation - base), policy.upliftShareBps);
  if (uplift > 0) {
    const added = Math.min(uplift, Math.max(0, maxFee - fee));
    fee += added;
    components.push({ name: "uplift_share", cents: added, reason: `${formatRate(policy.upliftShareBps)} of the smart-pricing rise above your own price` });
  }
  if (policy.minContributionCents !== null && accommodation > 0) {
    const floor = Math.min(estimatedProcessingFeeCents(accommodation) + policy.minContributionCents, maxFee);
    if (fee < floor) {
      components.push({ name: "cost_floor", cents: floor - fee, reason: "covers the card processing fee FYStay pays" });
      fee = floor;
    }
  }
  if (stay.hostMinPayoutCents !== null && stay.hostMinPayoutCents !== undefined) {
    const allowed = Math.max(minFee, accommodation - stay.hostMinPayoutCents);
    if (fee > allowed) {
      components.push({ name: "host_minimum", cents: allowed - fee, reason: "reduced so you receive your minimum payout" });
      fee = allowed;
    }
  }
  if (fee > accommodation) {
    components.push({ name: "accommodation_cap", cents: accommodation - fee, reason: "never more than the stay itself" });
    fee = accommodation;
  }
  return { policyVersion: policy.version, feeCents: fee, rateBps: effectiveRateBps(fee, accommodation), components };
}

/** FYStay's fee on a stay (see commissionDecision). */
export function platformFeeCents(
  policy: CommissionPolicy,
  stay: { accommodationCents: number; baseAccommodationCents?: number } & CommissionContext,
): number {
  return commissionDecision(policy, stay).feeCents;
}

/**
 * The fee as a whole number of basis points of the accommodation - stored
 * on the booking so a later date change moves FYStay's fee at the same rate
 * the stay was booked at (see splitBookingChange).
 */
export function effectiveRateBps(feeCents: number, accommodationCents: number): BasisPoints {
  if (accommodationCents <= 0) return 0;
  return Math.round((feeCents * 10_000) / accommodationCents);
}

/** The rate a booking's commission moves at; bookings without one were priced at the fixed 10%. */
export function bookingCommissionRateBps(booking: { commissionRateBps?: number | null }): BasisPoints {
  return booking.commissionRateBps ?? LEGACY_FIXED_10.baseRateBps;
}

/** "10%" or "12.5%" - for host-facing text that has to stay true when a rate changes. */
export function formatRate(bps: BasisPoints): string {
  const percent = bps / 100;
  return `${Number.isInteger(percent) ? percent : percent.toFixed(1)}%`;
}

/**
 * An estimate of Stripe's processing fee on a charge, for contribution
 * estimates only - never charged to anyone. Stripe's standard UK card rate
 * (1.5% + 20p); European and international cards cost more, so the actual
 * fee is read back from Stripe after payment (Booking.stripeProcessingFeeCents).
 */
export const PROCESSING_FEE_ESTIMATE = { rateBps: 150, fixedCents: 20 } as const;

export function estimatedProcessingFeeCents(chargeCents: number): number {
  if (chargeCents <= 0) return 0;
  return applyBps(chargeCents, PROCESSING_FEE_ESTIMATE.rateBps) + PROCESSING_FEE_ESTIMATE.fixedCents;
}

export type StayFinancials = {
  /** What the guest is charged. */
  guestTotalCents: number;
  /** FYStay's fee before discounts (Booking.hostCommissionCents for commission bookings). */
  platformFeeCents: number;
  /** Referral credit + promo discount, funded by FYStay out of its fee. */
  platformFundedDiscountCents: number;
  /** Stripe's application fee: the fee less what FYStay funds, never below 0. */
  applicationFeeCents: number;
  /** The host's transfer: everything the guest paid less the application fee. */
  hostPayoutCents: number;
  /** Estimated (or actual, when known) Stripe processing fee - FYStay's cost. */
  processingFeeCents: number;
  processingFeeIsEstimate: boolean;
  /** FYStay's contribution: application fee less processing. Can be negative on a small booking. */
  contributionCents: number;
};

/**
 * The financial split of one stay, from the same figures checkout charges
 * (see /api/checkout and hostPayoutCents) - so quotes, host earnings and
 * reports all add up to what Stripe actually moves.
 */
export function stayFinancials(params: {
  /** Accommodation after stay discounts, before credit/promo. */
  accommodationCents: number;
  platformFeeCents: number;
  platformFundedDiscountCents?: number;
  /** Stripe's actual fee, once known. */
  actualProcessingFeeCents?: number | null;
}): StayFinancials {
  const discount = Math.min(Math.max(0, params.platformFundedDiscountCents ?? 0), params.accommodationCents);
  const guestTotalCents = params.accommodationCents - discount;
  const applicationFeeCents = Math.max(0, params.platformFeeCents - discount);
  const hostPayoutCents = Math.max(0, guestTotalCents - applicationFeeCents);
  const actual = params.actualProcessingFeeCents;
  const processingFeeCents = actual ?? estimatedProcessingFeeCents(guestTotalCents);
  return {
    guestTotalCents,
    platformFeeCents: params.platformFeeCents,
    platformFundedDiscountCents: discount,
    applicationFeeCents,
    hostPayoutCents,
    processingFeeCents,
    processingFeeIsEstimate: actual === null || actual === undefined,
    contributionCents: applicationFeeCents - processingFeeCents,
  };
}

/**
 * The standard commission as shown to hosts ("10%"), for every page and
 * email that describes it - so a future rate change can't leave a stale
 * figure behind. A booking's own rate is Booking.commissionRateBps.
 */
export const STANDARD_COMMISSION_RATE_TEXT = formatRate(LEGACY_FIXED_10.baseRateBps);

const points = (bps: BasisPoints) => {
  const value = Math.abs(bps) / 100;
  return `${bps > 0 ? "+" : "-"}${Number.isInteger(value) ? value : value.toFixed(1)} point${value === 1 ? "" : "s"}`;
};

/**
 * The policy in plain words, built from its own figures so what a host
 * agrees to is always exactly what's charged.
 */
export function describeCommissionPolicy(policy: CommissionPolicy): string[] {
  const lines = [`Starts at ${formatRate(policy.baseRateBps)} of what the guest pays for the stay.`];
  let from = 0;
  for (const band of policy.valueBands) {
    if (band.adjustBps !== 0) {
      const range = band.belowCents === null ? `of ${money(from)} or more` : from === 0 ? `under ${money(band.belowCents)}` : `of ${money(from)} to ${money(band.belowCents - 1)}`;
      lines.push(`${points(band.adjustBps)} on bookings ${range}.`);
    }
    from = band.belowCents ?? from;
  }
  if (policy.longLead) lines.push(`${points(policy.longLead.adjustBps)} on bookings made ${policy.longLead.fromDays} or more days ahead.`);
  if (policy.demandAdjustBps) lines.push(`${points(policy.demandAdjustBps)} or ${points(-policy.demandAdjustBps)} when FYStay's own bookings reliably show high or low demand in your town.`);
  if (policy.seasonAdjustBps) lines.push(`${points(policy.seasonAdjustBps)} or ${points(-policy.seasonAdjustBps)} in a reliably high or low season (needs a year of FYStay bookings).`);
  if (policy.thinMarket) lines.push(`${points(policy.thinMarket.adjustBps)} while fewer than ${policy.thinMarket.belowListings} FYStay listings are live in your town.`);
  if (policy.upliftShareBps) lines.push(`Plus ${formatRate(policy.upliftShareBps)} of any amount smart pricing adds above your own price.`);
  if (policy.minContributionCents !== null) lines.push(`At least enough to cover the card processing fee FYStay pays.`);
  lines.push(`Always between ${commissionRangeText(policy)}, and never so much that you get less than your minimum payout (your own stay discount is limited for a stay if that is needed to pay it).`);
  return lines;
}

/**
 * FYStay's commission as general host-facing copy describes it, true in
 * every SMART_PRICING_MODE: only "on" charges anyone the dynamic policy,
 * and then only on listings whose host agreed to it. A booking's own rate
 * is Booking.commissionRateBps.
 */
export function hostCommissionText(mode: "off" | "shadow" | "on"): string {
  return mode === "on"
    ? `${STANDARD_COMMISSION_RATE_TEXT} (${commissionRangeText(CURRENT_DYNAMIC_POLICY)}, worked out per booking, on listings where you've turned on smart pricing)`
    : STANDARD_COMMISSION_RATE_TEXT;
}

/** "8%-15%": the range a host agrees to under a dynamic policy. */
export function commissionRangeText(policy: CommissionPolicy): string {
  return `${formatRate(policy.minRateBps)}-${formatRate(policy.maxRateBps)}`;
}
