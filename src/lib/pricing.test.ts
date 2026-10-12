import { describe, expect, it } from "vitest";
import {
  applyDiscountsToApplicationFee,
  discountedAccommodationCents,
  computeBookingPricing,
  stayDiscountName,
  HOST_COMMISSION_RATE,
  hostCommissionFor,
  legacyGuestServiceFeeFor,
  fyStayFeeCents,
  maxFyStayDiscountCents,
  isLegacyServiceFeeBooking,
  resolveLengthOfStayDiscount,
  splitBookingChange,
  isWeekendNight,
  weekendNightsBetween,
  stayRates,
  bookingNightlySubtotalCents,
  nightlyChargeLines,
  weekendRateError,
} from "./pricing";

describe("computeBookingPricing", () => {
  it("charges the guest the host's price and nothing on top - no service fee, no cleaning fee", () => {
    const result = computeBookingPricing({ nights: 3, pricePerNightCents: 10000 });

    expect(result.nightlySubtotalCents).toBe(30000);
    expect(result.cleaningFeeCents).toBe(0);
    expect(result.serviceFeeCents).toBe(0);
    expect(result.taxCents).toBe(0);
    expect(result.totalPriceCents).toBe(30000);
  });

  it("works out FYStay's 10% commission on the stay without adding it to the guest's total", () => {
    const result = computeBookingPricing({ nights: 3, pricePerNightCents: 10000 });
    expect(result.hostCommissionCents).toBe(3000);
    // The host's payout before any discounts FYStay funds.
    expect(result.totalPriceCents - result.hostCommissionCents).toBe(27000);
  });

  it("returns all zeroes for a zero-night stay", () => {
    const result = computeBookingPricing({ nights: 0, pricePerNightCents: 12345 });
    expect(result.totalPriceCents).toBe(0);
    expect(result.hostCommissionCents).toBe(0);
  });

  it("rounds the commission to the nearest whole cent/penny", () => {
    // 10% of £9.99 is 99.9p.
    const result = computeBookingPricing({ nights: 1, pricePerNightCents: 999 });
    expect(result.totalPriceCents).toBe(999);
    expect(result.hostCommissionCents).toBe(100);
  });

  it("applies no discount below the weekly threshold, even if one is set", () => {
    const result = computeBookingPricing({
      nights: 6,
      pricePerNightCents: 10000,
      weeklyDiscountPercent: 10,
    });
    expect(result.lengthOfStayDiscountCents).toBe(0);
    expect(result.lengthOfStayDiscountLabel).toBeNull();
    expect(result.totalPriceCents).toBe(60000);
    expect(result.hostCommissionCents).toBe(6000);
  });

  it("applies the weekly discount to the nightly subtotal at 7+ nights, with the commission on the discounted stay", () => {
    const result = computeBookingPricing({
      nights: 7,
      pricePerNightCents: 10000,
      weeklyDiscountPercent: 10,
    });
    // 70000 gross - 10% = 63000; commission is 10% of what the guest pays.
    expect(result.nightlySubtotalCents).toBe(70000);
    expect(result.lengthOfStayDiscountPercent).toBe(10);
    expect(result.lengthOfStayDiscountCents).toBe(7000);
    expect(result.lengthOfStayDiscountLabel).toBe("weekly");
    expect(result.serviceFeeCents).toBe(0);
    expect(result.totalPriceCents).toBe(63000);
    expect(result.hostCommissionCents).toBe(6300);
  });

  it("rounds both the discount and the commission on an awkward discounted stay", () => {
    const result = computeBookingPricing({
      nights: 7,
      pricePerNightCents: 9999,
      weeklyDiscountPercent: 15,
    });
    // 7 x 9999 = 69993; 15% = 10498.95 -> 10499 off; 59494 to pay; 10% = 5949.4 -> 5949.
    expect(result.nightlySubtotalCents).toBe(69993);
    expect(result.lengthOfStayDiscountCents).toBe(10499);
    expect(result.totalPriceCents).toBe(59494);
    expect(result.hostCommissionCents).toBe(5949);
  });

  it("applies the monthly discount instead of the weekly one at 28+ nights", () => {
    const result = computeBookingPricing({
      nights: 28,
      pricePerNightCents: 10000,
      weeklyDiscountPercent: 10,
      monthlyDiscountPercent: 20,
    });
    expect(result.lengthOfStayDiscountPercent).toBe(20);
    expect(result.lengthOfStayDiscountLabel).toBe("monthly");
    // 280000 less 20% = 224000.
    expect(result.totalPriceCents).toBe(224000);
    expect(result.hostCommissionCents).toBe(22400);
  });

  it("falls back to the weekly discount at 28+ nights if no monthly rate is set", () => {
    const result = computeBookingPricing({
      nights: 30,
      pricePerNightCents: 10000,
      weeklyDiscountPercent: 10,
    });
    expect(result.lengthOfStayDiscountPercent).toBe(10);
    expect(result.lengthOfStayDiscountLabel).toBe("weekly");
  });
});

describe("hostCommissionFor", () => {
  it("is 10% of what the guest pays for the stay", () => {
    expect(HOST_COMMISSION_RATE).toBe(0.1);
    expect(hostCommissionFor(30000)).toBe(3000);
    expect(hostCommissionFor(0)).toBe(0);
  });

  it("rounds to the nearest penny, halves up", () => {
    expect(hostCommissionFor(999)).toBe(100); // 99.9
    expect(hostCommissionFor(4)).toBe(0); // 0.4
    expect(hostCommissionFor(5)).toBe(1); // 0.5
    expect(hostCommissionFor(15)).toBe(2); // 1.5
    expect(hostCommissionFor(12345)).toBe(1235); // 1234.5
    expect(hostCommissionFor(12344)).toBe(1234); // 1234.4
  });

  it("is never negative", () => {
    expect(hostCommissionFor(-500)).toBe(0);
  });

  it("is what computeBookingPricing reports for the same stay", () => {
    for (const price of [1, 999, 4999, 12345, 25500]) {
      const pricing = computeBookingPricing({ nights: 3, pricePerNightCents: price });
      expect(pricing.hostCommissionCents).toBe(hostCommissionFor(pricing.totalPriceCents));
    }
  });
});

describe("legacyGuestServiceFeeFor", () => {
  it("is the 10% guest service fee older bookings carried on top of the stay", () => {
    expect(legacyGuestServiceFeeFor(30000)).toBe(3000);
    expect(legacyGuestServiceFeeFor(999)).toBe(100);
  });
});

describe("isLegacyServiceFeeBooking", () => {
  it("is true only for a booking with a service fee and no commission", () => {
    expect(isLegacyServiceFeeBooking({ serviceFeeCents: 3000, hostCommissionCents: 0 })).toBe(true);
    expect(isLegacyServiceFeeBooking({ serviceFeeCents: 0, hostCommissionCents: 3000 })).toBe(false);
    // A free (or fully fee-less) booking is priced the new way.
    expect(isLegacyServiceFeeBooking({ serviceFeeCents: 0, hostCommissionCents: 0 })).toBe(false);
  });
});

describe("fyStayFeeCents and maxFyStayDiscountCents", () => {
  it("is FYStay's commission on a commission booking", () => {
    const pricing = computeBookingPricing({ nights: 3, pricePerNightCents: 10000 });
    expect(fyStayFeeCents(pricing)).toBe(3000);
    expect(maxFyStayDiscountCents(pricing)).toBe(3000);
  });

  it("is the guest service fee on an older booking", () => {
    const legacy = { serviceFeeCents: 3000, taxCents: 0, hostCommissionCents: 0 };
    expect(fyStayFeeCents(legacy)).toBe(3000);
    expect(maxFyStayDiscountCents(legacy)).toBe(3000);
  });

  it("adds tax to FYStay's fee", () => {
    const withTax = { serviceFeeCents: 0, taxCents: 250, hostCommissionCents: 3000 };
    expect(fyStayFeeCents(withTax)).toBe(3250);
    expect(maxFyStayDiscountCents(withTax)).toBe(3250);
  });

  it("caps the discounts on a discounted stay at the commission on the discounted price", () => {
    const pricing = computeBookingPricing({ nights: 7, pricePerNightCents: 10000, weeklyDiscountPercent: 10 });
    expect(maxFyStayDiscountCents(pricing)).toBe(6300);
  });

  it("is 0 for a zero-night stay", () => {
    expect(maxFyStayDiscountCents(computeBookingPricing({ nights: 0, pricePerNightCents: 10000 }))).toBe(0);
  });
});

describe("resolveLengthOfStayDiscount", () => {
  it("applies neither discount when nothing is configured", () => {
    expect(resolveLengthOfStayDiscount({ nights: 30 })).toEqual({ percent: 0, label: null });
  });

  it("treats a 0% discount as unset (no discount applied)", () => {
    const result = resolveLengthOfStayDiscount({ nights: 10, weeklyDiscountPercent: 0 });
    expect(result).toEqual({ percent: 0, label: null });
  });
});

describe("splitBookingChange on a commission booking", () => {
  // A 3-night stay at £100/night: the guest pays £300, FYStay's commission
  // is £30 of it and the host's payout £270.
  const threeNights = {
    totalPriceCents: 30000,
    cleaningFeeCents: 0,
    serviceFeeCents: 0,
    hostCommissionCents: 3000,
    taxCents: 0,
    creditAppliedCents: 0,
    promoDiscountCents: 0,
  };

  it("gives the host 90% and FYStay 10% when a 3-night stay gains a night", () => {
    // 4 nights: £400, so the guest owes £100 more.
    const extra = computeBookingPricing({ nights: 4, pricePerNightCents: 10000 }).totalPriceCents - 30000;
    expect(extra).toBe(10000);
    expect(splitBookingChange(extra, threeNights)).toEqual({ hostShareCents: 9000, platformShareCents: 1000 });
  });

  it("splits a refund for a shortened stay the same way, as negative shares", () => {
    const refund = computeBookingPricing({ nights: 2, pricePerNightCents: 10000 }).totalPriceCents - 30000;
    expect(refund).toBe(-10000);
    expect(splitBookingChange(refund, threeNights)).toEqual({ hostShareCents: -9000, platformShareCents: -1000 });
  });

  it("moves FYStay's share by how much its rounded commission moves", () => {
    // New stay £423.45: commission 4234.5 -> 4235, up 1235 from 3000.
    expect(splitBookingChange(12345, threeNights)).toEqual({ hostShareCents: 11110, platformShareCents: 1235 });
  });

  it("ignores FYStay-funded discounts when working out the accommodation amount", () => {
    // £300 stay, the guest paid £270 after a £20 promo and £10 credit.
    const discounted = { ...threeNights, promoDiscountCents: 2000, creditAppliedCents: 1000, totalPriceCents: 27000 };
    expect(splitBookingChange(10000, discounted)).toEqual({ hostShareCents: 9000, platformShareCents: 1000 });
    expect(splitBookingChange(-10000, discounted)).toEqual({ hostShareCents: -9000, platformShareCents: -1000 });
  });

  it("reads the current accommodation from the totals, so a second change after a first is still right", () => {
    // After gaining a night: total £400, commission £40.
    const afterFirstChange = { ...threeNights, totalPriceCents: 40000, hostCommissionCents: 4000 };
    expect(splitBookingChange(10000, afterFirstChange)).toEqual({ hostShareCents: 9000, platformShareCents: 1000 });
  });

  it("takes the commission on the discounted price of a stay with a weekly discount", () => {
    // 7 nights at £100 less 10% = £630, commission £63. 8 nights = £720, so
    // £90 more; the commission becomes £72.
    const weekly = { ...threeNights, totalPriceCents: 63000, hostCommissionCents: 6300 };
    const delta = computeBookingPricing({ nights: 8, pricePerNightCents: 10000, weeklyDiscountPercent: 10 }).totalPriceCents - 63000;
    expect(delta).toBe(9000);
    expect(splitBookingChange(delta, weekly)).toEqual({ hostShareCents: 8100, platformShareCents: 900 });
  });

  it("gives FYStay nothing on a change too small to move its rounded commission", () => {
    const tiny = { ...threeNights, totalPriceCents: 999, hostCommissionCents: 100 };
    // 1000 -> commission still 100.
    expect(splitBookingChange(1, tiny)).toEqual({ hostShareCents: 1, platformShareCents: 0 });
    // Refunding the whole stay returns the whole commission.
    expect(splitBookingChange(-999, tiny)).toEqual({ hostShareCents: -899, platformShareCents: -100 });
  });

  it("always sums back to the difference and never gives FYStay more than it", () => {
    for (const delta of [1, 7, 101, 999, 12345, -1, -101, -12345, -30000]) {
      const { hostShareCents, platformShareCents } = splitBookingChange(delta, threeNights);
      expect(hostShareCents + platformShareCents).toBe(delta);
      expect(Math.abs(platformShareCents)).toBeLessThanOrEqual(Math.abs(delta));
      expect(Math.sign(platformShareCents) * Math.sign(delta)).not.toBe(-1);
    }
  });
});

describe("splitBookingChange on an older service-fee booking", () => {
  // A 3-night stay at £100/night: £300 accommodation + £30 guest service fee, no commission.
  const threeNights = {
    totalPriceCents: 33000,
    cleaningFeeCents: 0,
    serviceFeeCents: 3000,
    hostCommissionCents: 0,
    taxCents: 0,
    creditAppliedCents: 0,
    promoDiscountCents: 0,
  };

  it("gives the host the accommodation and FYStay the fee when a 3-night stay gains a night", () => {
    // 4 nights: £400 + £40 = £440, so the guest owes £110 more.
    const extra = 40000 + legacyGuestServiceFeeFor(40000) - 33000;
    expect(extra).toBe(11000);
    expect(splitBookingChange(extra, threeNights)).toEqual({ hostShareCents: 10000, platformShareCents: 1000 });
  });

  it("splits an extra £100 on a multi-night stay by the 10% fee rule, not by one night's price", () => {
    const result = splitBookingChange(10000, threeNights);
    expect(result).toEqual({ hostShareCents: 9091, platformShareCents: 909 });
  });

  it("leaves cleaning fees with the host side unchanged - only accommodation moves", () => {
    const withCleaning = { ...threeNights, cleaningFeeCents: 3000, totalPriceCents: 36000 };
    expect(splitBookingChange(11000, withCleaning)).toEqual({ hostShareCents: 10000, platformShareCents: 1000 });
  });

  it("splits a refund for a shortened stay the same way, as negative shares", () => {
    expect(splitBookingChange(-11000, threeNights)).toEqual({ hostShareCents: -10000, platformShareCents: -1000 });
  });

  it("reads the current accommodation from the totals, so a second change after a first is still right", () => {
    // After gaining a night: total £440, fee £40.
    const afterFirstChange = { ...threeNights, totalPriceCents: 44000, serviceFeeCents: 4000 };
    expect(splitBookingChange(11000, afterFirstChange)).toEqual({ hostShareCents: 10000, platformShareCents: 1000 });
  });

  it("ignores FYStay-funded discounts when working out the accommodation amount", () => {
    const discounted = { ...threeNights, promoDiscountCents: 2000, totalPriceCents: 31000 };
    expect(splitBookingChange(11000, discounted)).toEqual({ hostShareCents: 10000, platformShareCents: 1000 });
  });

  it("always sums back to the difference and never gives FYStay more than it", () => {
    for (const delta of [1, 7, 101, 999, 12345, -1, -101, -12345]) {
      const { hostShareCents, platformShareCents } = splitBookingChange(delta, threeNights);
      expect(hostShareCents + platformShareCents).toBe(delta);
      expect(Math.abs(platformShareCents)).toBeLessThanOrEqual(Math.abs(delta));
      expect(Math.sign(platformShareCents) * Math.sign(delta)).not.toBe(-1);
    }
  });
});

describe("applyDiscountsToApplicationFee", () => {
  it("subtracts the discount from the platform fee when the fee covers it", () => {
    expect(applyDiscountsToApplicationFee(3000, 1000)).toBe(2000);
  });

  it("floors at 0 rather than going negative when the discount exceeds the whole fee", () => {
    expect(applyDiscountsToApplicationFee(500, 1000)).toBe(0);
  });

  it("is unchanged when there's no discount applied", () => {
    expect(applyDiscountsToApplicationFee(3000, 0)).toBe(3000);
  });

  it("is 0 when the fee itself equals the discount exactly", () => {
    expect(applyDiscountsToApplicationFee(1000, 1000)).toBe(0);
  });

  it("combines a referral credit and a promo discount into a single deduction", () => {
    expect(applyDiscountsToApplicationFee(3000, 1000 + 500)).toBe(1500);
  });
});

describe("discountedAccommodationCents", () => {
  it("charges a discounted stay at the price the guest was shown, not the gross nightly total", () => {
    const pricing = computeBookingPricing({ nights: 7, pricePerNightCents: 10000, weeklyDiscountPercent: 10 });
    const accommodation = discountedAccommodationCents({
      nights: 7,
      nightlyPriceCents: 10000,
      lengthOfStayDiscountCents: pricing.lengthOfStayDiscountCents,
    });
    expect(accommodation).toBe(63000);
    // Checkout's line items (accommodation + cleaning + fee + tax) add up to the booking's total -
    // and with no fees on top, the accommodation is the whole total.
    expect(accommodation + pricing.cleaningFeeCents + pricing.serviceFeeCents + pricing.taxCents).toBe(
      pricing.totalPriceCents,
    );
    expect(accommodation).toBe(pricing.totalPriceCents);
  });

  it("is simply nights x nightly rate when no discount applies", () => {
    expect(discountedAccommodationCents({ nights: 3, nightlyPriceCents: 7500, lengthOfStayDiscountCents: 0 })).toBe(22500);
  });
});

describe("computeBookingPricing with a last-minute deal", () => {
  it("charges the last-minute discount, with the commission on the discounted stay", () => {
    const pricing = computeBookingPricing({ nights: 3, pricePerNightCents: 10000, lastMinuteDiscountPercent: 20 });
    expect(pricing).toMatchObject({
      nightlySubtotalCents: 30000,
      lengthOfStayDiscountPercent: 20,
      lengthOfStayDiscountCents: 6000,
      lengthOfStayDiscountLabel: "last_minute",
      serviceFeeCents: 0,
      hostCommissionCents: 2400,
      totalPriceCents: 24000,
    });
  });

  it("never stacks with a weekly discount - the larger one applies", () => {
    const weeklyWins = computeBookingPricing({
      nights: 7,
      pricePerNightCents: 10000,
      weeklyDiscountPercent: 25,
      lastMinuteDiscountPercent: 20,
    });
    expect(weeklyWins).toMatchObject({ lengthOfStayDiscountPercent: 25, lengthOfStayDiscountLabel: "weekly" });

    const lastMinuteWins = computeBookingPricing({
      nights: 7,
      pricePerNightCents: 10000,
      weeklyDiscountPercent: 10,
      lastMinuteDiscountPercent: 20,
    });
    expect(lastMinuteWins).toMatchObject({ lengthOfStayDiscountPercent: 20, lengthOfStayDiscountLabel: "last_minute" });
  });

  it("names each discount for receipts", () => {
    expect(stayDiscountName("last_minute")).toBe("Last-minute deal");
    expect(stayDiscountName("monthly")).toBe("Monthly discount");
    expect(stayDiscountName("weekly")).toBe("Weekly discount");
  });
});

describe("weekend rates", () => {
  const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

  it("counts Friday and Saturday nights only", () => {
    expect(isWeekendNight(d("2026-11-06"))).toBe(true); // Friday
    expect(isWeekendNight(d("2026-11-07"))).toBe(true); // Saturday
    expect(isWeekendNight(d("2026-11-08"))).toBe(false); // Sunday
    expect(isWeekendNight(d("2026-11-05"))).toBe(false); // Thursday
    expect(weekendNightsBetween(d("2026-11-05"), d("2026-11-09"))).toBe(2); // Thu-Mon
    expect(weekendNightsBetween(d("2026-11-08"), d("2026-11-13"))).toBe(0); // Sun-Fri: checkout day isn't a night
    expect(weekendNightsBetween(d("2026-11-02"), d("2026-11-16"))).toBe(4); // two weeks
  });

  it("charges weeknights and Fri/Sat nights at their own rates", () => {
    // Thu-Sun: Thu at £255, Fri + Sat at £275 = £805, nothing on top; FYStay keeps 10% of it.
    const pricing = computeBookingPricing({
      nights: 3,
      ...stayRates({ pricePerNightCents: 25_500, weekendPricePerNightCents: 27_500 }, d("2026-11-05"), d("2026-11-08")),
    });
    expect(pricing).toMatchObject({
      nightlySubtotalCents: 80_500,
      weekendNights: 2,
      weekendNightlyPriceCents: 27_500,
      serviceFeeCents: 0,
      hostCommissionCents: 8_050,
      totalPriceCents: 80_500,
    });
  });

  it("prices exactly as before for a listing without a weekend rate", () => {
    const rates = stayRates({ pricePerNightCents: 10_000 }, d("2026-11-05"), d("2026-11-08"));
    expect(rates).toEqual({ pricePerNightCents: 10_000, weekendPricePerNightCents: null, weekendNights: 0 });
    expect(computeBookingPricing({ nights: 3, ...rates }).nightlySubtotalCents).toBe(30_000);
  });

  it("applies a stay discount to the whole weekday + weekend subtotal", () => {
    const pricing = computeBookingPricing({
      nights: 7,
      ...stayRates({ pricePerNightCents: 25_500, weekendPricePerNightCents: 27_500 }, d("2026-11-02"), d("2026-11-09")),
      weeklyDiscountPercent: 10,
    });
    // 5 x £255 + 2 x £275 = £1,825; 10% off = £182.50.
    expect(pricing.nightlySubtotalCents).toBe(182_500);
    expect(pricing.lengthOfStayDiscountCents).toBe(18_250);
  });

  it("works out a booking's accommodation from its own snapshot", () => {
    const booking = { nights: 3, nightlyPriceCents: 25_500, weekendNights: 2, weekendNightlyPriceCents: 27_500, lengthOfStayDiscountCents: 0 };
    expect(bookingNightlySubtotalCents(booking)).toBe(80_500);
    expect(discountedAccommodationCents(booking)).toBe(80_500);
    // Bookings from before weekend rates: nights x nightly rate, unchanged.
    expect(bookingNightlySubtotalCents({ nights: 3, nightlyPriceCents: 10_000 })).toBe(30_000);
    expect(bookingNightlySubtotalCents({ nights: 3, nightlyPriceCents: 10_000, weekendNights: 0, weekendNightlyPriceCents: null })).toBe(30_000);
  });

  it("splits the breakdown into weeknight and Fri/Sat lines that add up", () => {
    const fmt = (c: number) => `£${c / 100}`;
    const lines = nightlyChargeLines({ nights: 3, nightlyPriceCents: 25_500, weekendNights: 2, weekendNightlyPriceCents: 27_500 }, fmt);
    expect(lines).toEqual([
      { label: "£255 × 1 weeknight", cents: 25_500 },
      { label: "£275 × 2 Fri/Sat nights", cents: 55_000 },
    ]);
    expect(nightlyChargeLines({ nights: 2, nightlyPriceCents: 25_500, weekendNights: 2, weekendNightlyPriceCents: 27_500 }, fmt)).toEqual([
      { label: "£275 × 2 Fri/Sat nights", cents: 55_000 },
    ]);
    expect(nightlyChargeLines({ nights: 2, nightlyPriceCents: 10_000 }, fmt)).toEqual([{ label: "£100 × 2 nights", cents: 20_000 }]);
  });

  it("only allows a weekend rate at or above the weekday rate, and never on a hotel", () => {
    expect(weekendRateError({ pricePerNightCents: 25_500, weekendPricePerNightCents: 27_500 })).toBeNull();
    expect(weekendRateError({ pricePerNightCents: 25_500, weekendPricePerNightCents: null })).toBeNull();
    expect(weekendRateError({ pricePerNightCents: 25_500, weekendPricePerNightCents: 20_000 })).toMatch(/can't be lower/);
    expect(weekendRateError({ pricePerNightCents: 25_500, weekendPricePerNightCents: 27_500, propertyType: "HOTEL" })).toMatch(/room type/);
  });
});
