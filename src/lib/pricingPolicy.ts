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
 * docs/pricing-policy.md for which need approval before they change.
 */

/** Basis points: 1000 = 10%. Integer so no rate is ever a float. */
export type BasisPoints = number;

export type CommissionPolicy = {
  /** Stored on every booking priced with it; never reused for different figures. */
  version: string;
  label: string;
  /** FYStay's fee as a share of the stay's accommodation (after stay discounts). */
  baseRateBps: BasisPoints;
  /**
   * FYStay's share of any amount smart pricing adds above the host's own
   * price for the stay. 0 means a price rise goes entirely to the host.
   */
  upliftShareBps: BasisPoints;
  /** The effective fee is kept within these shares of the accommodation. */
  minRateBps: BasisPoints;
  maxRateBps: BasisPoints;
};

/** The fixed 10% every booking has used since 11 Oct 2026. The default, and the rollback. */
export const LEGACY_FIXED_10: CommissionPolicy = {
  version: "fixed-10-v1",
  label: "Fixed 10% commission",
  baseRateBps: 1000,
  upliftShareBps: 0,
  minRateBps: 1000,
  maxRateBps: 1000,
};

/**
 * The policy for stays priced by smart pricing. Until the owner approves a
 * schedule, its figures equal the fixed 10% (upliftShareBps 0): smart pricing
 * changes the price, never the rate. Change the figures only by adding a new
 * version - existing bookings keep the version they were priced with.
 */
export const SMART_PRICING_V1: CommissionPolicy = {
  version: "smart-v1",
  label: "Smart pricing commission",
  baseRateBps: 1000,
  upliftShareBps: 0, // APPROVAL REQUIRED before any non-zero value
  minRateBps: 1000,
  maxRateBps: 2000,
};

const POLICIES: Record<string, CommissionPolicy> = {
  [LEGACY_FIXED_10.version]: LEGACY_FIXED_10,
  [SMART_PRICING_V1.version]: SMART_PRICING_V1,
};

/** The policy a booking was priced with; bookings from before versions existed used the fixed 10%. */
export function policyForVersion(version: string | null | undefined): CommissionPolicy {
  return (version && POLICIES[version]) || LEGACY_FIXED_10;
}

const applyBps = (cents: number, bps: BasisPoints) => Math.round((cents * bps) / 10_000);

/**
 * FYStay's fee on a stay. `baseAccommodationCents` is what the stay would
 * have cost at the host's own price (the same as accommodationCents when
 * smart pricing didn't change it). Rounded once per component to the
 * nearest penny, then kept within the policy's bounds and never more than
 * the accommodation itself.
 */
export function platformFeeCents(
  policy: CommissionPolicy,
  stay: { accommodationCents: number; baseAccommodationCents?: number },
): number {
  const accommodation = Math.max(0, stay.accommodationCents);
  const base = Math.max(0, stay.baseAccommodationCents ?? accommodation);
  const fee = applyBps(accommodation, policy.baseRateBps) + applyBps(Math.max(0, accommodation - base), policy.upliftShareBps);
  const bounded = Math.min(Math.max(fee, applyBps(accommodation, policy.minRateBps)), applyBps(accommodation, policy.maxRateBps));
  return Math.min(bounded, accommodation);
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
