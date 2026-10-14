import { describe, expect, it } from "vitest";
import {
  bookingCommissionRateBps,
  effectiveRateBps,
  estimatedProcessingFeeCents,
  formatRate,
  LEGACY_FIXED_10,
  platformFeeCents,
  policyForVersion,
  SMART_PRICING_V1,
  stayFinancials,
} from "./pricingPolicy";
import { splitBookingChange } from "./pricing";

describe("platformFeeCents", () => {
  it("is exactly the old 10% under the legacy policy, rounding to the nearest penny", () => {
    for (const cents of [0, 1, 4, 5, 15, 9_999, 12_345, 1_000_000]) {
      expect(platformFeeCents(LEGACY_FIXED_10, { accommodationCents: cents })).toBe(Math.round(cents * 0.1));
    }
  });

  it("shares only a rise above the host's own price, within the policy's bounds", () => {
    const policy = { ...SMART_PRICING_V1, upliftShareBps: 5000, maxRateBps: 1200 };
    // 10% of £330 = £33, + 50% of the £30 rise = £15 -> £48, capped at 12% = £39.60.
    expect(platformFeeCents(policy, { accommodationCents: 33_000, baseAccommodationCents: 30_000 })).toBe(3_960);
    // A price cut is never shared: the fee is just the base rate.
    expect(platformFeeCents(policy, { accommodationCents: 27_000, baseAccommodationCents: 30_000 })).toBe(2_700);
  });

  it("is never more than the stay itself or below zero", () => {
    expect(platformFeeCents({ ...LEGACY_FIXED_10, baseRateBps: 20_000, maxRateBps: 20_000 }, { accommodationCents: 100 })).toBe(100);
    expect(platformFeeCents(LEGACY_FIXED_10, { accommodationCents: -500 })).toBe(0);
  });
});

describe("policy versions", () => {
  it("treats bookings with no version as the fixed 10%, and keeps every version's figures", () => {
    expect(policyForVersion(null)).toBe(LEGACY_FIXED_10);
    expect(policyForVersion("unknown")).toBe(LEGACY_FIXED_10);
    expect(policyForVersion("smart-v1")).toBe(SMART_PRICING_V1);
    expect(SMART_PRICING_V1.upliftShareBps).toBe(0); // until a schedule is approved
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
