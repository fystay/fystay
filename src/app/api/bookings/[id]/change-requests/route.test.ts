import { beforeEach, describe, expect, it, vi } from "vitest";

const { state, mocks } = vi.hoisted(() => ({
  state: {
    // Requests on the booking still awaiting the host or the guest's payment,
    // as the first read sees them and as the locked re-check sees them.
    outstandingAtRead: 0,
    outstandingUnderLock: 0,
    log: [] as string[],
  },
  mocks: { create: vi.fn() },
}));

vi.mock("@/auth", () => ({ auth: async () => ({ user: { id: "guest_1" } }) }));
vi.mock("@/lib/availabilityLock", () => ({
  withListingAvailabilityLock: async (db: unknown, listingId: string, fn: (tx: unknown) => Promise<unknown>) => {
    state.log.push(`lock:${listingId}`);
    const result = await fn(db);
    state.log.push(`unlock:${listingId}`);
    return result;
  },
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    booking: {
      findUnique: async () => ({
        id: "bk_1",
        guestId: "guest_1",
        listingId: "listing_1",
        status: "CONFIRMED",
        checkIn: new Date("2027-03-01"),
        checkOut: new Date("2027-03-04"),
        guests: 2,
        roomsBooked: 1,
        roomType: null,
        nightlyPriceCents: 10_000,
        cleaningFeeCents: 0,
        lastMinuteDiscountPercent: null,
        totalPriceCents: 33_000,
        creditAppliedCents: 0,
        promoDiscountCents: 0,
        listing: {
          maxGuests: 4,
          minNights: 1,
          maxNights: null,
          weeklyDiscountPercent: null,
          monthlyDiscountPercent: null,
          bookings: [],
          availabilityBlocks: [],
        },
        changeRequests: Array.from({ length: state.outstandingAtRead }, (_, i) => ({ id: `cr_${i}` })),
      }),
    },
    bookingChangeRequest: {
      count: async () => state.outstandingUnderLock,
      create: async (args: { data: Record<string, unknown> }) => {
        mocks.create(args);
        return { id: "cr_new", ...args.data };
      },
    },
  },
}));

import { POST } from "./route";

const ask = () =>
  POST(
    new Request("http://x", {
      method: "POST",
      body: JSON.stringify({ checkIn: "2027-03-01", checkOut: "2027-03-05", guests: 2 }),
    }),
    { params: Promise.resolve({ id: "bk_1" }) },
  );

beforeEach(() => {
  mocks.create.mockReset();
  state.outstandingAtRead = 0;
  state.outstandingUnderLock = 0;
  state.log = [];
});

describe("asking for a date change", () => {
  it("creates the request under the listing's lock", async () => {
    expect((await ask()).status).toBe(201);
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(state.log).toEqual(["lock:listing_1", "unlock:listing_1"]);
  });

  it("refuses while another change is awaiting the host or the guest's payment", async () => {
    state.outstandingAtRead = 1;
    const response = await ask();
    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/already has a date change in progress/);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("refuses when a request sent at the same moment was created first", async () => {
    state.outstandingUnderLock = 1;
    expect((await ask()).status).toBe(409);
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
