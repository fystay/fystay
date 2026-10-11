import { describe, expect, it } from "vitest";
import {
  bookingGrossTotalCents,
  canCancelBooking,
  canRequestBookingChange,
  bookingFieldsAfterChange,
  changePriceDeltaCents,
  computePriceDeltaCents,
  isBookingStillChangeable,
} from "./changeRequests";

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
