import { describe, expect, it } from "vitest";
import {
  applyDiscountsToApplicationFee,
  discountedAccommodationCents,
  computeBookingPricing,
  stayDiscountName,
  GUEST_SERVICE_FEE_RATE,
  resolveLengthOfStayDiscount,
  splitBookingChange,
} from "./pricing";

describe("computeBookingPricing", () => {
  it("computes the nightly subtotal and service fee for a stay with no cleaning fee", () => {
    const result = computeBookingPricing({ nights: 3, pricePerNightCents: 10000 });

    expect(result.nightlySubtotalCents).toBe(30000);
    expect(result.cleaningFeeCents).toBe(0);
    expect(result.serviceFeeCents).toBe(3000);
    expect(result.taxCents).toBe(0);
    expect(result.totalPriceCents).toBe(33000);
  });

  it("includes the cleaning fee in the total but not in the service-fee base", () => {
    const result = computeBookingPricing({
      nights: 2,
      pricePerNightCents: 5000,
      cleaningFeeCents: 2500,
    });

    expect(result.nightlySubtotalCents).toBe(10000);
    expect(result.cleaningFeeCents).toBe(2500);
    expect(result.serviceFeeCents).toBe(1000);
    expect(result.totalPriceCents).toBe(13500);
  });

  it("returns all zeroes for a zero-night stay", () => {
    const result = computeBookingPricing({ nights: 0, pricePerNightCents: 12345 });
    expect(result.totalPriceCents).toBe(0);
  });

  it("rounds the service fee to the nearest whole cent/penny", () => {
    const result = computeBookingPricing({ nights: 1, pricePerNightCents: 999 });
    expect(result.serviceFeeCents).toBe(Math.round(999 * GUEST_SERVICE_FEE_RATE));
  });

  it("applies no discount below the weekly threshold, even if one is set", () => {
    const result = computeBookingPricing({
      nights: 6,
      pricePerNightCents: 10000,
      weeklyDiscountPercent: 10,
    });
    expect(result.lengthOfStayDiscountCents).toBe(0);
    expect(result.lengthOfStayDiscountLabel).toBeNull();
    expect(result.totalPriceCents).toBe(66000);
  });

  it("applies the weekly discount to the nightly subtotal at 7+ nights", () => {
    const result = computeBookingPricing({
      nights: 7,
      pricePerNightCents: 10000,
      weeklyDiscountPercent: 10,
    });
    // 70000 gross - 10% = 63000, service fee on the discounted amount.
    expect(result.nightlySubtotalCents).toBe(70000);
    expect(result.lengthOfStayDiscountPercent).toBe(10);
    expect(result.lengthOfStayDiscountCents).toBe(7000);
    expect(result.lengthOfStayDiscountLabel).toBe("weekly");
    expect(result.serviceFeeCents).toBe(6300);
    expect(result.totalPriceCents).toBe(69300);
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

  it("includes the cleaning fee in the total after the discount, not before", () => {
    const result = computeBookingPricing({
      nights: 7,
      pricePerNightCents: 10000,
      cleaningFeeCents: 5000,
      weeklyDiscountPercent: 10,
    });
    expect(result.totalPriceCents).toBe(63000 + 6300 + 5000);
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

describe("splitBookingChange", () => {
  // A 3-night stay at £100/night: £300 accommodation + £30 FYStay fee.
  const threeNights = {
    totalPriceCents: 33000,
    cleaningFeeCents: 0,
    serviceFeeCents: 3000,
    taxCents: 0,
    creditAppliedCents: 0,
    promoDiscountCents: 0,
  };

  it("gives the host the accommodation and FYStay the fee when a 3-night stay gains a night", () => {
    // 4 nights: £400 + £40 = £440, so the guest owes £110 more.
    const extra = computeBookingPricing({ nights: 4, pricePerNightCents: 10000 }).totalPriceCents - 33000;
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
    // Checkout's line items (accommodation + cleaning + fee + tax) add up to the booking's total.
    expect(accommodation + pricing.cleaningFeeCents + pricing.serviceFeeCents + pricing.taxCents).toBe(
      pricing.totalPriceCents,
    );
  });

  it("is simply nights x nightly rate when no discount applies", () => {
    expect(discountedAccommodationCents({ nights: 3, nightlyPriceCents: 7500, lengthOfStayDiscountCents: 0 })).toBe(22500);
  });
});

describe("computeBookingPricing with a last-minute deal", () => {
  it("charges the last-minute discount, with the service fee on the discounted stay", () => {
    const pricing = computeBookingPricing({ nights: 3, pricePerNightCents: 10000, lastMinuteDiscountPercent: 20 });
    expect(pricing).toMatchObject({
      nightlySubtotalCents: 30000,
      lengthOfStayDiscountPercent: 20,
      lengthOfStayDiscountCents: 6000,
      lengthOfStayDiscountLabel: "last_minute",
      serviceFeeCents: 2400,
      totalPriceCents: 26400,
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
