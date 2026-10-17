import { describe, expect, it } from "vitest";
import {
  bookingGrossTotalCents,
  canCancelBooking,
  canRequestBookingChange,
  bookingFieldsAfterChange,
  changePriceDeltaCents,
  computePriceDeltaCents,
  isBookingStillChangeable,
  isRefundChangeOnDiscountedBooking,
  changeBreaksMinimumPayout,
  MINIMUM_PAYOUT_CHANGE_MESSAGE,
} from "./changeRequests";
import { splitBookingChange } from "./pricing";

const now = new Date("2026-06-15");

describe("canCancelBooking", () => {
  it("allows cancelling an upcoming booking", () => {
    expect(canCancelBooking({ status: "CONFIRMED", checkIn: new Date("2026-06-20") }, now)).toBe(
      true,
    );
  });

  it("rejects a booking that has already started", () => {
    expect(canCancelBooking({ status: "CONFIRMED", checkIn: new Date("2026-06-10") }, now)).toBe(
      false,
    );
  });

  it("rejects an already-cancelled booking", () => {
    expect(canCancelBooking({ status: "CANCELLED", checkIn: new Date("2026-06-20") }, now)).toBe(
      false,
    );
  });

  it("allows cancelling a PENDING (unpaid) upcoming booking", () => {
    expect(canCancelBooking({ status: "PENDING", checkIn: new Date("2026-06-20") }, now)).toBe(
      true,
    );
  });
});

describe("canRequestBookingChange", () => {
  it("allows a change request on a CONFIRMED, upcoming booking with no pending request", () => {
    expect(
      canRequestBookingChange({ status: "CONFIRMED", checkIn: new Date("2026-06-20") }, false, now),
    ).toBe(true);
  });

  it("rejects a booking that already has a pending request", () => {
    expect(
      canRequestBookingChange({ status: "CONFIRMED", checkIn: new Date("2026-06-20") }, true, now),
    ).toBe(false);
  });

  it("rejects a PENDING (unpaid) booking", () => {
    expect(
      canRequestBookingChange({ status: "PENDING", checkIn: new Date("2026-06-20") }, false, now),
    ).toBe(false);
  });

  it("rejects a booking that has already started", () => {
    expect(
      canRequestBookingChange({ status: "CONFIRMED", checkIn: new Date("2026-06-10") }, false, now),
    ).toBe(false);
  });
});

describe("computePriceDeltaCents", () => {
  it("is positive when the new stay costs more", () => {
    // 5 nights @ £100 = £500, nothing on top, against £300 paid.
    expect(
      computePriceDeltaCents({
        requestedNights: 5,
        pricePerNightCents: 10000,
        currentTotalPriceCents: 30000,
      }),
    ).toBe(20000);
  });

  it("is negative when the new stay costs less", () => {
    // 2 nights @ £100 = £200.
    expect(
      computePriceDeltaCents({
        requestedNights: 2,
        pricePerNightCents: 10000,
        currentTotalPriceCents: 30000,
      }),
    ).toBe(-10000);
  });

  it("is zero when the price is unchanged", () => {
    expect(
      computePriceDeltaCents({
        requestedNights: 3,
        pricePerNightCents: 10000,
        currentTotalPriceCents: 30000,
      }),
    ).toBe(0);
  });

  it("charges no service fee on a commission booking - FYStay's commission isn't the guest's to pay", () => {
    // 4 nights @ £99.99 = £399.96: the delta is exactly the extra night.
    expect(
      computePriceDeltaCents({
        requestedNights: 4,
        pricePerNightCents: 9999,
        currentTotalPriceCents: 29997,
      }),
    ).toBe(9999);
  });

  describe("for an older service-fee booking", () => {
    it("prices the new stay with the 10% guest service fee on top, the way it was booked", () => {
      // 5 nights @ £100 = £500 + £50 fee = £550, against £330 paid.
      expect(
        computePriceDeltaCents({
          requestedNights: 5,
          pricePerNightCents: 10000,
          legacyServiceFee: true,
          currentTotalPriceCents: 33000,
        }),
      ).toBe(22000);
      // 2 nights @ £100 = £200 + £20 fee = £220.
      expect(
        computePriceDeltaCents({
          requestedNights: 2,
          pricePerNightCents: 10000,
          legacyServiceFee: true,
          currentTotalPriceCents: 33000,
        }),
      ).toBe(-11000);
    });

    it("keeps the booking's cleaning fee in the new total, outside the service-fee base", () => {
      // 3 nights @ £100 = £300 + £20 cleaning + £30 fee (of the stay only) = £350.
      expect(
        computePriceDeltaCents({
          requestedNights: 3,
          pricePerNightCents: 10000,
          cleaningFeeCents: 2000,
          legacyServiceFee: true,
          currentTotalPriceCents: 33000,
        }),
      ).toBe(2000);
    });

    it("takes the service fee on the discounted stay", () => {
      // 7 nights @ £100 less 10% = £630 + £63 fee = £693.
      expect(
        computePriceDeltaCents({
          requestedNights: 7,
          pricePerNightCents: 10000,
          weeklyDiscountPercent: 10,
          legacyServiceFee: true,
          currentTotalPriceCents: 33000,
        }),
      ).toBe(36300);
    });
  });
});

describe("changePriceDeltaCents", () => {
  // 3 nights @ £100 = £300 gross, nothing on top; the guest paid £250 of it
  // after £30 of referral credit and a £20 promo code. FYStay's commission is £30.
  const discountedBooking = {
    nightlyPriceCents: 10000,
    weekendNightlyPriceCents: null,
    cleaningFeeCents: 0,
    serviceFeeCents: 0,
    hostCommissionCents: 3000,
    lastMinuteDiscountPercent: null,
    totalPriceCents: 25000,
    creditAppliedCents: 3000,
    promoDiscountCents: 2000,
  };
  const listing = { weeklyDiscountPercent: null, monthlyDiscountPercent: null };
  // A stay of `nights` nights from Monday 2 November 2026.
  const stay = (nights: number) => ({
    checkIn: new Date("2026-11-02T00:00:00Z"),
    checkOut: new Date(Date.UTC(2026, 10, 2 + nights)),
  });

  it("is zero for new dates of the same length on a discounted booking - the discounts aren't charged again", () => {
    expect(bookingGrossTotalCents(discountedBooking)).toBe(30000);
    expect(changePriceDeltaCents(discountedBooking, listing, stay(3))).toBe(0);
  });

  it("prices extra nights at the booking's own snapshotted rate, not the listing's rate today", () => {
    // One more night at the booking's £100, no fee on top; the listing's
    // current price isn't even an input.
    expect(changePriceDeltaCents(discountedBooking, listing, stay(4))).toBe(10000);
  });

  it("refunds a shorter stay's difference, but never more than the guest actually paid", () => {
    expect(changePriceDeltaCents(discountedBooking, listing, stay(2))).toBe(-10000);
    // £300 gross, £280 of it credit: 1 night (£100) would be -£200, but only £20 was paid.
    const mostlyCredit = { ...discountedBooking, totalPriceCents: 2000, creditAppliedCents: 28000, promoDiscountCents: 0 };
    expect(changePriceDeltaCents(mostlyCredit, listing, stay(1))).toBe(-2000);
  });

  it("keeps the booking's snapshotted last-minute deal", () => {
    // 3 nights @ £100 less 20% = £240 gross, £190 of it paid after the £50 of discounts.
    const booking = { ...discountedBooking, hostCommissionCents: 2400, lastMinuteDiscountPercent: 20, totalPriceCents: 19000 };
    expect(bookingGrossTotalCents(booking)).toBe(24000);
    expect(changePriceDeltaCents(booking, listing, stay(3))).toBe(0);
    // A 4th night at £100 less 20% = £80.
    expect(changePriceDeltaCents(booking, listing, stay(4))).toBe(8000);
  });

  describe("on an older service-fee booking", () => {
    // 3 nights @ £100 = £300 + 10% service fee = £330 gross; the guest paid
    // £280 of it after £30 of referral credit and a £20 promo code.
    const legacyBooking = {
      ...discountedBooking,
      serviceFeeCents: 3000,
      hostCommissionCents: 0,
      totalPriceCents: 28000,
    };

    it("is zero for new dates of the same length", () => {
      expect(changePriceDeltaCents(legacyBooking, listing, stay(3))).toBe(0);
    });

    it("prices extra nights with the service fee on top, the way it was booked", () => {
      // One more night at £100 + £10 fee.
      expect(changePriceDeltaCents(legacyBooking, listing, stay(4))).toBe(11000);
    });

    it("refunds a shorter stay's difference, but never more than the guest actually paid", () => {
      expect(changePriceDeltaCents(legacyBooking, listing, stay(2))).toBe(-11000);
      const mostlyCredit = { ...legacyBooking, totalPriceCents: 3000, creditAppliedCents: 28000 };
      expect(changePriceDeltaCents(mostlyCredit, listing, stay(1))).toBe(-3000);
    });

    it("keeps the booking's snapshotted cleaning fee and last-minute deal", () => {
      // 3 nights @ £100 less 20% = £240 + £24 fee + £20 cleaning = £284 gross,
      // £234 of it paid after the £50 of discounts.
      const booking = {
        ...legacyBooking,
        serviceFeeCents: 2400,
        cleaningFeeCents: 2000,
        lastMinuteDiscountPercent: 20,
        totalPriceCents: 23400,
      };
      expect(bookingGrossTotalCents(booking)).toBe(28400);
      expect(changePriceDeltaCents(booking, listing, stay(3))).toBe(0);
      // 4 nights: £320 + £32 fee + £20 cleaning = £372, £88 more.
      expect(changePriceDeltaCents(booking, listing, stay(4))).toBe(8800);
    });
  });

  describe("with a weekend rate", () => {
    // Booked Mon-Wed (2 weeknights @ £255) under a £275 Fri/Sat rate:
    // £510, all paid; FYStay's commission £51.
    const weekendBooking = {
      nightlyPriceCents: 25500,
      weekendNightlyPriceCents: 27500,
      cleaningFeeCents: 0,
      serviceFeeCents: 0,
      hostCommissionCents: 5100,
      lastMinuteDiscountPercent: null,
      totalPriceCents: 51000,
      creditAppliedCents: 0,
      promoDiscountCents: 0,
    };
    const friToSun = { checkIn: new Date("2026-11-06T00:00:00Z"), checkOut: new Date("2026-11-08T00:00:00Z") };
    const tueToThu = { checkIn: new Date("2026-11-03T00:00:00Z"), checkOut: new Date("2026-11-05T00:00:00Z") };

    it("charges the weekend difference for moving the same nights onto Fri and Sat", () => {
      // 2 x £20 more, nothing on top.
      expect(changePriceDeltaCents(weekendBooking, listing, friToSun)).toBe(4000);
    });

    it("costs nothing to move to other weeknights", () => {
      expect(changePriceDeltaCents(weekendBooking, listing, tueToThu)).toBe(0);
    });

    it("adds the service fee to the weekend difference on an older booking", () => {
      // £510 + £51 fee = £561 paid; Fri-Sun is £550 + £55 = £605.
      const legacy = { ...weekendBooking, serviceFeeCents: 5100, hostCommissionCents: 0, totalPriceCents: 56100 };
      expect(changePriceDeltaCents(legacy, listing, friToSun)).toBe(4400);
      expect(changePriceDeltaCents(legacy, listing, tueToThu)).toBe(0);
    });
  });
});

describe("isBookingStillChangeable", () => {
  it("only lets a change go ahead on a CONFIRMED stay that hasn't begun", () => {
    expect(isBookingStillChangeable({ status: "CONFIRMED", checkIn: new Date("2026-06-20") }, now)).toBe(true);
    expect(isBookingStillChangeable({ status: "CANCELLED", checkIn: new Date("2026-06-20") }, now)).toBe(false);
    expect(isBookingStillChangeable({ status: "CONFIRMED", checkIn: new Date("2026-06-10") }, now)).toBe(false);
  });
});

describe("bookingFieldsAfterChange with a weekend rate", () => {
  // An older service-fee booking: Mon-Wed at £255 = £510 + £51 fee.
  const booking = {
    totalPriceCents: 56_100,
    cleaningFeeCents: 0,
    serviceFeeCents: 5_100,
    hostCommissionCents: 0,
    taxCents: 0,
    creditAppliedCents: 0,
    promoDiscountCents: 0,
  };

  it("recounts the weekend nights for the new dates", () => {
    const change = {
      requestedCheckIn: new Date("2026-11-06T00:00:00Z"),
      requestedCheckOut: new Date("2026-11-09T00:00:00Z"),
      requestedGuests: 2,
      priceDeltaCents: 32_450,
    };
    expect(bookingFieldsAfterChange({ ...booking, weekendNightlyPriceCents: 27_500 }, change)).toMatchObject({ nights: 3, weekendNights: 2 });
    expect(bookingFieldsAfterChange({ ...booking, weekendNightlyPriceCents: null }, change)).toMatchObject({ nights: 3, weekendNights: 0 });
  });
});

describe("bookingFieldsAfterChange", () => {
  const friToSun = {
    requestedCheckIn: new Date("2026-11-06T00:00:00Z"),
    requestedCheckOut: new Date("2026-11-08T00:00:00Z"),
    requestedGuests: 2,
  };

  it("moves a commission booking's commission by FYStay's share, leaving its service fee alone", () => {
    // Mon-Wed at £255 = £510, commission £51; Fri-Sun at £275 = £550, so £40 more.
    const booking = {
      totalPriceCents: 51_000,
      cleaningFeeCents: 0,
      serviceFeeCents: 0,
      hostCommissionCents: 5_100,
      taxCents: 0,
      creditAppliedCents: 0,
      promoDiscountCents: 0,
      weekendNightlyPriceCents: 27_500,
    };
    const fields = bookingFieldsAfterChange(booking, { ...friToSun, priceDeltaCents: 4_000 });
    expect(fields).toMatchObject({ nights: 2, weekendNights: 2, totalPriceCents: 55_000, hostCommissionCents: 5_500 });
    expect(fields).not.toHaveProperty("serviceFeeCents");
  });

  it("moves a commission booking's commission down on a refund, with a promo still FYStay's", () => {
    // 3 nights at £100 = £300, commission £30, guest paid £280 after a £20 promo.
    // Shortened to 2 nights: £100 back; commission becomes £20.
    const booking = {
      totalPriceCents: 28_000,
      cleaningFeeCents: 0,
      serviceFeeCents: 0,
      hostCommissionCents: 3_000,
      taxCents: 0,
      creditAppliedCents: 0,
      promoDiscountCents: 2_000,
      weekendNightlyPriceCents: null,
    };
    const fields = bookingFieldsAfterChange(booking, {
      requestedCheckIn: new Date("2026-11-02T00:00:00Z"),
      requestedCheckOut: new Date("2026-11-04T00:00:00Z"),
      requestedGuests: 2,
      priceDeltaCents: -10_000,
    });
    expect(fields).toMatchObject({ nights: 2, totalPriceCents: 18_000, hostCommissionCents: 2_000 });
  });

  it("moves an older booking's service fee instead, leaving its commission alone", () => {
    // Mon-Wed £510 + £51 fee = £561; Fri-Sun £550 + £55 = £605, so £44 more.
    const booking = {
      totalPriceCents: 56_100,
      cleaningFeeCents: 0,
      serviceFeeCents: 5_100,
      hostCommissionCents: 0,
      taxCents: 0,
      creditAppliedCents: 0,
      promoDiscountCents: 0,
      weekendNightlyPriceCents: 27_500,
    };
    const fields = bookingFieldsAfterChange(booking, { ...friToSun, priceDeltaCents: 4_400 });
    expect(fields).toMatchObject({ totalPriceCents: 60_500, serviceFeeCents: 5_500 });
    expect(fields).not.toHaveProperty("hostCommissionCents");
  });
});

describe("isRefundChangeOnDiscountedBooking (launch rule: no refunding date change on a discounted booking)", () => {
  const promo = { promoDiscountCents: 2_000, creditAppliedCents: 0 };
  const credit = { promoDiscountCents: 0, creditAppliedCents: 1_500 };
  const both = { promoDiscountCents: 2_000, creditAppliedCents: 1_500 };
  const none = { promoDiscountCents: 0, creditAppliedCents: 0 };

  it("blocks a shorter or cheaper stay on a promo booking", () => {
    expect(isRefundChangeOnDiscountedBooking(promo, -10_000)).toBe(true);
  });

  it("blocks it on a referral-credit booking, and on one with both", () => {
    expect(isRefundChangeOnDiscountedBooking(credit, -10_000)).toBe(true);
    expect(isRefundChangeOnDiscountedBooking(both, -10_000)).toBe(true);
  });

  it("blocks even a one-penny refund - any refund would go back proportionally", () => {
    expect(isRefundChangeOnDiscountedBooking(promo, -1)).toBe(true);
  });

  it("allows a change that costs the same or more on a discounted booking", () => {
    expect(isRefundChangeOnDiscountedBooking(promo, 0)).toBe(false);
    expect(isRefundChangeOnDiscountedBooking(promo, 1)).toBe(false);
    expect(isRefundChangeOnDiscountedBooking(both, 14_500)).toBe(false);
  });

  it("never blocks a booking without a discount", () => {
    expect(isRefundChangeOnDiscountedBooking(none, -10_000)).toBe(false);
    expect(isRefundChangeOnDiscountedBooking(none, -1)).toBe(false);
  });

  it("catches a same-length move to cheaper nights, not only a shorter stay", () => {
    // Fri-Sun at a £150 weekend rate moved to Tue-Thu at £100: same nights, £100 cheaper.
    const weekendBooking = {
      nightlyPriceCents: 10_000,
      weekendNightlyPriceCents: 15_000,
      cleaningFeeCents: 0,
      serviceFeeCents: 0,
      hostCommissionCents: 3_000,
      lastMinuteDiscountPercent: null,
      totalPriceCents: 28_000,
      creditAppliedCents: 0,
      promoDiscountCents: 2_000,
    };
    const delta = changePriceDeltaCents(
      weekendBooking,
      { weeklyDiscountPercent: null, monthlyDiscountPercent: null },
      { checkIn: new Date("2026-12-08"), checkOut: new Date("2026-12-10") },
    );
    expect(delta).toBe(-10_000);
    expect(isRefundChangeOnDiscountedBooking(weekendBooking, delta)).toBe(true);
  });
});

describe("date changes on a dynamic-commission booking that protects a host minimum", () => {
  const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
  // Thu 22 + Fri 23 Oct 2026: £100 weeknight, £200 Friday. FYStay 15% (£45), host £255.
  const booking = {
    nightlyPriceCents: 10_000,
    weekendNightlyPriceCents: 20_000,
    cleaningFeeCents: 0,
    serviceFeeCents: 0,
    taxCents: 0,
    hostCommissionCents: 4_500,
    lastMinuteDiscountPercent: null,
    totalPriceCents: 30_000,
    creditAppliedCents: 0,
    promoDiscountCents: 0,
    pricingPolicyVersion: "dynamic-v1",
    commissionRateBps: 1500,
    minHostPayoutPerNightCents: 9_000,
  };
  const noDiscounts = { weeklyDiscountPercent: null, monthlyDiscountPercent: null };

  it("refuses a change that would leave the host under their minimum (dropping the Friday), with a message that doesn't reveal it", () => {
    const requested = { checkIn: day("2026-10-26"), checkOut: day("2026-10-28") }; // two weeknights
    const delta = changePriceDeltaCents(booking, noDiscounts, requested);
    expect(delta).toBe(-10_000);
    // FYStay returns its 15% of the £100 refund, as Stripe does: the host keeps £170 < 2 x £90.
    expect(splitBookingChange(delta, booking)).toEqual({ hostShareCents: -8_500, platformShareCents: -1_500 });
    expect(changeBreaksMinimumPayout(booking, delta, requested)).toBe(true);
    expect(MINIMUM_PAYOUT_CHANGE_MESSAGE).not.toMatch(/£|90/);
    // Keeping a Friday night is fine.
    const keepsFriday = { checkIn: day("2026-10-29"), checkOut: day("2026-10-31") };
    expect(changeBreaksMinimumPayout(booking, changePriceDeltaCents(booking, noDiscounts, keepsFriday), keepsFriday)).toBe(false);
  });

  it("limits the host's weekly discount on an extension to 7 nights, so the stay still pays their minimum", () => {
    // 6 weeknights at £100, FYStay 10% (£60), minimum £80 a night.
    const sixNights = { ...booking, weekendNightlyPriceCents: null, hostCommissionCents: 6_000, totalPriceCents: 60_000, commissionRateBps: 1000, minHostPayoutPerNightCents: 8_000 };
    const requested = { checkIn: day("2026-10-26"), checkOut: day("2026-11-02") };
    // 20% would make it £560 and pay £504 < 7 x £80; 11% (£623) pays £560.70 - the largest whole percent that works.
    const delta = changePriceDeltaCents(sixNights, { weeklyDiscountPercent: 20, monthlyDiscountPercent: null }, requested);
    expect(delta).toBe(62_300 - 60_000);
    expect(changeBreaksMinimumPayout(sixNights, delta, requested)).toBe(false);
    // Without a protected minimum the host's full 20% applies, as before.
    expect(changePriceDeltaCents({ ...sixNights, minHostPayoutPerNightCents: null }, { weeklyDiscountPercent: 20, monthlyDiscountPercent: null }, requested)).toBe(56_000 - 60_000);
  });

  it("moves FYStay's fee at the booking's exact ratio, not the rate rounded to a basis point; the fixed 10% is unchanged", () => {
    const odd = { ...booking, weekendNightlyPriceCents: null, hostCommissionCents: 2_999, commissionRateBps: 1000, minHostPayoutPerNightCents: null };
    // 2,999 / 30,000 of a £100 refund is £9.9967 -> £10.00 (a 10.00% basis-point rate would also say £10.00; on £33.33 it differs).
    expect(splitBookingChange(-3_333, odd).platformShareCents).toBe(-Math.round((3_333 * 2_999) / 30_000));
    expect(splitBookingChange(3_333, odd).platformShareCents).toBe(Math.round((33_333 * 2_999) / 30_000) - 2_999);
    const fixed = { ...odd, pricingPolicyVersion: "fixed-10-v1" };
    expect(splitBookingChange(-3_333, fixed).platformShareCents).toBe(Math.round((26_667 * 1000) / 10_000) - 2_999);
  });
});
