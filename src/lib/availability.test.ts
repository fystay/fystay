import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import {
  isBookingHoldActive,
  blockingBookingWhere,
  blockingRanges,
  blocksForRoomType,
  isRequestedRangeStillAvailable,
  isRangeAvailable,
  isRoomTypeRangeAvailable,
  nightsBetween,
  PENDING_BOOKING_HOLD_MINUTES,
  rangesOverlap,
  REQUEST_HOLD_HOURS,
  stayLengthError,
} from "./availability";

const d = (s: string) => new Date(s);

describe("rangesOverlap", () => {
  it("detects overlapping ranges", () => {
    expect(rangesOverlap(d("2026-01-01"), d("2026-01-05"), d("2026-01-03"), d("2026-01-08"))).toBe(
      true,
    );
  });

  it("treats back-to-back ranges as non-overlapping (checkout day == checkin day)", () => {
    expect(rangesOverlap(d("2026-01-01"), d("2026-01-05"), d("2026-01-05"), d("2026-01-08"))).toBe(
      false,
    );
  });

  it("detects one range fully containing another", () => {
    expect(rangesOverlap(d("2026-01-01"), d("2026-01-10"), d("2026-01-03"), d("2026-01-05"))).toBe(
      true,
    );
  });

  it("returns false for entirely separate ranges", () => {
    expect(rangesOverlap(d("2026-01-01"), d("2026-01-05"), d("2026-02-01"), d("2026-02-05"))).toBe(
      false,
    );
  });
});

describe("isRangeAvailable", () => {
  const booked = [{ checkIn: d("2026-06-10"), checkOut: d("2026-06-15") }];

  it("rejects a zero-night request (checkOut === checkIn)", () => {
    expect(isRangeAvailable(d("2026-06-01"), d("2026-06-01"), [])).toBe(false);
  });

  it("rejects an inverted range (checkOut before checkIn)", () => {
    expect(isRangeAvailable(d("2026-06-05"), d("2026-06-01"), [])).toBe(false);
  });

  it("allows a range with no bookings", () => {
    expect(isRangeAvailable(d("2026-06-01"), d("2026-06-05"), [])).toBe(true);
  });

  it("rejects a range overlapping an existing booking", () => {
    expect(isRangeAvailable(d("2026-06-12"), d("2026-06-18"), booked)).toBe(false);
  });

  it("allows a new booking starting exactly on an existing booking's checkout day", () => {
    expect(isRangeAvailable(d("2026-06-15"), d("2026-06-20"), booked)).toBe(true);
  });

  it("allows a new booking ending exactly on an existing booking's checkin day", () => {
    expect(isRangeAvailable(d("2026-06-05"), d("2026-06-10"), booked)).toBe(true);
  });
});

describe("isRoomTypeRangeAvailable", () => {
  it("reduces to isRangeAvailable's behavior at totalRooms = 1 with roomsBooked = 1", () => {
    const booked = [{ checkIn: d("2026-06-10"), checkOut: d("2026-06-15"), roomsBooked: 1 }];
    expect(isRoomTypeRangeAvailable(d("2026-06-12"), d("2026-06-18"), 1, 1, booked)).toBe(false);
    expect(isRoomTypeRangeAvailable(d("2026-06-15"), d("2026-06-20"), 1, 1, booked)).toBe(true);
  });

  it("admits a request that exactly fills remaining capacity", () => {
    const booked = [{ checkIn: d("2026-06-10"), checkOut: d("2026-06-15"), roomsBooked: 3 }];
    expect(isRoomTypeRangeAvailable(d("2026-06-11"), d("2026-06-13"), 2, 5, booked)).toBe(true);
  });

  it("rejects a request that would push occupancy one over capacity", () => {
    const booked = [{ checkIn: d("2026-06-10"), checkOut: d("2026-06-15"), roomsBooked: 3 }];
    expect(isRoomTypeRangeAvailable(d("2026-06-11"), d("2026-06-13"), 3, 5, booked)).toBe(false);
  });

  it("sums multiple overlapping bookings' roomsBooked for the same nights", () => {
    const booked = [
      { checkIn: d("2026-06-01"), checkOut: d("2026-06-05"), roomsBooked: 2 },
      { checkIn: d("2026-06-03"), checkOut: d("2026-06-08"), roomsBooked: 2 },
    ];
    // Nights 06-03/06-04 have 2+2=4 occupied out of 5 total - only 1 left.
    expect(isRoomTypeRangeAvailable(d("2026-06-03"), d("2026-06-05"), 1, 5, booked)).toBe(true);
    expect(isRoomTypeRangeAvailable(d("2026-06-03"), d("2026-06-05"), 2, 5, booked)).toBe(false);
  });

  it("treats non-overlapping stays as independent of each other's occupancy", () => {
    const booked = [{ checkIn: d("2026-06-01"), checkOut: d("2026-06-05"), roomsBooked: 5 }];
    expect(isRoomTypeRangeAvailable(d("2026-06-05"), d("2026-06-10"), 5, 5, booked)).toBe(true);
  });

  it("rejects requestedRooms of 0 or more than totalRooms outright", () => {
    expect(isRoomTypeRangeAvailable(d("2026-06-01"), d("2026-06-05"), 0, 5, [])).toBe(false);
    expect(isRoomTypeRangeAvailable(d("2026-06-01"), d("2026-06-05"), 6, 5, [])).toBe(false);
  });

  it("a block closes the room type entirely for its range regardless of remaining count", () => {
    const blocks = [{ startDate: d("2026-07-01"), endDate: d("2026-07-05") }];
    expect(isRoomTypeRangeAvailable(d("2026-07-02"), d("2026-07-03"), 1, 10, [], blocks)).toBe(
      false,
    );
  });

  it("rejects a zero-night or inverted range", () => {
    expect(isRoomTypeRangeAvailable(d("2026-06-01"), d("2026-06-01"), 1, 5, [])).toBe(false);
    expect(isRoomTypeRangeAvailable(d("2026-06-05"), d("2026-06-01"), 1, 5, [])).toBe(false);
  });
});

describe("blockingBookingWhere", () => {
  it("always blocks on CONFIRMED status regardless of age", () => {
    const where = blockingBookingWhere(d("2026-06-01"));
    expect(where.OR).toContainEqual({ status: "CONFIRMED" });
  });

  it("sets the instant-book PENDING cutoff to exactly the hold window before `now`", () => {
    const now = d("2026-06-01T12:00:00Z");
    const where = blockingBookingWhere(now);
    const pendingClause = where.OR.find(
      (clause) => clause.status === "PENDING" && clause.approvalStatus === "NONE",
    );
    expect(pendingClause?.createdAt.gte.toISOString()).toBe(
      new Date(now.getTime() - PENDING_BOOKING_HOLD_MINUTES * 60_000).toISOString(),
    );
  });

  it("holds an AWAITING request's dates for the much longer REQUEST_HOLD_HOURS from creation", () => {
    const now = d("2026-06-01T12:00:00Z");
    const where = blockingBookingWhere(now);
    const awaitingClause = where.OR.find(
      (clause) => clause.status === "PENDING" && clause.approvalStatus === "AWAITING",
    );
    expect(awaitingClause?.createdAt.gte.toISOString()).toBe(
      new Date(now.getTime() - REQUEST_HOLD_HOURS * 60 * 60_000).toISOString(),
    );
  });

  it("holds an APPROVED request from the moment of approval, not the original request", () => {
    const now = d("2026-06-01T12:00:00Z");
    const where = blockingBookingWhere(now);
    const approvedClause = where.OR.find(
      (clause) => clause.status === "PENDING" && clause.approvalStatus === "APPROVED",
    );
    expect(approvedClause?.hostRespondedAt.gte.toISOString()).toBe(
      new Date(now.getTime() - PENDING_BOOKING_HOLD_MINUTES * 60_000).toISOString(),
    );
  });
});

describe("blockingRanges", () => {
  it("returns just the bookings when there are no blocks", () => {
    const bookings = [{ checkIn: d("2026-06-10"), checkOut: d("2026-06-15") }];
    expect(blockingRanges(bookings)).toEqual(bookings);
  });

  it("normalizes blocks' startDate/endDate into checkIn/checkOut and merges them with bookings", () => {
    const bookings = [{ checkIn: d("2026-06-10"), checkOut: d("2026-06-15") }];
    const blocks = [{ startDate: d("2026-07-01"), endDate: d("2026-07-03") }];
    expect(blockingRanges(bookings, blocks)).toEqual([
      { checkIn: d("2026-06-10"), checkOut: d("2026-06-15") },
      { checkIn: d("2026-07-01"), checkOut: d("2026-07-03") },
    ]);
  });

  it("a merged block range rejects an overlapping booking attempt via isRangeAvailable", () => {
    const merged = blockingRanges([], [{ startDate: d("2026-08-01"), endDate: d("2026-08-05") }]);
    expect(isRangeAvailable(d("2026-08-03"), d("2026-08-07"), merged)).toBe(false);
  });
});

describe("nightsBetween", () => {
  it("counts calendar nights between two dates", () => {
    expect(nightsBetween(d("2026-06-01"), d("2026-06-05"))).toBe(4);
  });

  it("returns 0 rather than negative for an inverted range", () => {
    expect(nightsBetween(d("2026-06-05"), d("2026-06-01"))).toBe(0);
  });

  it("returns 0 for a same-day range", () => {
    expect(nightsBetween(d("2026-06-01"), d("2026-06-01"))).toBe(0);
  });
});

describe("stayLengthError", () => {
  it("returns null when there's no minimum or maximum", () => {
    expect(stayLengthError(1, { minNights: 1, maxNights: null })).toBeNull();
  });

  it("rejects a stay shorter than the minimum", () => {
    expect(stayLengthError(2, { minNights: 3, maxNights: null })).toBe(
      "This listing requires a minimum stay of 3 nights",
    );
  });

  it("singularizes the minimum-nights message", () => {
    expect(stayLengthError(0, { minNights: 1, maxNights: null })).toBe(
      "This listing requires a minimum stay of 1 night",
    );
  });

  it("rejects a stay longer than the maximum", () => {
    expect(stayLengthError(10, { minNights: 1, maxNights: 7 })).toBe(
      "This listing allows a maximum stay of 7 nights",
    );
  });

  it("allows a stay exactly at the minimum or maximum boundary", () => {
    expect(stayLengthError(3, { minNights: 3, maxNights: 7 })).toBeNull();
    expect(stayLengthError(7, { minNights: 3, maxNights: 7 })).toBeNull();
  });

  it("checks the minimum before the maximum when both are violated (impossible in practice, but minimum wins)", () => {
    expect(stayLengthError(1, { minNights: 3, maxNights: 2 })).toBe(
      "This listing requires a minimum stay of 3 nights",
    );
  });
});

describe("isBookingHoldActive", () => {
  const now = new Date("2026-10-01T12:00:00Z");
  const minutesAgo = (m: number) => new Date(now.getTime() - m * 60 * 1000);

  it("holds an instant-book booking for the hold window from creation, then lets it lapse", () => {
    const base = { status: "PENDING", approvalStatus: "NONE", hostRespondedAt: null };
    expect(isBookingHoldActive({ ...base, createdAt: minutesAgo(10) }, now)).toBe(true);
    expect(isBookingHoldActive({ ...base, createdAt: minutesAgo(PENDING_BOOKING_HOLD_MINUTES + 1) }, now)).toBe(false);
  });

  it("times an approved request's hold from the host's approval", () => {
    const base = { status: "PENDING", approvalStatus: "APPROVED", createdAt: minutesAgo(600) };
    expect(isBookingHoldActive({ ...base, hostRespondedAt: minutesAgo(5) }, now)).toBe(true);
    expect(isBookingHoldActive({ ...base, hostRespondedAt: minutesAgo(PENDING_BOOKING_HOLD_MINUTES + 1) }, now)).toBe(false);
  });

  it("never treats a cancelled booking as holding dates", () => {
    expect(
      isBookingHoldActive({ status: "CANCELLED", approvalStatus: "NONE", createdAt: now, hostRespondedAt: null }, now),
    ).toBe(false);
  });
});

describe("blocksForRoomType", () => {
  const icalBlock = { startDate: d("2026-07-10"), endDate: d("2026-07-12"), roomTypeId: null };
  const otherRoomBlock = { startDate: d("2026-07-20"), endDate: d("2026-07-22"), roomTypeId: "rt_other" };

  it("closes a room type for a listing-wide block (an iCal import has no room type)", () => {
    const noOwnBlocks: { startDate: Date; endDate: Date }[] = [];
    const blocks = blocksForRoomType(noOwnBlocks, [icalBlock, otherRoomBlock]);
    expect(blocks).toEqual([icalBlock]);
    expect(isRoomTypeRangeAvailable(d("2026-07-11"), d("2026-07-13"), 1, 5, [], blocks)).toBe(false);
  });

  it("keeps the room type's own blocks and ignores other room types' blocks", () => {
    const own = { startDate: d("2026-08-01"), endDate: d("2026-08-02") };
    expect(blocksForRoomType([own], [otherRoomBlock])).toEqual([own]);
  });
});

describe("isRequestedRangeStillAvailable", () => {
  it("checks a hotel booking against listing-wide blocks as well as its room type's own", async () => {
    const blockFindMany = vi.fn(async () => [{ startDate: d("2026-07-10"), endDate: d("2026-07-12") }]);
    const db = {
      booking: { findMany: async () => [] },
      availabilityBlock: { findMany: blockFindMany },
      roomType: { findUnique: async () => ({ totalRooms: 5 }) },
    } as unknown as Prisma.TransactionClient;
    const available = await isRequestedRangeStillAvailable(db, {
      listingId: "l1",
      roomTypeId: "rt1",
      roomsBooked: 1,
      excludeBookingId: "b1",
      checkIn: d("2026-07-11"),
      checkOut: d("2026-07-13"),
    });
    expect(available).toBe(false);
    expect(blockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { OR: [{ roomTypeId: "rt1" }, { listingId: "l1", roomTypeId: null }] } }),
    );
  });

  it("counts only paid stays when confirming a payment, so an unpaid hold can't beat it", async () => {
    const bookingFindMany = vi.fn(async (_args: { where: Record<string, unknown> }) => []);
    const db = {
      booking: { findMany: bookingFindMany },
      availabilityBlock: { findMany: async () => [] },
    } as unknown as Prisma.TransactionClient;
    const range = { listingId: "l1", roomTypeId: null, roomsBooked: 1, excludeBookingId: "b1", checkIn: d("2026-07-11"), checkOut: d("2026-07-13") };

    await isRequestedRangeStillAvailable(db, { ...range, paidOnly: true });
    expect(bookingFindMany.mock.calls[0][0].where).toMatchObject({ status: "CONFIRMED" });
    expect(bookingFindMany.mock.calls[0][0].where).not.toHaveProperty("OR");

    await isRequestedRangeStillAvailable(db, range);
    expect(bookingFindMany.mock.calls[1][0].where).toHaveProperty("OR");
  });
});
