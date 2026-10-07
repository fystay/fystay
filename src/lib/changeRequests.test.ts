import { describe, expect, it } from "vitest";
import {
  bookingGrossTotalCents,
  canCancelBooking,
  canRequestBookingChange,
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
    cleaningFeeCents: 0,
    lastMinuteDiscountPercent: null,
    totalPriceCents: 28000,
    creditAppliedCents: 3000,
    promoDiscountCents: 2000,
  };
  const listing = { weeklyDiscountPercent: null, monthlyDiscountPercent: null };

  it("is zero for new dates of the same length on a discounted booking - the discounts aren't charged again", () => {
    expect(changePriceDeltaCents(discountedBooking, listing, 3)).toBe(0);
  });

  it("prices extra nights at the booking's own snapshotted rate, not the listing's rate today", () => {
    // One more night at the booking's £100 (+£10 fee); the listing's
    // current price isn't even an input.
    expect(changePriceDeltaCents(discountedBooking, listing, 4)).toBe(11000);
  });

  it("refunds a shorter stay's difference, but never more than the guest actually paid", () => {
    expect(changePriceDeltaCents(discountedBooking, listing, 2)).toBe(-11000);
    const mostlyCredit = { ...discountedBooking, totalPriceCents: 3000, creditAppliedCents: 28000 };
    expect(changePriceDeltaCents(mostlyCredit, listing, 1)).toBe(-3000);
  });

  it("keeps the booking's snapshotted cleaning fee and last-minute deal", () => {
    // 3 nights @ £100 less 20% = £240 + £24 fee + £20 cleaning = £284 gross,
    // £234 of it paid after the £50 of discounts.
    const booking = { ...discountedBooking, cleaningFeeCents: 2000, lastMinuteDiscountPercent: 20, totalPriceCents: 23400 };
    expect(bookingGrossTotalCents(booking)).toBe(28400);
    expect(changePriceDeltaCents(booking, listing, 3)).toBe(0);
  });
});

describe("isBookingStillChangeable", () => {
  it("only lets a change go ahead on a CONFIRMED stay that hasn't begun", () => {
    expect(isBookingStillChangeable({ status: "CONFIRMED", checkIn: new Date("2026-06-20") }, now)).toBe(true);
    expect(isBookingStillChangeable({ status: "CANCELLED", checkIn: new Date("2026-06-20") }, now)).toBe(false);
    expect(isBookingStillChangeable({ status: "CONFIRMED", checkIn: new Date("2026-06-10") }, now)).toBe(false);
  });
});
