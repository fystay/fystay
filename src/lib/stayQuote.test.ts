import { afterEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { bookingPricingSnapshot, guestsSeeSmartPrices, quoteListingStay, recordPriceDecision, type QuoteListing } from "./stayQuote";
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
  smartPricingConsentPolicyVersion: "dynamic-v1",
  smartPricingMinPayoutCents: 8_000,
  smartPricingTargetPayoutCents: null,
  smartPricingMinPriceCents: null,
  smartPricingMaxPriceCents: null,
  smartPricingMaxAdjustmentPercent: null,
  ...overrides,
});

// 138 days ahead; a Monday and Tuesday night.
const stay = { checkIn: day("2027-03-01"), checkOut: day("2027-03-03"), today: day("2026-10-14") };
const TODAY = stay.today;
/** Two live listings in the town, no bookings yet; one fresh local event during the stay. */
const db = {
  listing: { count: async () => 2 },
  booking: { findMany: async () => [] },
  localTown: { findFirst: async () => ({ slug: "blackpool" }) },
  localEvent: { count: async () => 1, aggregate: async () => ({ _max: { lastFetchedAt: TODAY } }) },
} as unknown as PrismaClient;
const ON = { SMART_PRICING_MODE: "on" };
const SHADOW = { SMART_PRICING_MODE: "shadow" };

afterEach(() => vi.restoreAllMocks());

describe("quoteListingStay", () => {
  it("is the host's own price at the fixed 10% when the mode is off - whatever the host chose", async () => {
    for (const options of [{}, { shadow: true }]) {
      const off = await quoteListingStay(db, listing(), stay, {}, options);
      expect(off).toMatchObject({ commissionRateBps: 1000, smartPricing: null, basePriceSubtotalCents: null });
      expect(off.policy.version).toBe("fixed-10-v1");
      expect(off.pricing).toMatchObject({ totalPriceCents: 20_000, hostCommissionCents: 2_000 });
    }
  });

  it("charges the dynamic commission at the smart price for a host who agreed to the current policy", async () => {
    const quote = await quoteListingStay(db, listing(), stay, ON);
    expect(quote.policy.version).toBe("dynamic-v1");
    expect(quote.smartPricing?.use).toBe("applied");
    // +5% for the event: £105 x 2. Rate 10% - 1 (2 listings in town) + 0.5 (138 days ahead) = 9.5%,
    // plus 10% of the £10 rise.
    expect(quote.pricing.totalPriceCents).toBe(21_000);
    expect(quote.pricing.hostCommissionCents).toBe(1_995 + 100);
    expect(quote.commissionRateBps).toBe(998);
    expect(quote.basePriceSubtotalCents).toBe(20_000);
    expect(quote.commission.components.map((c) => c.name)).toEqual(["base", "lead_time", "market", "uplift_share"]);
  });

  it("charges the dynamic commission at the host's own price when they only want suggestions", async () => {
    const quote = await quoteListingStay(db, listing({ smartPricingAutoApply: false }), stay, ON);
    expect(quote.smartPricing?.use).toBe("suggested");
    expect(quote.pricing).toMatchObject({ totalPriceCents: 20_000, hostCommissionCents: 1_900 });
    expect(quote.basePriceSubtotalCents).toBeNull();
  });

  it("keeps the fixed 10% until the host agrees again to a newer policy version, or if they never agreed", async () => {
    for (const host of [listing({ smartPricingConsentPolicyVersion: "dynamic-v0" }), listing({ smartPricingConsentAt: null }), listing({ smartPricingEnabled: false })]) {
      const quote = await quoteListingStay(db, host, stay, ON);
      expect(quote.policy.version).toBe("fixed-10-v1");
      expect(quote.pricing.totalPriceCents).toBe(20_000);
      expect(quote.smartPricing).toBeNull();
    }
  });

  it("in shadow mode charges the fixed 10% and, at booking, works out the dynamic figures for any listing", async () => {
    const notOptedIn = listing({ smartPricingEnabled: false, smartPricingConsentAt: null, smartPricingMinPayoutCents: null });
    const preview = await quoteListingStay(db, notOptedIn, stay, SHADOW);
    expect(preview.smartPricing).toBeNull();
    for (const host of [notOptedIn, listing()]) {
      const quote = await quoteListingStay(db, host, stay, SHADOW, { shadow: true });
      expect(quote.policy.version).toBe("fixed-10-v1");
      expect(quote.pricing).toMatchObject({ totalPriceCents: 20_000, hostCommissionCents: 2_000 });
      expect(quote.smartPricing?.use).toBe("shadow");
      expect(quote.smartPricing?.decision.pricing.totalPriceCents).toBe(21_000);
    }
  });

  it("falls back to the fixed 10% at the host's own price if anything in the dynamic path fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const broken = { ...db, booking: { findMany: async () => { throw new Error("db down"); } } } as unknown as PrismaClient;
    const quote = await quoteListingStay(broken, listing(), stay, ON);
    expect(quote.pricing.totalPriceCents).toBe(20_000);
    expect(quote.policy.version).toBe("fixed-10-v1");
    expect(quote.smartPricing).toBeNull();
    expect(error).toHaveBeenCalledWith("smart_pricing_failed", expect.objectContaining({ listingId: "l1" }));
  });

  it("only shows guests smart prices for automatic listings agreed to the current policy, with the mode on (rollback = off)", () => {
    expect(guestsSeeSmartPrices(listing(), ON)).toBe(true);
    expect(guestsSeeSmartPrices(listing(), SHADOW)).toBe(false);
    expect(guestsSeeSmartPrices(listing(), { SMART_PRICING_MODE: "ON " })).toBe(true);
    expect(guestsSeeSmartPrices(listing(), { SMART_PRICING_MODE: "yes" })).toBe(false);
    expect(guestsSeeSmartPrices(listing({ smartPricingAutoApply: false }), ON)).toBe(false);
    expect(guestsSeeSmartPrices(listing({ smartPricingConsentPolicyVersion: "dynamic-v0" }), ON)).toBe(false);
  });
});

describe("recordPriceDecision", () => {
  it("records what was charged beside what the dynamic policy proposed, and logs the comparison", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const create = vi.fn(async () => ({ id: "pd_1" }));
    const writer = { ...db, priceDecision: { create } } as unknown as PrismaClient;
    const quote = await quoteListingStay(db, listing(), stay, SHADOW, { shadow: true });
    expect(await recordPriceDecision(writer, "l1", stay, quote)).toBe("pd_1");
    const data = (create.mock.calls[0] as unknown as [{ data: Record<string, unknown> }])[0].data;
    expect(data).toMatchObject({
      mode: "shadow",
      policyVersion: "dynamic-v1",
      chosenAccommodationCents: 21_000,
      platformFeeCents: 2_095,
      hostPayoutCents: 18_905,
      chargedPolicyVersion: "fixed-10-v1",
      chargedAccommodationCents: 20_000,
      chargedPlatformFeeCents: 2_000,
      chargedHostPayoutCents: 18_000,
      dataConfidence: "none",
    });
    expect(data.inputs).toMatchObject({ commission: { proposed: { policyVersion: "dynamic-v1" }, charged: { policyVersion: "fixed-10-v1" } } });
    expect(info).toHaveBeenCalledWith("pricing_shadow_comparison", expect.objectContaining({ listingId: "l1", use: "shadow" }));
    // The booking links the decision whichever way it was used.
    expect(bookingPricingSnapshot(quote, "pd_1")).toEqual({ pricingPolicyVersion: "fixed-10-v1", commissionRateBps: 1000, basePriceSubtotalCents: null, priceDecisionId: "pd_1" });
  });

  it("records nothing when no dynamic figures were worked out", async () => {
    const create = vi.fn();
    const quote = await quoteListingStay(db, listing(), stay, {});
    expect(await recordPriceDecision({ priceDecision: { create } } as unknown as PrismaClient, "l1", stay, quote)).toBeNull();
    expect(create).not.toHaveBeenCalled();
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
