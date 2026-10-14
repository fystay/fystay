import { describe, expect, it } from "vitest";
import { decideSmartPrice, rulesBaselineStrategy, smartPricingSettingsError, type ConversionModel, type DemandInputs, type SmartPricingSettings, type StayInput } from "./dynamicPricing";
import { LEGACY_FIXED_10, SMART_PRICING_V1, type CommissionPolicy } from "./pricingPolicy";
import { computeBookingPricing } from "./pricing";

const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
const TODAY = day("2026-10-14");

const stay = (overrides: Partial<StayInput> = {}): StayInput => ({
  nights: 3,
  pricePerNightCents: 10_000,
  weekendPricePerNightCents: null,
  weekendNights: 0,
  weeklyDiscountPercent: null,
  monthlyDiscountPercent: null,
  lastMinuteDiscountPercent: null,
  ...overrides,
});

const settings = (overrides: Partial<SmartPricingSettings> = {}): SmartPricingSettings => ({
  enabled: true,
  autoApply: true,
  consentAt: TODAY,
  minHostPayoutPerNightCents: 8_000,
  targetHostPayoutPerNightCents: null,
  minGuestPricePerNightCents: null,
  maxGuestPricePerNightCents: null,
  maxAdjustmentPercent: null,
  ...overrides,
});

const demand = (overrides: Partial<DemandInputs> = {}): DemandInputs => ({
  today: TODAY,
  checkIn: day("2026-10-20"),
  checkOut: day("2026-10-23"),
  occupancy: { bookedNights: 10, windowNights: 31 },
  localEvents: null,
  ...overrides,
});

describe("decideSmartPrice", () => {
  it("keeps the host's own price with normal demand, under the 10%-equivalent policy", () => {
    const decision = decideSmartPrice({ stay: stay(), settings: settings(), demand: demand() });
    expect(decision.outcome).toBe("unchanged");
    expect(decision.pricing.totalPriceCents).toBe(30_000);
    // smart-v1 charges exactly what the fixed 10% does until a schedule is approved.
    expect(decision.pricing.hostCommissionCents).toBe(computeBookingPricing({ nights: 3, pricePerNightCents: 10_000 }).hostCommissionCents);
  });

  it("raises the price one step when the calendar around the stay is nearly full", () => {
    const decision = decideSmartPrice({ stay: stay(), settings: settings(), demand: demand({ occupancy: { bookedNights: 25, windowNights: 31 } }) });
    expect(decision.outcome).toBe("adjusted");
    expect(decision.adjustmentPercent).toBe(5);
    expect(decision.pricing.nightlyPriceCents).toBe(10_500);
    expect(decision.explanation).toMatch(/Raised 5%.*high demand/);
  });

  it("lowers it only close to check-in when the calendar is quiet, and never below the host's minimum payout", () => {
    const quiet = { occupancy: { bookedNights: 2, windowNights: 31 } };
    expect(decideSmartPrice({ stay: stay(), settings: settings(), demand: demand(quiet) }).adjustmentPercent).toBe(-5);
    // Far from check-in a quiet calendar means nothing yet.
    const farOut = decideSmartPrice({ stay: stay(), settings: settings(), demand: demand({ ...quiet, checkIn: day("2027-02-01"), checkOut: day("2027-02-04") }) });
    expect(farOut.adjustmentPercent).toBe(0);
    // £90 net a night minimum: a 5% cut (£95 -> £85.50 net) is refused, the host's own price kept.
    const floor = decideSmartPrice({ stay: stay(), settings: settings({ minHostPayoutPerNightCents: 9_000 }), demand: demand(quiet) });
    expect(floor.adjustmentPercent).toBe(0);
    expect(floor.candidates.find((c) => c.adjustmentPercent === -5)?.meetsMinPayout).toBe(false);
  });

  it("returns a constrained result, at the host's own price, when no price pays the minimum", () => {
    const decision = decideSmartPrice({ stay: stay(), settings: settings({ minHostPayoutPerNightCents: 20_000 }), demand: demand() });
    expect(decision.outcome).toBe("constrained");
    expect(decision.pricing.totalPriceCents).toBe(30_000);
    expect(decision.constraints.find((c) => c.name === "min_host_payout")?.ok).toBe(false);
    expect(decision.explanation).toMatch(/Your own price was kept/);
  });

  it("never leaves the host's price bounds or adjustment cap", () => {
    const high = demand({ occupancy: { bookedNights: 31, windowNights: 31 }, localEvents: { count: 2, lastFetchedAt: TODAY } });
    const capped = decideSmartPrice({ stay: stay(), settings: settings({ maxAdjustmentPercent: 5 }), demand: high });
    expect(capped.adjustmentPercent).toBe(5);
    const bounded = decideSmartPrice({ stay: stay(), settings: settings({ maxGuestPricePerNightCents: 10_200 }), demand: high });
    expect(bounded.pricing.nightlyPriceCents).toBe(10_200);
    expect(bounded.candidates.every((c) => c.pricePerNightCents <= 10_200)).toBe(true);
  });

  it("reports when the target payout can't be reached within the host's limits", () => {
    const decision = decideSmartPrice({ stay: stay(), settings: settings({ targetHostPayoutPerNightCents: 50_000 }), demand: demand() });
    const target = decision.constraints.find((c) => c.name === "target_host_payout")!;
    expect(target.ok).toBe(false);
    expect(target.detail).toMatch(/can't be reached within your price limits/);
  });

  it("ignores stale event data and records why", () => {
    const decision = decideSmartPrice({
      stay: stay(),
      settings: settings(),
      demand: demand({ localEvents: { count: 3, lastFetchedAt: day("2026-09-01") } }),
    });
    expect(decision.adjustmentPercent).toBe(0);
    expect(decision.signals.find((s) => s.name === "local_events")).toMatchObject({ effectPercent: 0, confidence: "none" });
  });

  it("prices weekend nights and stay discounts consistently, with no rounding drift", () => {
    const decision = decideSmartPrice({
      stay: stay({ nights: 7, weekendPricePerNightCents: 12_345, weekendNights: 2, weeklyDiscountPercent: 10 }),
      settings: settings({ minHostPayoutPerNightCents: 1 }),
      demand: demand({ occupancy: { bookedNights: 30, windowNights: 31 } }),
    });
    const p = decision.pricing;
    expect(p.nightlyPriceCents).toBe(10_500);
    expect(p.weekendNightlyPriceCents).toBe(13_000); // £123.45 + 5%, to whole pounds
    expect(p.nightlySubtotalCents).toBe(5 * 10_500 + 2 * 13_000);
    expect(p.totalPriceCents).toBe(p.nightlySubtotalCents - p.lengthOfStayDiscountCents);
    expect(Number.isInteger(p.hostCommissionCents)).toBe(true);
  });

  it("maximises expected contribution when a conversion model is supplied", () => {
    // A made-up model in which demand falls steeply with price: the cheapest valid price wins.
    const model: ConversionModel = { id: "test", bookingProbability: ({ adjustmentPercent }) => Math.max(0, 0.5 - adjustmentPercent / 10) };
    const decision = decideSmartPrice({ stay: stay(), settings: settings({ minHostPayoutPerNightCents: 1 }), demand: demand(), conversionModel: model });
    expect(decision.conversionModelId).toBe("test");
    expect(decision.adjustmentPercent).toBe(-15);
  });

  it("falls back to the rules when the model can't estimate every candidate", () => {
    const model: ConversionModel = { id: "partial", bookingProbability: ({ adjustmentPercent }) => (adjustmentPercent === 0 ? 0.3 : null) };
    const decision = decideSmartPrice({ stay: stay(), settings: settings(), demand: demand(), conversionModel: model });
    expect(decision.conversionModelId).toBeNull();
    expect(decision.adjustmentPercent).toBe(0);
  });

  it("shares a price rise only as the policy says", () => {
    const sharing: CommissionPolicy = { ...SMART_PRICING_V1, version: "test-share", upliftShareBps: 5000 };
    const decision = decideSmartPrice({
      stay: stay(),
      settings: settings({ minHostPayoutPerNightCents: 1 }),
      demand: demand({ occupancy: { bookedNights: 31, windowNights: 31 } }),
      policy: sharing,
    });
    // £315 stay, £300 at the host's price: 10% of £315 + 50% of the £15 rise.
    expect(decision.pricing.totalPriceCents).toBe(31_500);
    expect(decision.pricing.hostCommissionCents).toBe(3_150 + 750);
  });

  it("is deterministic", () => {
    const args = { stay: stay(), settings: settings(), demand: demand({ occupancy: { bookedNights: 25, windowNights: 31 } }) };
    expect(decideSmartPrice(args)).toEqual(decideSmartPrice(args));
  });
});

describe("rulesBaselineStrategy", () => {
  it("records each input's source and confidence", () => {
    const { signals } = rulesBaselineStrategy.propose(demand({ localEvents: { count: 1, lastFetchedAt: TODAY } }));
    expect(signals.map((s) => [s.name, s.source, s.confidence])).toEqual([
      ["occupancy", "FYStay calendar", "high"],
      ["local_events", "Ticketmaster", "medium"],
      ["comparables", "none", "none"],
    ]);
  });
});

describe("smartPricingSettingsError", () => {
  const listing = { pricePerNightCents: 10_000, weekendPricePerNightCents: 12_000 };
  const ok = { enabled: true, autoApply: true, minHostPayoutPerNightCents: 8_000, targetHostPayoutPerNightCents: 9_000, minGuestPricePerNightCents: 9_000, maxGuestPricePerNightCents: 13_000, maxAdjustmentPercent: 10 };

  it("accepts sensible settings", () => {
    expect(smartPricingSettingsError(ok, listing, 9_000)).toBeNull();
  });

  it.each([
    [{ minHostPayoutPerNightCents: -1 }, /whole pence/],
    [{ minHostPayoutPerNightCents: 12.5 }, /whole pence/],
    [{ maxAdjustmentPercent: 40 }, /between 0% and 15%/],
    [{ minGuestPricePerNightCents: 14_000 }, /lowest nightly price can't be above the highest/],
    [{ minGuestPricePerNightCents: 10_500, maxGuestPricePerNightCents: 20_000 }, /above your own nightly price/],
    [{ maxGuestPricePerNightCents: 11_000 }, /below your own prices/],
    [{ minHostPayoutPerNightCents: 9_500, targetHostPayoutPerNightCents: 9_000 }, /minimum payout can't be above your target/],
    [{ minHostPayoutPerNightCents: 9_100, targetHostPayoutPerNightCents: null }, /what your own price pays you/],
    [{ minHostPayoutPerNightCents: null }, /Set the minimum/],
  ])("refuses %o", (change, message) => {
    expect(smartPricingSettingsError({ ...ok, ...change }, listing, 9_000)).toMatch(message);
  });
});

describe("legacy policy stays the default", () => {
  it("computeBookingPricing without a policy is the fixed 10%", () => {
    const p = computeBookingPricing({ nights: 2, pricePerNightCents: 12_345 });
    expect(p.hostCommissionCents).toBe(Math.round(24_690 * 0.1));
    expect(LEGACY_FIXED_10.baseRateBps).toBe(1000);
  });
});
