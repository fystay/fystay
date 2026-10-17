import { describe, expect, it } from "vitest";
import {
  assessDemand,
  decideSmartPrice,
  rulesBaselineStrategy,
  highestReachableMinimumPayout,
  minimumPayoutError,
  smartPricingSettingsError,
  type ConversionModel,
  type DemandInputs,
  type SmartPricingSettings,
  type StayInput,
} from "./dynamicPricing";
import { LEGACY_FIXED_10 } from "./pricingPolicy";
import { computeBookingPricing, splitBookingChange } from "./pricing";
import type { MarketDemand } from "./marketDemand";

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

/** A town with enough FYStay data for medium confidence, booking at its usual pace. */
const market = (overrides: Partial<MarketDemand> = {}): MarketDemand => ({
  town: "Blackpool",
  activeListings: 10,
  bookingsLast180Days: 30,
  historyDays: 200,
  forwardShare: 0.4,
  paceShare: 0.4,
  seasonalIndex: null,
  seasonSampleBookings: 0,
  ...overrides,
});
const BUSY = market({ forwardShare: 0.7 }); // 1.75x the usual pace
const QUIET = market({ forwardShare: 0.1 }); // 0.25x

const demand = (overrides: Partial<DemandInputs> = {}): DemandInputs => ({
  today: TODAY,
  checkIn: day("2026-10-20"),
  checkOut: day("2026-10-23"),
  market: market(),
  localEvents: null,
  ...overrides,
});

describe("decideSmartPrice", () => {
  it("keeps the host's own price with usual demand, at the base commission", () => {
    const decision = decideSmartPrice({ stay: stay(), settings: settings(), demand: demand() });
    expect(decision.outcome).toBe("unchanged");
    expect(decision.pricing.totalPriceCents).toBe(30_000);
    expect(decision.pricing.hostCommissionCents).toBe(3_000);
    expect(decision.commission.rateBps).toBe(1000);
  });

  it("raises the price one step when the town books faster than usual, and the commission responds too", () => {
    const decision = decideSmartPrice({ stay: stay(), settings: settings(), demand: demand({ market: BUSY }) });
    expect(decision.outcome).toBe("adjusted");
    expect(decision.adjustmentPercent).toBe(5);
    expect(decision.pricing.nightlyPriceCents).toBe(10_500);
    // 10.5% (demand) of £315 = £33.08, + 10% of the £15 rise.
    expect(decision.pricing.hostCommissionCents).toBe(3_308 + 150);
    expect(decision.commission.components.map((c) => c.name)).toEqual(["base", "demand", "uplift_share"]);
    expect(decision.explanation).toMatch(/Raised 5%.*booking faster than usual/);
  });

  it("doesn't treat full calendars as demand when there's no usual pace to compare with, or too little data", () => {
    const noBaseline = decideSmartPrice({ stay: stay(), settings: settings(), demand: demand({ market: market({ forwardShare: 1, paceShare: 0 }) }) });
    expect(noBaseline.adjustmentPercent).toBe(0);
    expect(noBaseline.assessment.demand.confidence).toBe("low");
    const sparse = decideSmartPrice({ stay: stay(), settings: settings(), demand: demand({ market: market({ activeListings: 3, forwardShare: 1 }) }) });
    expect(sparse.adjustmentPercent).toBe(0);
    expect(sparse.assessment.demand).toMatchObject({ confidence: "none", detail: expect.stringMatching(/too little FYStay data.*baseline used/) });
    const fewBookings = decideSmartPrice({ stay: stay(), settings: settings(), demand: demand({ market: market({ bookingsLast180Days: 9, forwardShare: 1 }) }) });
    expect(fewBookings.adjustmentPercent).toBe(0);
    const noTown = decideSmartPrice({ stay: stay(), settings: settings(), demand: demand({ market: null }) });
    expect(noTown.adjustmentPercent).toBe(0);
    expect(noTown.pricing.hostCommissionCents).toBe(3_000);
  });

  it("lowers it only close to check-in when the town is quiet, and never below the host's minimum payout", () => {
    expect(decideSmartPrice({ stay: stay(), settings: settings(), demand: demand({ market: QUIET }) }).adjustmentPercent).toBe(-5);
    // A month out a slow town means nothing yet.
    const farOut = decideSmartPrice({ stay: stay(), settings: settings(), demand: demand({ market: QUIET, checkIn: day("2026-11-14"), checkOut: day("2026-11-17") }) });
    expect(farOut.adjustmentPercent).toBe(0);
    // £90 a night minimum: a 5% cut pays £85.97 a night, so the host's own price (£90.50 a night at 9.5%) is kept.
    const floor = decideSmartPrice({ stay: stay(), settings: settings({ minHostPayoutPerNightCents: 9_000 }), demand: demand({ market: QUIET }) });
    expect(floor.adjustmentPercent).toBe(0);
    expect(floor.candidates.find((c) => c.adjustmentPercent === -5)?.meetsMinPayout).toBe(false);
  });

  it("returns a constrained result at the host's own price when no price pays the minimum, with FYStay's fee cut to its floor", () => {
    const decision = decideSmartPrice({ stay: stay(), settings: settings({ minHostPayoutPerNightCents: 20_000 }), demand: demand() });
    expect(decision.outcome).toBe("constrained");
    expect(decision.pricing.totalPriceCents).toBe(30_000);
    expect(decision.pricing.hostCommissionCents).toBe(2_400); // 8%, the policy's minimum
    expect(decision.constraints.find((c) => c.name === "min_host_payout")?.ok).toBe(false);
    expect(decision.explanation).toMatch(/can.t be met for this stay.*Your own price was charged/);
  });

  it("never prices so the host gets less than their minimum when one is achievable", () => {
    for (const min of [8_000, 8_500, 9_000, 9_200]) {
      for (const m of [BUSY, QUIET, market()]) {
        const decision = decideSmartPrice({ stay: stay(), settings: settings({ minHostPayoutPerNightCents: min }), demand: demand({ market: m }) });
        expect(decision.pricing.totalPriceCents - decision.pricing.hostCommissionCents).toBeGreaterThanOrEqual(min * 3);
      }
    }
  });

  it("never leaves the host's price bounds or adjustment cap", () => {
    const high = demand({ market: BUSY, localEvents: { count: 2, lastFetchedAt: TODAY } });
    expect(decideSmartPrice({ stay: stay(), settings: settings(), demand: high }).adjustmentPercent).toBe(10);
    const capped = decideSmartPrice({ stay: stay(), settings: settings({ maxAdjustmentPercent: 5 }), demand: high });
    expect(capped.adjustmentPercent).toBe(5);
    const bounded = decideSmartPrice({ stay: stay(), settings: settings({ maxGuestPricePerNightCents: 10_200 }), demand: high });
    expect(bounded.pricing.nightlyPriceCents).toBe(10_200);
    expect(bounded.candidates.every((c) => c.pricePerNightCents <= 10_200)).toBe(true);
    const floored = decideSmartPrice({ stay: stay(), settings: settings({ minGuestPricePerNightCents: 9_800, minHostPayoutPerNightCents: 1 }), demand: demand({ market: QUIET }) });
    expect(floored.candidates.every((c) => c.pricePerNightCents >= 9_800)).toBe(true);
  });

  it("reports when the target payout can't be reached within the host's limits", () => {
    const decision = decideSmartPrice({ stay: stay(), settings: settings({ targetHostPayoutPerNightCents: 50_000 }), demand: demand() });
    const target = decision.constraints.find((c) => c.name === "target_host_payout")!;
    expect(target.ok).toBe(false);
    expect(target.detail).toMatch(/can't be reached within your price limits/);
  });

  it("ignores stale event data and records why", () => {
    const decision = decideSmartPrice({ stay: stay(), settings: settings(), demand: demand({ localEvents: { count: 3, lastFetchedAt: day("2026-09-01") } }) });
    expect(decision.adjustmentPercent).toBe(0);
    expect(decision.signals.find((s) => s.name === "local_events")).toMatchObject({ effectPercent: 0, confidence: "none" });
  });

  it("prices weekend nights and stay discounts consistently, with no rounding drift", () => {
    const decision = decideSmartPrice({
      stay: stay({ nights: 7, weekendPricePerNightCents: 12_345, weekendNights: 2, weeklyDiscountPercent: 10 }),
      settings: settings({ minHostPayoutPerNightCents: 1 }),
      demand: demand({ market: BUSY, checkOut: day("2026-10-27") }),
    });
    const p = decision.pricing;
    expect(p.nightlyPriceCents).toBe(10_500);
    expect(p.weekendNightlyPriceCents).toBe(13_000); // £123.45 + 5%, to whole pounds
    expect(p.nightlySubtotalCents).toBe(5 * 10_500 + 2 * 13_000);
    expect(p.totalPriceCents).toBe(p.nightlySubtotalCents - p.lengthOfStayDiscountCents);
    expect(Number.isInteger(p.hostCommissionCents)).toBe(true);
    expect(p.hostCommissionCents).toBe(decision.commission.feeCents);
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

  it("prices under whichever policy it's given (a policy change is a new version)", () => {
    const decision = decideSmartPrice({ stay: stay(), settings: settings({ minHostPayoutPerNightCents: 1 }), demand: demand({ market: BUSY }), policy: LEGACY_FIXED_10 });
    expect(decision.policyVersion).toBe("fixed-10-v1");
    expect(decision.pricing.hostCommissionCents).toBe(3_150);
  });

  it("is deterministic", () => {
    const args = { stay: stay(), settings: settings(), demand: demand({ market: BUSY }) };
    expect(decideSmartPrice(args)).toEqual(decideSmartPrice(args));
  });
});

describe("host protection and no arbitrary moves (regressions)", () => {
  it("never raises the price just because the host's minimum is high", () => {
    // £91 a night is allowed (at most £92 at FYStay's lowest 8%) but more than 10% leaves.
    const decision = decideSmartPrice({ stay: stay(), settings: settings({ minHostPayoutPerNightCents: 9_100 }), demand: demand({ market: null }) });
    expect(decision).toMatchObject({ outcome: "unchanged", adjustmentPercent: 0 });
    expect(decision.pricing).toMatchObject({ totalPriceCents: 30_000, hostCommissionCents: 2_700 }); // fee cut so the host gets £91 x 3
  });

  it("limits the host's own stay discount, to a whole percent, rather than pay them less than their minimum", () => {
    // 7 nights at £100 with a 20% weekly discount: £560, which pays £73.60 a night at 8%. A £80 minimum needs 13%.
    const decision = decideSmartPrice({
      stay: stay({ nights: 7, weeklyDiscountPercent: 20 }),
      settings: settings({ minHostPayoutPerNightCents: 8_000 }),
      demand: demand({ market: null, checkOut: day("2026-10-27") }),
    });
    expect(decision.outcome).toBe("unchanged");
    expect(decision.discountLimited).toEqual({ fromPercent: 20, toPercent: 13 });
    expect(decision.pricing).toMatchObject({ lengthOfStayDiscountPercent: 13, lengthOfStayDiscountCents: 9_100, totalPriceCents: 60_900 });
    expect(decision.pricing.totalPriceCents - decision.pricing.hostCommissionCents).toBeGreaterThanOrEqual(8_000 * 7);
    // 14% would pay £60,200 - 8% = £553.84, under £560.
    expect(decision.explanation).toMatch(/20% stay discount was limited to 13%/);
  });

  it.each([
    // [minimum per night, expected discount]: neighbouring boundaries around the 13% step.
    [7_999, 13],
    [8_000, 13],
    [8_004, 13],
    [8_005, 12],
    [7_360, 20], // exactly what the full 20% pays at 8%: no limit
    [7_361, 19],
  ])("minimum £%i/100 a night over 7 nights keeps a %i%% discount", (minimum, percent) => {
    const decision = decideSmartPrice({
      stay: stay({ nights: 7, weeklyDiscountPercent: 20 }),
      settings: settings({ minHostPayoutPerNightCents: minimum }),
      demand: demand({ market: null, checkOut: day("2026-10-27") }),
    });
    expect(decision.pricing.lengthOfStayDiscountPercent).toBe(percent);
    expect(decision.pricing.totalPriceCents - decision.pricing.hostCommissionCents).toBeGreaterThanOrEqual(minimum * 7);
  });

  it("says plainly when even the undiscounted price can't pay the minimum (price lowered after it was set)", () => {
    const decision = decideSmartPrice({
      stay: stay({ pricePerNightCents: 8_000 }),
      settings: settings({ minHostPayoutPerNightCents: 8_000 }),
      demand: demand({ market: null }),
    });
    expect(decision.outcome).toBe("constrained");
    expect(decision.pricing).toMatchObject({ totalPriceCents: 24_000, hostCommissionCents: 1_920 });
    expect(decision.explanation).toMatch(/can't be met for this stay.*Raise your nightly price or lower your minimum/);
  });
});

describe("properties over random stays", () => {
  // Seeded, so a failure is reproducible.
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
  const pick = <T,>(values: T[]) => values[Math.floor(rnd() * values.length)];

  it("holds the host minimum, the 8-15% bounds, the price limits and the demand direction", () => {
    let checked = 0;
    for (let i = 0; i < 5_000; i++) {
      const price = 2_000 + Math.floor(rnd() * 60_000);
      const weekend = rnd() < 0.3 ? price + Math.floor(rnd() * 10_000) : null;
      const nights = 1 + Math.floor(rnd() * 30);
      const discounted = rnd() < 0.3;
      const weekly = discounted ? pick([5, 10, 20]) : null;
      const monthly = discounted ? pick([15, 30]) : null;
      const listing = { pricePerNightCents: price, weekendPricePerNightCents: weekend, weeklyDiscountPercent: weekly, monthlyDiscountPercent: monthly, lastMinuteDiscountPercent: null };
      // Mostly minimums the settings check accepts; some it would refuse (as if saved before a later discount or price change).
      const minPay = 1 + Math.floor(rnd() * (rnd() < 0.8 ? highestReachableMinimumPayout(listing).cents : price));
      const valid = minimumPayoutError(minPay, listing) === null;
      const limits = settings({
        minHostPayoutPerNightCents: minPay,
        minGuestPricePerNightCents: rnd() < 0.3 ? Math.max(1, price - Math.floor(rnd() * price * 0.3)) : null,
        maxGuestPricePerNightCents: rnd() < 0.3 ? (weekend ?? price) + Math.floor(rnd() * 5_000) : null,
        maxAdjustmentPercent: pick([null, 0, 5, 10, 15]),
      });
      if (smartPricingSettingsError({ ...limits, enabled: false, minHostPayoutPerNightCents: null }, listing)) continue;
      const checkIn = new Date(TODAY.getTime() + Math.floor(rnd() * 200) * 86_400_000);
      const decision = decideSmartPrice({
        stay: stay({
          nights,
          pricePerNightCents: price,
          weekendPricePerNightCents: weekend,
          weekendNights: weekend === null ? 0 : Math.min(nights, Math.floor(rnd() * 9)),
          weeklyDiscountPercent: weekly,
          monthlyDiscountPercent: monthly,
        }),
        settings: limits,
        demand: demand({
          checkIn,
          checkOut: new Date(checkIn.getTime() + nights * 86_400_000),
          market: rnd() < 0.2 ? null : market({ activeListings: pick([2, 5, 25]), bookingsLast180Days: pick([5, 20, 60]), forwardShare: rnd(), paceShare: pick([0, 0.2, 0.5]) }),
          localEvents: rnd() < 0.2 ? { count: 1, lastFetchedAt: TODAY } : null,
        }),
      });
      checked++;
      const { totalPriceCents: total, hostCommissionCents: fee, nightlyPriceCents } = decision.pricing;
      if (valid) expect([decision.outcome, decision.discountLimited]).not.toContain("constrained");
      if (valid) expect(decision.discountLimited).toBeNull();
      if (decision.outcome !== "constrained") {
        expect(total - fee).toBeGreaterThanOrEqual(minPay * nights);
      } else {
        // Only when even the undiscounted stay can't pay it at 8% - and then it says so.
        expect([decision.adjustmentPercent, fee]).toEqual([0, Math.round(total * 0.08)]);
        const undiscounted = decision.pricing.nightlySubtotalCents;
        expect(undiscounted - Math.round(undiscounted * 0.08)).toBeLessThan(minPay * nights);
        expect(decision.explanation).toMatch(/can't be met for this stay/);
      }
      expect(fee).toBeGreaterThanOrEqual(Math.round(total * 0.08));
      expect(fee).toBeLessThanOrEqual(Math.round(total * 0.15));
      expect(fee).toBe(decision.commission.feeCents);
      if (limits.maxGuestPricePerNightCents !== null) expect(nightlyPriceCents).toBeLessThanOrEqual(limits.maxGuestPricePerNightCents);
      if (decision.adjustmentPercent !== 0) expect(Math.sign(decision.adjustmentPercent)).toBe(Math.sign(decision.proposedAdjustmentPercent));
      // A date change at the booking's own price and rate keeps the host's minimum per night.
      if (decision.outcome !== "constrained" && weekend === null && !discounted && valid) {
        const newNights = Math.max(1, nights + pick([-3, -1, 1, 4]));
        const newTotal = newNights * nightlyPriceCents;
        const booking = { totalPriceCents: total, cleaningFeeCents: 0, serviceFeeCents: 0, taxCents: 0, creditAppliedCents: 0, promoDiscountCents: 0, hostCommissionCents: fee, commissionRateBps: decision.commission.rateBps };
        const { platformShareCents } = splitBookingChange(newTotal - total, booking);
        expect(newTotal - fee - platformShareCents).toBeGreaterThanOrEqual(minPay * newNights);
      }
    }
    expect(checked).toBeGreaterThan(3_000);
  });
});

describe("assessDemand", () => {
  it("rates confidence by sample size", () => {
    expect(assessDemand(demand({ market: BUSY })).demand.confidence).toBe("medium");
    expect(assessDemand(demand({ market: { ...BUSY, activeListings: 20, bookingsLast180Days: 50 } })).demand.confidence).toBe("high");
  });

  it("reads demand only within 60 days of check-in", () => {
    const far = assessDemand(demand({ market: BUSY, checkIn: day("2027-01-01"), checkOut: day("2027-01-03") }));
    expect(far.demand).toMatchObject({ level: "normal", detail: expect.stringMatching(/too early/) });
  });

  it("uses seasonality only with a year of history and enough bookings in the month", () => {
    const seasonal = market({ historyDays: 400, seasonalIndex: 1.5, seasonSampleBookings: 12 });
    expect(assessDemand(demand({ market: seasonal })).season).toMatchObject({ level: "high", confidence: "medium" });
    expect(assessDemand(demand({ market: { ...seasonal, seasonSampleBookings: 5 } })).season.confidence).toBe("none");
    expect(assessDemand(demand({ market: { ...seasonal, historyDays: 300 } })).season.confidence).toBe("none");
    expect(assessDemand(demand({ market: { ...seasonal, seasonalIndex: 0.6 } })).season.level).toBe("low");
  });
});

describe("rulesBaselineStrategy", () => {
  it("records each input's source and confidence", () => {
    const { signals } = rulesBaselineStrategy.propose(demand({ localEvents: { count: 1, lastFetchedAt: TODAY } }));
    expect(signals.map((s) => [s.name, s.source, s.confidence])).toEqual([
      ["demand", "FYStay bookings in the town", "medium"],
      ["season", "FYStay bookings in the town", "none"],
      ["local_events", "Ticketmaster", "medium"],
      ["comparables", "none", "none"],
    ]);
  });
});

describe("smartPricingSettingsError", () => {
  const listing = { pricePerNightCents: 10_000, weekendPricePerNightCents: 12_000, weeklyDiscountPercent: null, monthlyDiscountPercent: null, lastMinuteDiscountPercent: null };
  const ok = { enabled: true, autoApply: true, minHostPayoutPerNightCents: 8_000, targetHostPayoutPerNightCents: 9_000, minGuestPricePerNightCents: 9_000, maxGuestPricePerNightCents: 13_000, maxAdjustmentPercent: 10 };

  it("accepts sensible settings", () => {
    expect(smartPricingSettingsError(ok, listing)).toBeNull();
  });

  it.each([
    [{ minHostPayoutPerNightCents: -1 }, /whole pence/],
    [{ minHostPayoutPerNightCents: 12.5 }, /whole pence/],
    [{ maxAdjustmentPercent: 40 }, /between 0% and 15%/],
    [{ minGuestPricePerNightCents: 14_000 }, /lowest nightly price can't be above the highest/],
    [{ minGuestPricePerNightCents: 10_500, maxGuestPricePerNightCents: 20_000 }, /above your own nightly price/],
    [{ maxGuestPricePerNightCents: 11_000 }, /below your own prices/],
    [{ minHostPayoutPerNightCents: 9_500, targetHostPayoutPerNightCents: 9_000 }, /minimum payout can't be above your target/],
    [{ minHostPayoutPerNightCents: 9_200, targetHostPayoutPerNightCents: null }, /what your own price pays you at FYStay's lowest commission, 8% \(£91.99 a night\)/],
    [{ minHostPayoutPerNightCents: null }, /Set the minimum/],
  ])("refuses %o", (change, message) => {
    expect(smartPricingSettingsError({ ...ok, ...change }, listing)).toMatch(message);
  });
});

describe("minimumPayoutError", () => {
  const own = { pricePerNightCents: 10_000, weeklyDiscountPercent: null, monthlyDiscountPercent: null, lastMinuteDiscountPercent: null };

  it("allows the most every stay can pay at 8%, less 1p for rounding, and nothing above", () => {
    expect(highestReachableMinimumPayout(own).cents).toBe(9_199);
    expect(minimumPayoutError(9_199, own)).toBeNull();
    expect(minimumPayoutError(9_200, own)).toMatch(/£91.99 a night/);
    expect(minimumPayoutError(null, own)).toBeNull();
  });

  it("names the largest of the host's own discounts", () => {
    const discounted = { ...own, weeklyDiscountPercent: 10, monthlyDiscountPercent: 25, lastMinuteDiscountPercent: 15 };
    expect(highestReachableMinimumPayout(discounted)).toEqual({ cents: 6_899, discount: { percent: 25, name: "monthly discount" } });
    expect(minimumPayoutError(6_900, discounted)).toMatch(/With your 25% monthly discount, a night can pay you at most £68.99/);
  });

  it("is never more than every multi-night stay actually pays, at any length", () => {
    for (const price of [999, 10_006, 12_345, 54_321]) {
      for (const percent of [0, 7, 20, 33]) {
        const listing = { ...own, pricePerNightCents: price, weeklyDiscountPercent: percent };
        const minimum = highestReachableMinimumPayout(listing).cents;
        for (let nights = 1; nights <= 60; nights++) {
          const p = computeBookingPricing({ nights, pricePerNightCents: price, weeklyDiscountPercent: percent });
          // Whether or not the discount applies at this length, the stay pays the minimum at 8%.
          expect(p.totalPriceCents - Math.round(p.totalPriceCents * 0.08)).toBeGreaterThanOrEqual(minimum * nights);
        }
      }
    }
  });
});

describe("legacy policy stays the default", () => {
  it("computeBookingPricing without a policy is the fixed 10%", () => {
    const p = computeBookingPricing({ nights: 2, pricePerNightCents: 12_345 });
    expect(p.hostCommissionCents).toBe(Math.round(24_690 * 0.1));
    expect(LEGACY_FIXED_10.baseRateBps).toBe(1000);
  });
});
