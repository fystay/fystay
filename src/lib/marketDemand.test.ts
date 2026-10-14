import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { loadMarketDemand, summariseMarketDemand, type DemandBooking } from "./marketDemand";

const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
const TODAY = day("2026-10-14");
const STAY = { checkIn: day("2026-10-20"), checkOut: day("2026-10-23"), today: TODAY };
const booking = (checkIn: string, checkOut: string, createdAt: string): DemandBooking => ({ checkIn: day(checkIn), checkOut: day(checkOut), createdAt: day(createdAt) });

describe("summariseMarketDemand", () => {
  it("measures the stay's dates as a share of the town's listing-nights", () => {
    const bookings = Array.from({ length: 6 }, () => booking("2026-10-19", "2026-10-25", "2026-10-01"));
    const m = summariseMarketDemand({ town: "Blackpool", activeListings: 10, bookings, ...STAY });
    expect(m.forwardShare).toBeCloseTo(18 / 30);
  });

  it("compares with how much was usually booked this far ahead, not how much was booked in the end", () => {
    // A 10-night stay booked 30 days ahead, and a 3-night stay booked the day before.
    const bookings = [booking("2026-08-01", "2026-08-11", "2026-07-02"), booking("2026-09-01", "2026-09-04", "2026-08-31")];
    const m = summariseMarketDemand({ town: "Blackpool", activeListings: 5, bookings, ...STAY });
    // 6 days ahead, only the first stay's 10 nights had been booked.
    expect(m.paceShare).toBeCloseTo(10 / (5 * 180));
    expect(m.bookingsLast180Days).toBe(2);
  });

  it("has no seasonality without a year of history, and reads it when there is one", () => {
    const recent = summariseMarketDemand({ town: "T", activeListings: 2, bookings: [booking("2026-09-01", "2026-09-03", "2026-08-01")], ...STAY });
    expect(recent.historyDays).toBeLessThan(365);
    // October last year twice as busy as the year's average.
    const bookings = [booking("2025-10-01", "2025-10-11", "2025-09-01"), booking("2026-03-01", "2026-03-04", "2026-02-01")];
    const m = summariseMarketDemand({ town: "T", activeListings: 1, bookings, ...STAY });
    expect(m.historyDays).toBeGreaterThanOrEqual(365);
    expect(m.seasonSampleBookings).toBe(1);
    expect(m.seasonalIndex).toBeGreaterThan(1);
  });

  it("is all zero for a town with no listings", () => {
    const m = summariseMarketDemand({ town: "T", activeListings: 0, bookings: [], ...STAY });
    expect(m).toMatchObject({ forwardShare: 0, paceShare: null, seasonalIndex: null, bookingsLast180Days: 0 });
  });
});

describe("loadMarketDemand", () => {
  it("counts only paid single-unit bookings - never blocks, calendar imports, pending or cancelled stays", async () => {
    const findMany = vi.fn(async () => []);
    const count = vi.fn(async () => 7);
    const db = { booking: { findMany }, listing: { count } } as unknown as PrismaClient;
    const m = await loadMarketDemand(db, " Blackpool ", STAY);
    expect(m).toMatchObject({ town: "Blackpool", activeListings: 7 });
    const where = (findMany.mock.calls[0] as unknown as [{ where: Record<string, unknown> }])[0].where;
    expect(where).toMatchObject({ roomTypeId: null, status: { in: ["CONFIRMED", "COMPLETED"] }, listing: { city: { equals: "Blackpool", mode: "insensitive" } } });
    expect(count).toHaveBeenCalledWith({ where: expect.objectContaining({ published: true, suspendedAt: null }) });
    expect(await loadMarketDemand(db, "  ", STAY)).toBeNull();
  });
});
