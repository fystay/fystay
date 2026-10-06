import { differenceInCalendarDays, subDays } from "date-fns";

/**
 * A host's refund rules for a guest-initiated cancellation. Modeled as an
 * ordered list of tiers - "if you cancel at least N days before check-in,
 * you get X% back" - rather than a single hardcoded rule, so the platform
 * can support materially different policies (and, for CUSTOM, a host's own
 * numbers) without a code change anywhere a refund is computed. Every
 * caller goes through resolveCancellationPolicy + computeCancellationRefund
 * rather than hand-rolling refund math against a listing's raw fields.
 */
export type CancellationPolicyKind = "FLEXIBLE" | "MODERATE" | "STRICT" | "CUSTOM";

export type CancellationPolicyTier = {
  /** This tier applies once at least this many days remain before check-in. */
  minDaysBeforeCheckIn: number;
  refundPercent: number;
};

export type CancellationPolicy = {
  kind: CancellationPolicyKind;
  label: string;
  description: string;
  /** Must include a tier with minDaysBeforeCheckIn: 0 as the final fallback. */
  tiers: CancellationPolicyTier[];
};

const FLEXIBLE: CancellationPolicy = {
  kind: "FLEXIBLE",
  label: "Flexible",
  description: "Full refund if you cancel at least 1 day before check-in. No refund after that.",
  tiers: [
    { minDaysBeforeCheckIn: 1, refundPercent: 100 },
    { minDaysBeforeCheckIn: 0, refundPercent: 0 },
  ],
};

const MODERATE: CancellationPolicy = {
  kind: "MODERATE",
  label: "Moderate",
  description:
    "Full refund if you cancel at least 5 days before check-in. 50% refund up to 1 day before. No refund after that.",
  tiers: [
    { minDaysBeforeCheckIn: 5, refundPercent: 100 },
    { minDaysBeforeCheckIn: 1, refundPercent: 50 },
    { minDaysBeforeCheckIn: 0, refundPercent: 0 },
  ],
};

const STRICT: CancellationPolicy = {
  kind: "STRICT",
  label: "Strict",
  description: "50% refund if you cancel at least 7 days before check-in. No refund after that.",
  tiers: [
    { minDaysBeforeCheckIn: 7, refundPercent: 50 },
    { minDaysBeforeCheckIn: 0, refundPercent: 0 },
  ],
};

const DEFAULT_CUSTOM_CUTOFF_DAYS = 7;
const DEFAULT_CUSTOM_REFUND_PERCENT = 50;

/** Turns a listing's stored policy choice into the concrete rules to apply. */
export function resolveCancellationPolicy(listing: {
  cancellationPolicy: CancellationPolicyKind;
  customCancellationCutoffDays?: number | null;
  customCancellationRefundPercent?: number | null;
}): CancellationPolicy {
  switch (listing.cancellationPolicy) {
    case "FLEXIBLE":
      return FLEXIBLE;
    case "STRICT":
      return STRICT;
    case "CUSTOM": {
      const cutoff = listing.customCancellationCutoffDays ?? DEFAULT_CUSTOM_CUTOFF_DAYS;
      const percent = listing.customCancellationRefundPercent ?? DEFAULT_CUSTOM_REFUND_PERCENT;
      return {
        kind: "CUSTOM",
        label: "Custom",
        description: `${percent}% refund if you cancel at least ${cutoff} day${cutoff === 1 ? "" : "s"} before check-in. No refund after that.`,
        tiers: [
          { minDaysBeforeCheckIn: cutoff, refundPercent: percent },
          { minDaysBeforeCheckIn: 0, refundPercent: 0 },
        ],
      };
    }
    case "MODERATE":
    default:
      return MODERATE;
  }
}

/**
 * Whole calendar days between now and check-in (not exact 24-hour periods,
 * so cancelling at 11pm the day before check-in still counts as "1 day
 * before", matching how a guest or host would describe it); negative once
 * check-in's calendar date has passed.
 */
export function daysBeforeCheckIn(checkIn: Date, now: Date = new Date()): number {
  return differenceInCalendarDays(checkIn, now);
}

export type CancellationRefund = {
  refundPercent: number;
  refundCents: number;
  nonRefundableCents: number;
};

/**
 * The single source of truth for what a cancellation actually pays back.
 * Never trust a refund amount computed anywhere else (a request body, a UI
 * preview from an earlier render): recompute this from the current policy,
 * the amount actually paid, and the current time immediately before issuing
 * a refund.
 */
export function computeCancellationRefund(params: {
  policy: CancellationPolicy;
  amountPaidCents: number;
  checkIn: Date;
  now?: Date;
}): CancellationRefund {
  const { policy, amountPaidCents, checkIn, now = new Date() } = params;

  if (amountPaidCents <= 0) {
    return { refundPercent: 0, refundCents: 0, nonRefundableCents: 0 };
  }

  const days = daysBeforeCheckIn(checkIn, now);
  const tier = [...policy.tiers]
    .sort((a, b) => b.minDaysBeforeCheckIn - a.minDaysBeforeCheckIn)
    .find((t) => days >= t.minDaysBeforeCheckIn);
  const refundPercent = tier?.refundPercent ?? 0;
  const refundCents = Math.round((amountPaidCents * refundPercent) / 100);

  return { refundPercent, refundCents, nonRefundableCents: amountPaidCents - refundCents };
}

/**
 * Where a stay stands under its policy today: the refund a cancellation
 * right now would give, and the last day that refund still applies (null
 * once nothing is refundable) - the same tiers computeCancellationRefund
 * charges by, so "Free cancellation until 1 Dec" is exactly what the
 * cancel button will do on 1 Dec. A tier for N days applies while at least
 * N calendar days remain, i.e. up to and including check-in minus N days.
 */
export function cancellationStanding(
  policy: CancellationPolicy,
  checkIn: Date,
  now: Date = new Date(),
): { refundPercent: number; until: Date | null } {
  const days = daysBeforeCheckIn(checkIn, now);
  const tier = [...policy.tiers]
    .sort((a, b) => b.minDaysBeforeCheckIn - a.minDaysBeforeCheckIn)
    .find((t) => days >= t.minDaysBeforeCheckIn);
  const refundPercent = tier?.refundPercent ?? 0;
  return { refundPercent, until: refundPercent > 0 && tier ? subDays(checkIn, tier.minDaysBeforeCheckIn) : null };
}

export type CancellationPreview = CancellationRefund & {
  policyLabel: string;
  policyDescription: string;
  amountPaidCents: number;
};

/**
 * Bundles resolveCancellationPolicy + computeCancellationRefund into the one
 * shape both the pre-cancellation preview (shown before a guest confirms)
 * and the actual cancel endpoint need, so they can never disagree with each
 * other about what a cancellation is going to cost.
 *
 * refundPercentOverride lets a caller (only the admin manual-cancel route,
 * today - see src/lib/bookingCancellation.ts) bypass the listing's own
 * policy tiers entirely and apply one flat percentage instead, for a
 * goodwill or otherwise manual refund decision. It still goes through
 * computeCancellationRefund like every other path, so the actual cents math
 * (rounding, capping at amountPaidCents) is never duplicated.
 */
export function previewCancellation(params: {
  listing: {
    cancellationPolicy: CancellationPolicyKind;
    customCancellationCutoffDays?: number | null;
    customCancellationRefundPercent?: number | null;
  };
  /** Whether the booking has actually been paid for; anything else means nothing to refund. */
  wasPaid: boolean;
  totalPriceCents: number;
  checkIn: Date;
  now?: Date;
  refundPercentOverride?: number;
}): CancellationPreview {
  const { listing, wasPaid, totalPriceCents, checkIn, now, refundPercentOverride } = params;
  const amountPaidCents = wasPaid ? totalPriceCents : 0;
  const policy: CancellationPolicy =
    refundPercentOverride === undefined
      ? resolveCancellationPolicy(listing)
      : {
          kind: "CUSTOM",
          label: "Manual override",
          description: `Support set the refund to ${refundPercentOverride}%, overriding the listing's own cancellation policy.`,
          tiers: [{ minDaysBeforeCheckIn: 0, refundPercent: refundPercentOverride }],
        };
  const refund = computeCancellationRefund({ policy, amountPaidCents, checkIn, now });
  return { policyLabel: policy.label, policyDescription: policy.description, amountPaidCents, ...refund };
}
