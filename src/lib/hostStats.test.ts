import { describe, expect, it } from "vitest";
import {
  computeHostResponseStats,
  computeOccupancyRate,
  formatResponseTime,
  hostPayoutCents,
  hostRevenueCents,
  isGreatHost,
  summarizeEarnings,
} from "./hostStats";

function booking(overrides: Partial<Parameters<typeof hostRevenueCents>[0]> = {}) {
  // Two nights at £60: the guest pays £120 and nothing on top; FYStay's 10%
  // commission (£12) comes out of the host's share, leaving them £108.
  return {
    serviceFeeCents: 0,
    hostCommissionCents: 1200,
    taxCents: 0,
    creditAppliedCents: 0,
    promoDiscountCents: 0,
    totalPriceCents: 12000,
    refundedAmountCents: null,
    paymentStatus: "PAID" as const,
    ...overrides,
  };
}

// An older booking: two nights at £50 plus £20 cleaning (£120 for the host)
// and a £12 guest service fee on top, no commission.
function legacyBooking(overrides: Partial<Parameters<typeof hostRevenueCents>[0]> = {}) {
  return booking({ totalPriceCents: 13200, serviceFeeCents: 1200, hostCommissionCents: 0, ...overrides });
}

describe("hostRevenueCents", () => {
  it("is 0 for an unpaid booking", () => {
    expect(hostRevenueCents(booking({ paymentStatus: "UNPAID" }))).toBe(0);
  });

  it("is what the guest paid less FYStay's 10% commission for a fully paid, unrefunded booking", () => {
    // 12000 paid - 1200 commission = 10800
    expect(hostRevenueCents(booking())).toBe(10800);
  });

  it("counts every night of the stay, not just one", () => {
    // 7 nights at £100 less a £70 weekly discount = £630 paid, £63 commission
    expect(hostRevenueCents(booking({ totalPriceCents: 63000, hostCommissionCents: 6300 }))).toBe(56700);
  });

  it("isn't reduced by a promo code or referral credit - FYStay absorbs those out of its commission", () => {
    // £120 stay, £3 credit + £2 promo: the guest pays £115, FYStay's fee
    // drops from £12 to £7, and the host still gets £108.
    expect(
      hostRevenueCents(booking({ totalPriceCents: 11500, creditAppliedCents: 300, promoDiscountCents: 200 })),
    ).toBe(10800);
  });

  it("reduces revenue proportionally for a partial refund", () => {
    // 50% of the 12000 total refunded -> host keeps 50% of their 10800 share
    expect(hostRevenueCents(booking({ paymentStatus: "PARTIALLY_REFUNDED", refundedAmountCents: 6000 }))).toBe(
      5400,
    );
  });

  it("is 0 for a fully refunded booking", () => {
    expect(hostRevenueCents(booking({ paymentStatus: "REFUNDED", refundedAmountCents: 12000 }))).toBe(0);
  });

  it("never goes negative if a refund somehow exceeds the total", () => {
    expect(hostRevenueCents(booking({ paymentStatus: "REFUNDED", refundedAmountCents: 99999 }))).toBe(0);
  });

  describe("an older service-fee booking", () => {
    it("excludes the guest service fee, so the host keeps every night plus cleaning", () => {
      // 13200 paid - 1200 service fee = 12000
      expect(hostRevenueCents(legacyBooking())).toBe(12000);
    });

    it("isn't reduced by a promo code or referral credit either", () => {
      expect(
        hostRevenueCents(legacyBooking({ totalPriceCents: 12700, creditAppliedCents: 300, promoDiscountCents: 200 })),
      ).toBe(12000);
    });

    it("reduces revenue proportionally for a partial refund", () => {
      expect(
        hostRevenueCents(legacyBooking({ paymentStatus: "PARTIALLY_REFUNDED", refundedAmountCents: 6600 })),
      ).toBe(6000);
    });
  });
});

describe("hostPayoutCents", () => {
  it("is the guest's total less FYStay's commission on a commission booking", () => {
    expect(hostPayoutCents(booking())).toBe(10800);
  });

  it("takes a promo code and referral credit out of FYStay's commission, not the host's payout", () => {
    // £120 stay, £5 promo + £3 credit: guest pays £112; application fee
    // £12 - £8 = £4; host gets £112 - £4 = £108 - the same as with no promo.
    expect(hostPayoutCents(booking({ totalPriceCents: 11200, promoDiscountCents: 500, creditAppliedCents: 300 }))).toBe(
      10800,
    );
  });

  it("only reaches into the host's share when discounts exceed the whole commission (bookings from before the cap)", () => {
    // £15 promo on a £12 commission: fee floors at 0, guest paid £105, host gets all of it.
    expect(hostPayoutCents(booking({ totalPriceCents: 10500, promoDiscountCents: 1500 }))).toBe(10500);
  });

  it("is the guest's total less the service fee on an older booking", () => {
    expect(hostPayoutCents(legacyBooking())).toBe(12000);
  });
});

describe("summarizeEarnings", () => {
  const reference = new Date("2026-06-15T00:00:00Z");

  it("buckets a booking checking in this month into both total and thisMonth", () => {
    const summary = summarizeEarnings(
      [{ ...booking(), checkIn: new Date("2026-06-20T00:00:00Z") }],
      reference,
    );
    expect(summary.totalCents).toBe(10800);
    expect(summary.thisMonthCents).toBe(10800);
    expect(summary.upcoming30DaysCents).toBe(10800);
  });

  it("counts a booking from last month toward total only", () => {
    const summary = summarizeEarnings(
      [{ ...booking(), checkIn: new Date("2026-05-10T00:00:00Z") }],
      reference,
    );
    expect(summary.totalCents).toBe(10800);
    expect(summary.thisMonthCents).toBe(0);
    expect(summary.upcoming30DaysCents).toBe(0);
  });

  it("counts a booking 45 days out toward total and thisMonth-adjacent totals but not the 30-day window", () => {
    const summary = summarizeEarnings(
      [{ ...booking(), checkIn: new Date("2026-07-30T00:00:00Z") }],
      reference,
    );
    expect(summary.totalCents).toBe(10800);
    expect(summary.upcoming30DaysCents).toBe(0);
  });

  it("ignores unpaid bookings entirely", () => {
    const summary = summarizeEarnings(
      [{ ...booking({ paymentStatus: "UNPAID" }), checkIn: new Date("2026-06-20T00:00:00Z") }],
      reference,
    );
    expect(summary).toEqual({ totalCents: 0, thisMonthCents: 0, upcoming30DaysCents: 0 });
  });

  it("sums multiple bookings, commission and older service-fee ones alike", () => {
    const summary = summarizeEarnings(
      [
        { ...booking(), checkIn: new Date("2026-06-16T00:00:00Z") },
        { ...booking(), checkIn: new Date("2026-06-17T00:00:00Z") },
        { ...legacyBooking(), checkIn: new Date("2026-06-18T00:00:00Z") },
      ],
      reference,
    );
    expect(summary.totalCents).toBe(10800 + 10800 + 12000);
  });
});

describe("computeOccupancyRate", () => {
  const reference = new Date("2026-06-01T00:00:00Z");

  it("is null with no published listings", () => {
    expect(
      computeOccupancyRate({
        listings: [{ id: "l1", published: false }],
        bookings: [],
        referenceDate: reference,
      }),
    ).toBeNull();
  });

  it("is 0 with a published listing and no bookings", () => {
    expect(
      computeOccupancyRate({
        listings: [{ id: "l1", published: true }],
        bookings: [],
        referenceDate: reference,
      }),
    ).toBe(0);
  });

  it("is 100 when a single published listing is booked for the entire window", () => {
    expect(
      computeOccupancyRate({
        listings: [{ id: "l1", published: true }],
        bookings: [
          {
            listingId: "l1",
            checkIn: new Date("2026-06-01T00:00:00Z"),
            checkOut: new Date("2026-07-01T00:00:00Z"),
            status: "CONFIRMED",
          },
        ],
        referenceDate: reference,
        windowDays: 30,
      }),
    ).toBe(100);
  });

  it("ignores a cancelled booking's nights", () => {
    expect(
      computeOccupancyRate({
        listings: [{ id: "l1", published: true }],
        bookings: [
          {
            listingId: "l1",
            checkIn: new Date("2026-06-01T00:00:00Z"),
            checkOut: new Date("2026-07-01T00:00:00Z"),
            status: "CANCELLED",
          },
        ],
        referenceDate: reference,
        windowDays: 30,
      }),
    ).toBe(0);
  });

  it("excludes an unpublished listing from both numerator and denominator", () => {
    const rate = computeOccupancyRate({
      listings: [
        { id: "published", published: true },
        { id: "unpublished", published: false },
      ],
      bookings: [
        {
          listingId: "unpublished",
          checkIn: new Date("2026-06-01T00:00:00Z"),
          checkOut: new Date("2026-07-01T00:00:00Z"),
          status: "CONFIRMED",
        },
      ],
      referenceDate: reference,
      windowDays: 30,
    });
    // The unpublished listing's booking shouldn't count, and the published
    // listing (with no bookings of its own) should be fully empty.
    expect(rate).toBe(0);
  });

  it("averages across multiple published listings with partial bookings", () => {
    const rate = computeOccupancyRate({
      listings: [
        { id: "l1", published: true },
        { id: "l2", published: true },
      ],
      bookings: [
        {
          listingId: "l1",
          checkIn: new Date("2026-06-01T00:00:00Z"),
          checkOut: new Date("2026-07-01T00:00:00Z"),
          status: "CONFIRMED",
        },
      ],
      referenceDate: reference,
      windowDays: 30,
    });
    // l1 fully booked (30 nights), l2 empty -> 30 / 60 = 50%
    expect(rate).toBe(50);
  });

  it("only counts the portion of a booking that overlaps the window", () => {
    const rate = computeOccupancyRate({
      listings: [{ id: "l1", published: true }],
      bookings: [
        {
          listingId: "l1",
          // Starts 5 days before the window and ends 5 days into it.
          checkIn: new Date("2026-05-27T00:00:00Z"),
          checkOut: new Date("2026-06-06T00:00:00Z"),
          status: "COMPLETED",
        },
      ],
      referenceDate: reference,
      windowDays: 30,
    });
    // Only 5 of the 9 booked nights fall inside [Jun 1, Jul 1).
    expect(rate).toBe(Math.round((5 / 30) * 100));
  });
});

const d = (s: string) => new Date(s);
const HOST = "host-1";
const GUEST = "guest-1";

describe("computeHostResponseStats", () => {
  it("returns nulls when there are no conversations", () => {
    expect(computeHostResponseStats([])).toEqual({ responseRate: null, medianResponseMinutes: null });
  });

  it("ignores a conversation the host started themselves", () => {
    const stats = computeHostResponseStats([
      {
        hostId: HOST,
        guestId: GUEST,
        messages: [{ senderId: HOST, createdAt: d("2026-01-01T10:00:00Z") }],
      },
    ]);
    expect(stats).toEqual({ responseRate: null, medianResponseMinutes: null });
  });

  it("counts a guest-initiated conversation the host never replied to against the rate, but not the timing", () => {
    const stats = computeHostResponseStats([
      {
        hostId: HOST,
        guestId: GUEST,
        messages: [{ senderId: GUEST, createdAt: d("2026-01-01T10:00:00Z") }],
      },
    ]);
    expect(stats.responseRate).toBe(0);
    expect(stats.medianResponseMinutes).toBeNull();
  });

  it("computes a 100% rate and the exact response time for a single replied conversation", () => {
    const stats = computeHostResponseStats([
      {
        hostId: HOST,
        guestId: GUEST,
        messages: [
          { senderId: GUEST, createdAt: d("2026-01-01T10:00:00Z") },
          { senderId: HOST, createdAt: d("2026-01-01T10:30:00Z") },
        ],
      },
    ]);
    expect(stats.responseRate).toBe(100);
    expect(stats.medianResponseMinutes).toBe(30);
  });

  it("sorts unordered messages before finding the guest's first message and the host's first reply", () => {
    const stats = computeHostResponseStats([
      {
        hostId: HOST,
        guestId: GUEST,
        messages: [
          { senderId: HOST, createdAt: d("2026-01-01T11:00:00Z") },
          { senderId: GUEST, createdAt: d("2026-01-01T10:00:00Z") },
        ],
      },
    ]);
    expect(stats.responseRate).toBe(100);
    expect(stats.medianResponseMinutes).toBe(60);
  });

  it("mixes replied and unreplied conversations into one rate, timing only from the replied ones", () => {
    const stats = computeHostResponseStats([
      {
        hostId: HOST,
        guestId: GUEST,
        messages: [
          { senderId: GUEST, createdAt: d("2026-01-01T10:00:00Z") },
          { senderId: HOST, createdAt: d("2026-01-01T10:10:00Z") },
        ],
      },
      {
        hostId: HOST,
        guestId: "guest-2",
        messages: [{ senderId: "guest-2", createdAt: d("2026-01-02T10:00:00Z") }],
      },
    ]);
    expect(stats.responseRate).toBe(50);
    expect(stats.medianResponseMinutes).toBe(10);
  });

  it("computes the median across an odd number of response times", () => {
    const stats = computeHostResponseStats([
      { hostId: HOST, guestId: "g1", messages: [
        { senderId: "g1", createdAt: d("2026-01-01T10:00:00Z") },
        { senderId: HOST, createdAt: d("2026-01-01T10:10:00Z") },
      ] },
      { hostId: HOST, guestId: "g2", messages: [
        { senderId: "g2", createdAt: d("2026-01-01T10:00:00Z") },
        { senderId: HOST, createdAt: d("2026-01-01T11:00:00Z") },
      ] },
      { hostId: HOST, guestId: "g3", messages: [
        { senderId: "g3", createdAt: d("2026-01-01T10:00:00Z") },
        { senderId: HOST, createdAt: d("2026-01-01T10:20:00Z") },
      ] },
    ]);
    // Response times: 10, 60, 20 -> sorted 10, 20, 60 -> median 20
    expect(stats.medianResponseMinutes).toBe(20);
  });
});

describe("formatResponseTime", () => {
  it("buckets an hour or less as within an hour", () => {
    expect(formatResponseTime(45)).toBe("within an hour");
    expect(formatResponseTime(60)).toBe("within an hour");
  });

  it("buckets up to six hours as within a few hours", () => {
    expect(formatResponseTime(61)).toBe("within a few hours");
    expect(formatResponseTime(360)).toBe("within a few hours");
  });

  it("buckets up to a day as within a day", () => {
    expect(formatResponseTime(361)).toBe("within a day");
    expect(formatResponseTime(1440)).toBe("within a day");
  });

  it("buckets anything longer as within a few days", () => {
    expect(formatResponseTime(1441)).toBe("within a few days");
  });
});

describe("isGreatHost", () => {
  const passing = { completedBookings: 5, averageRating: 4.8, responseRate: 90 };

  it("is true when every threshold is met exactly", () => {
    expect(isGreatHost(passing)).toBe(true);
  });

  it("is false with too few completed bookings", () => {
    expect(isGreatHost({ ...passing, completedBookings: 4 })).toBe(false);
  });

  it("is false with a rating below the bar", () => {
    expect(isGreatHost({ ...passing, averageRating: 4.79 })).toBe(false);
  });

  it("is false with no rating at all", () => {
    expect(isGreatHost({ ...passing, averageRating: null })).toBe(false);
  });

  it("is false with a response rate below the bar", () => {
    expect(isGreatHost({ ...passing, responseRate: 89 })).toBe(false);
  });

  it("is false with no response rate at all", () => {
    expect(isGreatHost({ ...passing, responseRate: null })).toBe(false);
  });

  it("is true comfortably above every threshold", () => {
    expect(isGreatHost({ completedBookings: 50, averageRating: 5, responseRate: 100 })).toBe(true);
  });
});
