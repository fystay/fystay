import { describe, expect, it } from "vitest";
import {
  bestPastMonth,
  earningsPeriod,
  findCalendarConflicts,
  highlights,
  listingHealth,
  monthlyEarnings,
  monthRange,
  occupancy,
  summarizePeriod,
  todayView,
  ukToday,
  type CalendarBlock,
  type InsightBooking,
  type InsightListing,
} from "./hostInsights";

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const today = d("2026-10-15");

let n = 0;
// A £100/night stay with a £20 cleaning fee and FYStay's 10% service fee on
// top: the guest pays nights×100 + 20 + 10%, the host gets nights×100 + 20.
function stay(checkIn: string, nights: number, over: Partial<InsightBooking> = {}): InsightBooking {
  const stayCents = nights * 10_000;
  const service = Math.round(stayCents * 0.1);
  return {
    id: `b${++n}`,
    reference: `FY-${n}`,
    listingId: "l1",
    status: "CONFIRMED",
    approvalStatus: "NONE",
    paymentStatus: "PAID",
    paidAt: d("2026-09-01"),
    checkIn: d(checkIn),
    checkOut: new Date(d(checkIn).getTime() + nights * 86_400_000),
    nights,
    guests: 2,
    guestName: "Guest",
    nightlyPriceCents: 10_000,
    lengthOfStayDiscountCents: 0,
    roomsBooked: 1,
    createdAt: d("2026-09-01"),
    totalPriceCents: stayCents + 2_000 + service,
    serviceFeeCents: service,
    taxCents: 0,
    creditAppliedCents: 0,
    promoDiscountCents: 0,
    refundedAmountCents: null,
    ...over,
  };
}

const home: InsightListing = { id: "l1", title: "Flat", published: true, suspendedAt: null, units: 1 };

describe("ukToday", () => {
  it("uses the UK date, not the server's", () => {
    // 23:30 UTC on 14 Oct is already 00:30 on 15 Oct in London (BST).
    expect(ukToday(new Date("2026-10-14T23:30:00Z"))).toEqual(d("2026-10-15"));
    // In winter the UK is on UTC.
    expect(ukToday(new Date("2026-12-14T23:30:00Z"))).toEqual(d("2026-12-14"));
  });
});

describe("summarizePeriod", () => {
  const { start, end } = monthRange(today);

  it("counts completed stays (the old dashboard dropped them) and splits hosted from upcoming", () => {
    const s = summarizePeriod(
      [stay("2026-10-02", 3, { status: "COMPLETED" }), stay("2026-10-20", 2)],
      start,
      end,
      today,
    );
    expect(s.earnedCents).toBe(32_000 + 22_000);
    expect(s.hostedCents).toBe(32_000);
    expect(s.upcomingCents).toBe(22_000);
    expect(s.bookings).toBe(2);
    expect(s.nights).toBe(5);
    expect(s.averageNightlyCents).toBe(10_000);
    expect(s.averageBookingCents).toBe(27_000);
  });

  it("explains the money: guest paid = host share + FYStay fee + refunds", () => {
    const s = summarizePeriod([stay("2026-10-02", 3)], start, end, today);
    expect(s.guestPaidCents).toBe(35_000);
    expect(s.fystayFeeCents).toBe(3_000);
    expect(s.guestPaidCents - s.fystayFeeCents - s.refundedCents).toBe(s.earnedCents);
  });

  it("keeps the host's share of a part-refunded cancellation, without counting it as a stay", () => {
    const cancelled = stay("2026-10-20", 3, {
      status: "CANCELLED",
      paymentStatus: "PARTIALLY_REFUNDED",
      refundedAmountCents: 17_500,
    });
    const s = summarizePeriod([stay("2026-10-02", 3), cancelled], start, end, today);
    expect(s.earnedCents).toBe(32_000 + 16_000);
    expect(s.bookings).toBe(1);
    expect(s.cancellationRate).toBe(50);
    expect(s.guestPaidCents - s.fystayFeeCents - s.refundedCents).toBe(s.earnedCents);
  });

  it("ignores unpaid reservations and other months", () => {
    const s = summarizePeriod(
      [stay("2026-10-05", 2, { paidAt: null, paymentStatus: "UNPAID", status: "PENDING" }), stay("2026-11-01", 2)],
      start,
      end,
      today,
    );
    expect(s.earnedCents).toBe(0);
    expect(s.averageNightlyCents).toBeNull();
    expect(s.cancellationRate).toBeNull();
  });
});

describe("occupancy", () => {
  it("counts nights inside the window only, against every open unit-night", () => {
    const { start, end } = monthRange(today); // 31 nights
    const o = occupancy([home], [stay("2026-09-29", 4), stay("2026-10-30", 5)], start, end);
    expect(o.bookedNights).toBe(2 + 2);
    expect(o.availableNights).toBe(31);
    expect(o.rate).toBe(13);
  });

  it("counts hotel rooms as units", () => {
    const { start, end } = monthRange(today);
    const hotel = { ...home, units: 10 };
    const o = occupancy([hotel], [stay("2026-10-01", 31, { roomsBooked: 5 })], start, end);
    expect(o.rate).toBe(50);
  });

  it("is null, not 0%, when nothing is open for booking", () => {
    const { start, end } = monthRange(today);
    expect(occupancy([{ ...home, published: false }], [], start, end).rate).toBeNull();
  });
});

describe("todayView", () => {
  it("finds arrivals, departures and who's staying tonight", () => {
    const arriving = stay("2026-10-15", 2);
    const leaving = stay("2026-10-12", 3, { listingId: "l2" });
    const staying = stay("2026-10-14", 3, { listingId: "l3" });
    const cancelled = stay("2026-10-15", 2, { status: "CANCELLED" });
    const listings = ["l1", "l2", "l3", "l4"].map((id) => ({ ...home, id }));
    const t = todayView(listings, [arriving, leaving, staying, cancelled], today);
    expect(t.arrivals.map((b) => b.id)).toEqual([arriving.id]);
    expect(t.departures.map((b) => b.id)).toEqual([leaving.id]);
    expect(t.inHouse.map((b) => b.id).sort()).toEqual([arriving.id, staying.id].sort());
    expect(t.occupiedTonight).toBe(2);
    expect(t.bookableListings).toBe(4);
  });
});

describe("best month and highlights", () => {
  const history = [stay("2026-08-03", 5), stay("2026-09-03", 2), stay("2026-10-03", 4)];

  it("finds the best past month and a 12-month series", () => {
    expect(bestPastMonth(history, today)).toEqual({ start: d("2026-08-01"), earnedCents: 52_000 });
    const series = monthlyEarnings(history, today, 3);
    expect(series.map((p) => p.earnedCents)).toEqual([52_000, 22_000, 42_000]);
  });

  it("only says true, positive things", () => {
    const { start, end } = monthRange(today);
    const thisMonth = summarizePeriod(history, start, end, today);
    const h = highlights({
      thisMonth,
      lastMonthCents: 22_000,
      best: bestPastMonth(history, today),
      occupancyNow: 13,
      occupancyLastMonth: 7,
      averageRating: 4.9,
      reviewCount: 12,
      upcomingStays: 0,
      formatMoney: (c) => `£${c / 100}`,
    });
    expect(h.map((x) => x.text)).toEqual([
      "You're £100 away from your best month.",
      "Earnings are up 91% on last month.",
      "Guests rate you 4.9★ across 12 reviews.",
    ]);
  });

  it("stays quiet with no history rather than inventing praise", () => {
    const { start, end } = monthRange(today);
    const h = highlights({
      thisMonth: summarizePeriod([], start, end, today),
      lastMonthCents: 0,
      best: null,
      occupancyNow: null,
      occupancyLastMonth: null,
      averageRating: null,
      reviewCount: 0,
      upcomingStays: 0,
      formatMoney: String,
    });
    expect(h).toEqual([]);
  });
});

describe("listingHealth", () => {
  it("scores a bare listing low and a complete one 100", () => {
    const bare = {
      id: "l1",
      description: "Nice flat.",
      photos: ["a"],
      amenities: [],
      address: null,
      checkInTime: null,
      checkInInstructions: null,
      quietHoursStart: null,
      additionalRules: null,
      weeklyDiscountPercent: null,
      cleaningFeeCents: 0,
    };
    // The basics are done the moment a listing exists; everything else isn't.
    expect(listingHealth(bare).score).toBe(13);
    expect(listingHealth({ ...bare, photos: [] }).score).toBe(0);
    const full = {
      ...bare,
      description: "x".repeat(250),
      photos: ["1", "2", "3", "4", "5"],
      amenities: ["a", "b", "c", "d", "e", "f"],
      address: "1 Promenade",
      checkInTime: "3pm",
      checkInInstructions: "Key safe by the door",
      additionalRules: "No smoking",
      weeklyDiscountPercent: 10,
    };
    expect(listingHealth(full).score).toBe(100);
  });
});

describe("earningsPeriod", () => {
  it("covers today, Monday-start weeks, months and years", () => {
    // 15 Oct 2026 is a Thursday.
    expect(earningsPeriod("today", today)).toMatchObject({ start: d("2026-10-15"), end: d("2026-10-16") });
    expect(earningsPeriod("week", today)).toMatchObject({ start: d("2026-10-12"), end: d("2026-10-19") });
    expect(earningsPeriod("month", today)).toMatchObject({ label: "October", start: d("2026-10-01"), end: d("2026-11-01") });
    expect(earningsPeriod("last-month", today)).toMatchObject({ label: "September", start: d("2026-09-01") });
    expect(earningsPeriod("year", today).previous).toMatchObject({ start: d("2025-01-01"), end: d("2026-01-01") });
  });

  it("takes a custom range inclusive of both dates, and rejects nonsense", () => {
    expect(earningsPeriod("custom", today, d("2026-07-01"), d("2026-07-31"))).toMatchObject({
      start: d("2026-07-01"),
      end: d("2026-08-01"),
      previous: null,
    });
    expect(earningsPeriod("custom", today, d("2026-07-31"), d("2026-07-01")).key).toBe("month");
    expect(earningsPeriod("custom", today, d("2010-01-01"), d("2026-07-01")).key).toBe("month");
    expect(earningsPeriod("whatever", today).key).toBe("month");
  });
});

describe("findCalendarConflicts", () => {
  const block = (over: Partial<CalendarBlock>): CalendarBlock => ({
    id: "blk",
    listingId: "l1",
    roomTypeId: null,
    startDate: d("2026-10-20"),
    endDate: d("2026-10-22"),
    source: "ICAL_IMPORT",
    ...over,
  });

  it("flags a stay overlapping dates imported from another site", () => {
    const c = findCalendarConflicts([home], [stay("2026-10-21", 3)], [block({})]);
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ from: d("2026-10-21"), to: d("2026-10-22") });
  });

  it("ignores back-to-back dates, the host's own blocks, cancelled stays and hotels", () => {
    expect(findCalendarConflicts([home], [stay("2026-10-22", 2)], [block({})])).toEqual([]);
    expect(findCalendarConflicts([home], [stay("2026-10-21", 2)], [block({ source: "HOST" })])).toEqual([]);
    expect(findCalendarConflicts([home], [stay("2026-10-21", 2, { status: "CANCELLED" })], [block({})])).toEqual([]);
    expect(findCalendarConflicts([{ ...home, units: 8 }], [stay("2026-10-21", 2)], [block({})])).toEqual([]);
  });
});
