import { describe, expect, it } from "vitest";
import {
  summarizeExtrasRevenue,
  summarizePlatformFinancials,
  type AdminBookingSummary,
  type AdminExtraSummary,
} from "./adminSummary";

// A £200 stay under the commission model: the guest pays £200 and FYStay
// keeps its 10% (£20) out of the host's payout.
function booking(overrides: Partial<AdminBookingSummary> = {}): AdminBookingSummary {
  return {
    paymentStatus: "PAID",
    totalPriceCents: 20000,
    serviceFeeCents: 0,
    hostCommissionCents: 2000,
    taxCents: 0,
    creditAppliedCents: 0,
    promoDiscountCents: 0,
    ...overrides,
  };
}

// An older booking: a £200 stay plus a £20 guest service fee on top, no commission.
function legacyBooking(overrides: Partial<AdminBookingSummary> = {}): AdminBookingSummary {
  return booking({ totalPriceCents: 22000, serviceFeeCents: 2000, hostCommissionCents: 0, ...overrides });
}

describe("summarizePlatformFinancials", () => {
  it("ignores UNPAID bookings entirely", () => {
    const result = summarizePlatformFinancials([booking({ paymentStatus: "UNPAID" })]);
    expect(result).toEqual({
      grossBookingValueCents: 0,
      platformRevenueCents: 0,
      paidBookingsCount: 0,
    });
  });

  it("counts a PAID booking's total and FYStay's commission on it", () => {
    const result = summarizePlatformFinancials([booking()]);
    expect(result.grossBookingValueCents).toBe(20000);
    expect(result.platformRevenueCents).toBe(2000);
    expect(result.paidBookingsCount).toBe(1);
  });

  it("still counts an older booking's guest service fee as platform revenue", () => {
    const result = summarizePlatformFinancials([legacyBooking()]);
    expect(result.grossBookingValueCents).toBe(22000);
    expect(result.platformRevenueCents).toBe(2000);
  });

  it("counts PARTIALLY_REFUNDED and REFUNDED bookings too - money still moved", () => {
    const result = summarizePlatformFinancials([
      booking({ paymentStatus: "PARTIALLY_REFUNDED" }),
      booking({ paymentStatus: "REFUNDED" }),
    ]);
    expect(result.paidBookingsCount).toBe(2);
  });

  it("nets refunds off both figures, returning FYStay's fee in the same share as Stripe", () => {
    const result = summarizePlatformFinancials([
      booking({ paymentStatus: "PARTIALLY_REFUNDED", refundedAmountCents: 5_000 }),
      booking({ paymentStatus: "REFUNDED", refundedAmountCents: 20_000 }),
    ]);
    expect(result.grossBookingValueCents).toBe(15_000);
    expect(result.platformRevenueCents).toBe(1_500);
    expect(result.paidBookingsCount).toBe(2);
  });

  it("subtracts referral credit and promo discount from platform revenue, not gross booking value", () => {
    // £200 stay, £5 credit + £3 promo: the guest paid £192, FYStay nets £20 - £8 = £12.
    const result = summarizePlatformFinancials([
      booking({ totalPriceCents: 19200, creditAppliedCents: 500, promoDiscountCents: 300 }),
    ]);
    expect(result.grossBookingValueCents).toBe(19200);
    expect(result.platformRevenueCents).toBe(1200);
  });

  it("subtracts discounts from an older booking's service fee the same way", () => {
    const result = summarizePlatformFinancials([legacyBooking({ creditAppliedCents: 500, promoDiscountCents: 300 })]);
    expect(result.platformRevenueCents).toBe(1200);
  });

  it("floors platform revenue at 0 when combined discounts exceed the fee", () => {
    const result = summarizePlatformFinancials([
      booking({ hostCommissionCents: 500, creditAppliedCents: 400, promoDiscountCents: 300 }),
    ]);
    expect(result.platformRevenueCents).toBe(0);
    const legacy = summarizePlatformFinancials([
      legacyBooking({ serviceFeeCents: 500, creditAppliedCents: 400, promoDiscountCents: 300 }),
    ]);
    expect(legacy.platformRevenueCents).toBe(0);
  });

  it("sums across multiple bookings, commission and older service-fee ones alike", () => {
    const result = summarizePlatformFinancials([
      booking(),
      booking({ totalPriceCents: 10000, hostCommissionCents: 1000 }),
      legacyBooking(),
    ]);
    expect(result.grossBookingValueCents).toBe(20000 + 10000 + 22000);
    expect(result.platformRevenueCents).toBe(2000 + 1000 + 2000);
    expect(result.paidBookingsCount).toBe(3);
  });

  it("returns all zeros for an empty list", () => {
    expect(summarizePlatformFinancials([])).toEqual({
      grossBookingValueCents: 0,
      platformRevenueCents: 0,
      paidBookingsCount: 0,
    });
  });
});

function extra(overrides: Partial<AdminExtraSummary> = {}): AdminExtraSummary {
  return {
    status: "PAID",
    priceCents: 4500,
    ...overrides,
  };
}

describe("summarizeExtrasRevenue", () => {
  it("counts only PAID extras", () => {
    const result = summarizeExtrasRevenue([
      extra({ status: "PENDING_PAYMENT" }),
      extra({ status: "CANCELLED" }),
      extra({ status: "REFUNDED" }),
      extra({ status: "PAID" }),
    ]);
    expect(result).toEqual({ extrasRevenueCents: 4500, paidExtrasCount: 1 });
  });

  it("sums the full price of every paid extra - no Connect split for these", () => {
    const result = summarizeExtrasRevenue([
      extra({ priceCents: 4500 }),
      extra({ priceCents: 3500 }),
      extra({ priceCents: 9000 }),
    ]);
    expect(result.extrasRevenueCents).toBe(17000);
    expect(result.paidExtrasCount).toBe(3);
  });

  it("returns all zeros for an empty list", () => {
    expect(summarizeExtrasRevenue([])).toEqual({ extrasRevenueCents: 0, paidExtrasCount: 0 });
  });
});
