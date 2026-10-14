import { afterEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { guestsSeeSmartPrices, occupancyAround, quoteListingStay, type QuoteListing } from "./stayQuote";
import { stayFinancials } from "./pricingPolicy";
import { hostPayoutCents } from "./hostStats";
import { applyDiscountsToApplicationFee, fyStayFeeCents } from "./pricing";

const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

const listing = (overrides: Partial<QuoteListing> = {}): QuoteListing => ({
  id: "l1",
  city: "Blackpool",
  pricePerNightCents: 10_000,
  weekendPricePerNightCents: null,
  weeklyDiscountPercent: null,
  monthlyDiscountPercent: null,
  lastMinuteDiscountPercent: null,
  lastMinuteWindowDays: null,
  smartPricingEnabled: true,
  smartPricingAutoApply: true,
  smartPricingConsentAt: day("2026-10-01"),
  smartPricingMinPayoutCents: 8_000,
  smartPricingTargetPayoutCents: null,
  smartPricingMinPriceCents: null,
  smartPricingMaxPriceCents: null,
  smartPricingMaxAdjustmentPercent: null,
  ...overrides,
});

const stay = { checkIn: day("2027-03-01"), checkOut: day("2027-03-03"), today: day("2026-10-14") };
const busy = [{ checkIn: day("2027-02-01"), checkOut: day("2027-03-01") }, { checkIn: day("2027-03-03"), checkOut: day("2027-04-01") }];
const db = { localTown: { findFirst: async () => null } } as unknown as PrismaClient;
const ON = { SMART_PRICING_MODE: "on" };

afterEach(() => vi.restoreAllMocks());

describe("quoteListingStay", () => {
  it("is the host's own fixed-10% price unless the mode is on and the host opted in", async () => {
    const off = await quoteListingStay(db, listing(), { ...stay, ranges: busy }, {});
    expect(off).toMatchObject({ commissionRateBps: 1000, smartPricing: null, basePriceSubtotalCents: null });
    expect(off.policy.version).toBe("fixed-10-v1");
    expect(off.pricing.totalPriceCents).toBe(20_000);
    const noConsent = await quoteListingStay(db, listing({ smartPricingConsentAt: null }), { ...stay, ranges: busy }, ON);
    expect(noConsent.smartPricing).toBeNull();
  });

  it("applies the smart price when on, recording the host's own price alongside", async () => {
    const quote = await quoteListingStay(db, listing(), { ...stay, ranges: busy }, ON);
    expect(quote.policy.version).toBe("smart-v1");
    expect(quote.pricing.totalPriceCents).toBe(21_000);
    expect(quote.basePriceSubtotalCents).toBe(20_000);
    expect(quote.smartPricing?.use).toBe("applied");
  });

  it("falls back to the host's own price if smart pricing fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const broken = { localTown: { findFirst: async () => { throw new Error("db down"); } } } as unknown as PrismaClient;
    const quote = await quoteListingStay(broken, listing(), { ...stay, ranges: busy }, ON);
    expect(quote.pricing.totalPriceCents).toBe(20_000);
    expect(quote.smartPricing).toBeNull();
    expect(error).toHaveBeenCalledWith("smart_pricing_failed", expect.objectContaining({ listingId: "l1" }));
  });

  it("only shows guests smart prices for automatic, consented listings with the mode on (rollback = off)", () => {
    expect(guestsSeeSmartPrices(listing(), ON)).toBe(true);
    expect(guestsSeeSmartPrices(listing(), { SMART_PRICING_MODE: "shadow" })).toBe(false);
    expect(guestsSeeSmartPrices(listing(), { SMART_PRICING_MODE: "ON " })).toBe(true);
    expect(guestsSeeSmartPrices(listing(), { SMART_PRICING_MODE: "yes" })).toBe(false);
    expect(guestsSeeSmartPrices(listing({ smartPricingAutoApply: false }), ON)).toBe(false);
  });
});

describe("occupancyAround", () => {
  it("counts booked nights two weeks either side, not the stay itself", () => {
    expect(occupancyAround(stay, busy)).toEqual({ bookedNights: 28, windowNights: 28 });
    expect(occupancyAround(stay, [])).toEqual({ bookedNights: 0, windowNights: 28 });
    expect(occupancyAround(stay, [{ checkIn: day("2027-03-03"), checkOut: day("2027-03-06") }])).toEqual({ bookedNights: 3, windowNights: 28 });
  });
});

describe("the quote's split is exactly what checkout charges", () => {
  it.each([
    [21_000, 2_100, 0],
    [21_000, 2_100, 1_500],
    [33_000, 3_960, 3_960],
    [999, 100, 0],
  ])("accommodation %i, fee %i, FYStay-funded discount %i", (accommodation, fee, discount) => {
    const booking = { totalPriceCents: accommodation - discount, serviceFeeCents: 0, taxCents: 0, hostCommissionCents: fee, creditAppliedCents: discount, promoDiscountCents: 0 };
    const money = stayFinancials({ accommodationCents: accommodation, platformFeeCents: fee, platformFundedDiscountCents: discount });
    // /api/checkout: application_fee_amount, and the host's transfer.
    expect(money.applicationFeeCents).toBe(applyDiscountsToApplicationFee(fyStayFeeCents(booking), discount));
    expect(money.hostPayoutCents).toBe(hostPayoutCents(booking));
    expect(money.guestTotalCents).toBe(booking.totalPriceCents);
    expect(money.applicationFeeCents + money.hostPayoutCents).toBe(money.guestTotalCents);
  });
});
