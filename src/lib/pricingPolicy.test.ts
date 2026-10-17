import { describe, expect, it } from "vitest";
import {
  bookingCommissionRateBps,
  commissionDecision,
  commissionRangeText,
  CURRENT_DYNAMIC_POLICY,
  describeCommissionPolicy,
  DYNAMIC_COMMISSION_V1,
  effectiveRateBps,
  estimatedProcessingFeeCents,
  formatRate,
  LEGACY_FIXED_10,
  platformFeeCents,
  policyForVersion,
  stayFinancials,
  type CommissionContext,
  type CommissionPolicy,
} from "./pricingPolicy";
import { splitBookingChange } from "./pricing";

const D = DYNAMIC_COMMISSION_V1;
const fee = (accommodationCents: number, context: CommissionContext & { baseAccommodationCents?: number } = {}) =>
  commissionDecision(D, { accommodationCents, ...context });
const names = (decision: ReturnType<typeof commissionDecision>) => decision.components.map((c) => c.name);

describe("the fixed 10% (legacy, rollback)", () => {
  it("is exactly the old 10%, rounding to the nearest penny", () => {
    for (const cents of [0, 1, 4, 5, 15, 9_999, 12_345, 1_000_000]) {
      expect(platformFeeCents(LEGACY_FIXED_10, { accommodationCents: cents })).toBe(Math.round(cents * 0.1));
    }
  });

  it("ignores every dynamic input", () => {
    const busy = { leadDays: 200, demand: { level: "high", confidence: "high" }, season: { level: "high", confidence: "high" }, townActiveListings: 1 } as const;
    expect(platformFeeCents(LEGACY_FIXED_10, { accommodationCents: 30_000, baseAccommodationCents: 20_000, ...busy })).toBe(3_000);
  });
});

describe("dynamic commission", () => {
  it("is the base rate on a mid-sized booking with no other information", () => {
    expect(fee(30_000)).toMatchObject({ feeCents: 3_000, rateBps: 1000, policyVersion: "dynamic-v1" });
  });

  it("charges more on small bookings and less on large ones (booking value)", () => {
    expect(fee(8_000)).toMatchObject({ feeCents: 920, rateBps: 1150 });
    expect(fee(80_000)).toMatchObject({ feeCents: 7_600, rateBps: 950 });
    expect(fee(200_000)).toMatchObject({ feeCents: 18_000, rateBps: 900 });
    // Band edges: below the limit is in the band, at the limit is the next one.
    expect(fee(14_999).rateBps).toBe(1150);
    expect(fee(15_000).rateBps).toBe(1000);
  });

  it("adds a little for bookings made far ahead (lead time)", () => {
    expect(fee(30_000, { leadDays: 119 }).feeCents).toBe(3_000);
    expect(fee(30_000, { leadDays: 120 })).toMatchObject({ feeCents: 3_150, rateBps: 1050 });
  });

  it("moves with demand and season only when the data behind them is reliable", () => {
    expect(fee(30_000, { demand: { level: "high", confidence: "low" } }).feeCents).toBe(3_000);
    expect(fee(30_000, { demand: { level: "high", confidence: "none" } }).feeCents).toBe(3_000);
    expect(fee(30_000, { demand: { level: "high", confidence: "medium" } }).feeCents).toBe(3_150);
    expect(fee(30_000, { demand: { level: "low", confidence: "high" } }).feeCents).toBe(2_850);
    expect(fee(30_000, { season: { level: "low", confidence: "medium" } }).feeCents).toBe(2_850);
    expect(fee(30_000, { season: { level: "normal", confidence: "high" } }).feeCents).toBe(3_000);
  });

  it("is lower while a town has few FYStay listings (market), and unchanged when the count is unknown", () => {
    expect(fee(30_000, { townActiveListings: 2 })).toMatchObject({ feeCents: 2_700, rateBps: 900 });
    expect(fee(30_000, { townActiveListings: 5 }).feeCents).toBe(3_000);
    expect(fee(30_000, { townActiveListings: null }).feeCents).toBe(3_000);
  });

  it("keeps the rate within its bounds and says so", () => {
    const steep: CommissionPolicy = { ...D, baseRateBps: 1450 };
    const decision = commissionDecision(steep, { accommodationCents: 8_000, leadDays: 200 });
    expect(decision.rateBps).toBe(1500);
    expect(names(decision)).toContain("rate_bounds");
    const shallow: CommissionPolicy = { ...D, baseRateBps: 700 };
    expect(commissionDecision(shallow, { accommodationCents: 30_000 }).rateBps).toBe(800);
  });

  it("takes a share of a smart-pricing rise only, never of a cut, and never beyond the maximum rate", () => {
    // £315 at a £300 own price: 10% of £315 + 10% of the £15 rise.
    expect(fee(31_500, { baseAccommodationCents: 30_000 }).feeCents).toBe(3_150 + 150);
    expect(fee(28_500, { baseAccommodationCents: 30_000 }).feeCents).toBe(2_850);
    const greedy: CommissionPolicy = { ...D, upliftShareBps: 10_000 };
    expect(commissionDecision(greedy, { accommodationCents: 34_500, baseAccommodationCents: 30_000 }).feeCents).toBe(Math.round(34_500 * 0.15));
  });

  it("covers the card fee FYStay pays (cost floor), but never beyond the maximum rate", () => {
    const thin: CommissionPolicy = { ...D, baseRateBps: 800, valueBands: [] };
    // £10: 8% = 80p; the card fee estimate (15p + 20p) + 50p minimum = 85p.
    const decision = commissionDecision(thin, { accommodationCents: 1_000 });
    expect(decision.feeCents).toBe(85);
    expect(names(decision)).toContain("cost_floor");
    // £1: the floor (72p) is more than 15% (15p), so 15% it is.
    expect(commissionDecision(thin, { accommodationCents: 100 }).feeCents).toBe(15);
  });

  it("is reduced so the host gets their minimum payout - but only down to the minimum rate", () => {
    const protectedFee = fee(30_000, { hostMinPayoutCents: 27_500 });
    expect(protectedFee.feeCents).toBe(2_500);
    expect(names(protectedFee)).toContain("host_minimum");
    expect(fee(30_000, { hostMinPayoutCents: 29_000 }).feeCents).toBe(2_400);
    expect(fee(30_000, { hostMinPayoutCents: 20_000 }).feeCents).toBe(3_000);
  });

  it("is never more than the stay itself or below zero, and always whole pence", () => {
    expect(platformFeeCents({ ...LEGACY_FIXED_10, baseRateBps: 20_000, maxRateBps: 20_000 }, { accommodationCents: 100 })).toBe(100);
    expect(platformFeeCents(D, { accommodationCents: -500 })).toBe(0);
    for (const cents of [1, 333, 14_999, 77_777, 123_457]) {
      for (const leadDays of [0, 200]) {
        const decision = fee(cents, { leadDays, townActiveListings: 1, demand: { level: "high", confidence: "high" } });
        expect(Number.isInteger(decision.feeCents)).toBe(true);
        expect(decision.feeCents).toBeLessThanOrEqual(Math.round(cents * 0.15));
        expect(decision.feeCents).toBeGreaterThanOrEqual(Math.min(Math.round(cents * 0.08), cents));
      }
    }
  });

  it("is described to hosts from its own figures", () => {
    const lines = describeCommissionPolicy(D).join(" ");
    expect(commissionRangeText(D)).toBe("8%-15%");
    expect(lines).toContain("Starts at 10%");
    expect(lines).toContain("+1.5 points on bookings under £150.00");
    expect(lines).toContain("-1 point on bookings of £1500.00 or more");
    expect(lines).toContain("120 or more days ahead");
    expect(lines).toContain("Always between 8%-15%");
  });
});

describe("policy versions", () => {
  it("treats bookings with no version as the fixed 10%, and knows every version", () => {
    expect(policyForVersion(null)).toBe(LEGACY_FIXED_10);
    expect(policyForVersion("unknown")).toBe(LEGACY_FIXED_10);
    expect(policyForVersion("dynamic-v1")).toBe(DYNAMIC_COMMISSION_V1);
    expect(CURRENT_DYNAMIC_POLICY).toBe(DYNAMIC_COMMISSION_V1);
  });

  it("reads a booking's own rate, defaulting old bookings to 10%", () => {
    expect(bookingCommissionRateBps({})).toBe(1000);
    expect(bookingCommissionRateBps({ commissionRateBps: 1250 })).toBe(1250);
    expect(effectiveRateBps(3_960, 33_000)).toBe(1200);
    expect(effectiveRateBps(0, 0)).toBe(0);
    expect(formatRate(1000)).toBe("10%");
    expect(formatRate(1250)).toBe("12.5%");
  });
});

describe("stayFinancials", () => {
  it("splits a stay the way checkout charges it", () => {
    const money = stayFinancials({ accommodationCents: 30_000, platformFeeCents: 3_000 });
    expect(money).toMatchObject({ guestTotalCents: 30_000, applicationFeeCents: 3_000, hostPayoutCents: 27_000, processingFeeIsEstimate: true });
    expect(money.processingFeeCents).toBe(estimatedProcessingFeeCents(30_000));
    expect(money.contributionCents).toBe(3_000 - (450 + 20));
  });

  it("takes FYStay-funded discounts out of FYStay's fee, never the host's payout", () => {
    const money = stayFinancials({ accommodationCents: 30_000, platformFeeCents: 3_000, platformFundedDiscountCents: 2_000 });
    expect(money.guestTotalCents).toBe(28_000);
    expect(money.applicationFeeCents).toBe(1_000);
    expect(money.hostPayoutCents).toBe(27_000);
  });

  it("uses Stripe's actual fee once known, and shows a low-value stay can lose money", () => {
    expect(stayFinancials({ accommodationCents: 30_000, platformFeeCents: 3_000, actualProcessingFeeCents: 815 })).toMatchObject({
      processingFeeCents: 815,
      processingFeeIsEstimate: false,
      contributionCents: 2_185,
    });
    expect(stayFinancials({ accommodationCents: 1_000, platformFeeCents: 100, platformFundedDiscountCents: 100 }).contributionCents).toBeLessThan(0);
  });
});

describe("refunds", () => {
  it("leave Stripe's processing fee with FYStay: a fully refunded booking costs FYStay that fee", () => {
    // Stripe returns the guest's money and, with reverse_transfer and
    // refund_application_fee (connectRefunds.ts), the host's transfer and
    // FYStay's fee in proportion - but keeps its own processing fee.
    const money = stayFinancials({ accommodationCents: 30_000, platformFeeCents: 3_000, actualProcessingFeeCents: 470 });
    const refunded = 30_000;
    const feeReturned = Math.round((money.applicationFeeCents * refunded) / money.guestTotalCents);
    expect(money.applicationFeeCents - feeReturned - money.processingFeeCents).toBe(-470);
  });
});

describe("splitBookingChange at the booking's own rate", () => {
  const booking = { totalPriceCents: 30_000, cleaningFeeCents: 0, serviceFeeCents: 0, taxCents: 0, creditAppliedCents: 0, promoDiscountCents: 0 };

  it("moves an old booking's commission at 10%", () => {
    expect(splitBookingChange(10_000, { ...booking, hostCommissionCents: 3_000 })).toEqual({ hostShareCents: 9_000, platformShareCents: 1_000 });
  });

  it("moves a booking priced at another rate at that rate, not today's", () => {
    expect(splitBookingChange(10_000, { ...booking, hostCommissionCents: 3_600, commissionRateBps: 1200 })).toEqual({
      hostShareCents: 8_800,
      platformShareCents: 1_200,
    });
    expect(splitBookingChange(-10_000, { ...booking, hostCommissionCents: 3_600, commissionRateBps: 1200 })).toEqual({
      hostShareCents: -8_800,
      platformShareCents: -1_200,
    });
  });
});
