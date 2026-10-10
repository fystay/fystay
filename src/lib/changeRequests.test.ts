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
    // 5 nights @ £100 = £500 subtotal + 10% service fee = £550 total.
    expect(
      computePriceDeltaCents({
        requestedNights: 5,
        pricePerNightCents: 10000,
        currentTotalPriceCents: 30000,
      }),
    ).toBe(25000);
  });

  it("is negative when the new stay costs less", () => {
    // 2 nights @ £100 = £200 subtotal + 10% service fee = £220 total.
    expect(
      computePriceDeltaCents({
        requestedNights: 2,
        pricePerNightCents: 10000,
        currentTotalPriceCents: 30000,
      }),
    ).toBe(-8000);
  });

  it("is zero when the price is unchanged", () => {
    // 3 nights @ £100 = £300 subtotal + 10% service fee = £330 total.
    expect(
      computePriceDeltaCents({
        requestedNights: 3,
        pricePerNightCents: 10000,
        currentTotalPriceCents: 33000,
      }),
    ).toBe(0);
  });

  it("includes the cleaning fee in the new total", () => {
    // 3 nights @ £100 = £300 subtotal + £20 cleaning fee + 10% service fee
    // (of the subtotal only) = £350 total.
    expect(
      computePriceDeltaCents({
        requestedNights: 3,
        pricePerNightCents: 10000,
        cleaningFeeCents: 2000,
        currentTotalPriceCents: 33000,
      }),
    ).toBe(2000);
  });
});

describe("changePriceDeltaCents", () => {
  // 3 nights @ £100 = £300 + 10% service fee = £330 gross; the guest paid
  // £280 of it after £30 of referral credit and a £20 promo code.
  const discountedBooking = {
    nightlyPriceCents: 10000,
    weekendNightlyPriceCents: null,
    cleaningFeeCents: 0,
    lastMinuteDiscountPercent: null,
    totalPriceCents: 28000,
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
    expect(changePriceDeltaCents(discountedBooking, listing, stay(3))).toBe(0);
  });

  it("prices extra nights at the booking's own snapshotted rate, not the listing's rate today", () => {
    // One more night at the booking's £100 (+£10 fee); the listing's
    // current price isn't even an input.
    expect(changePriceDeltaCents(discountedBooking, listing, stay(4))).toBe(11000);
  });

  it("refunds a shorter stay's difference, but never more than the guest actually paid", () => {
    expect(changePriceDeltaCents(discountedBooking, listing, stay(2))).toBe(-11000);
    const mostlyCredit = { ...discountedBooking, totalPriceCents: 3000, creditAppliedCents: 28000 };
    expect(changePriceDeltaCents(mostlyCredit, listing, stay(1))).toBe(-3000);
  });

  it("keeps the booking's snapshotted cleaning fee and last-minute deal", () => {
    // 3 nights @ £100 less 20% = £240 + £24 fee + £20 cleaning = £284 gross,
    // £234 of it paid after the £50 of discounts.
    const booking = { ...discountedBooking, cleaningFeeCents: 2000, lastMinuteDiscountPercent: 20, totalPriceCents: 23400 };
    expect(bookingGrossTotalCents(booking)).toBe(28400);
    expect(changePriceDeltaCents(booking, listing, stay(3))).toBe(0);
  });

  describe("with a weekend rate", () => {
    // Booked Mon-Wed (2 weeknights @ £255) under a £275 Fri/Sat rate:
    // £510 + £51 fee = £561, all paid.
    const weekendBooking = {
      nightlyPriceCents: 25500,
      weekendNightlyPriceCents: 27500,
      cleaningFeeCents: 0,
      lastMinuteDiscountPercent: null,
      totalPriceCents: 56100,
      creditAppliedCents: 0,
      promoDiscountCents: 0,
    };

    it("charges the weekend difference for moving the same nights onto Fri and Sat", () => {
      const friToSun = { checkIn: new Date("2026-11-06T00:00:00Z"), checkOut: new Date("2026-11-08T00:00:00Z") };
      // 2 x £20 more, plus 10% fee.
      expect(changePriceDeltaCents(weekendBooking, listing, friToSun)).toBe(4400);
    });

    it("costs nothing to move to other weeknights", () => {
      const tueToThu = { checkIn: new Date("2026-11-03T00:00:00Z"), checkOut: new Date("2026-11-05T00:00:00Z") };
      expect(changePriceDeltaCents(weekendBooking, listing, tueToThu)).toBe(0);
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
  const booking = {
    totalPriceCents: 56_100,
    cleaningFeeCents: 0,
    serviceFeeCents: 5_100,
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
