import { beforeEach, describe, expect, it, vi } from "vitest";

const { state, mocks } = vi.hoisted(() => ({
  state: {
    // Requests on the booking still awaiting the host or the guest's payment,
    // as the first read sees them and as the locked re-check sees them.
    outstandingAtRead: 0,
    outstandingUnderLock: 0,
    log: [] as string[],
    // The booking's FYStay-funded discounts (see isRefundChangeOnDiscountedBooking).
    promoDiscountCents: 0,
    creditAppliedCents: 0,
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
        // 3 nights at £100 on the commission model: £300 before discounts,
        // £30 commission, nothing on top for the guest.
        nightlyPriceCents: 10_000,
        weekendNightlyPriceCents: null,
        cleaningFeeCents: 0,
        serviceFeeCents: 0,
        hostCommissionCents: 3_000,
        taxCents: 0,
        lastMinuteDiscountPercent: null,
        totalPriceCents: 30_000 - state.promoDiscountCents - state.creditAppliedCents,
        creditAppliedCents: state.creditAppliedCents,
        promoDiscountCents: state.promoDiscountCents,
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

const ask = (checkOut = "2027-03-05", checkIn = "2027-03-01") =>
  POST(
    new Request("http://x", {
      method: "POST",
      body: JSON.stringify({ checkIn, checkOut, guests: 2 }),
    }),
    { params: Promise.resolve({ id: "bk_1" }) },
  );

beforeEach(() => {
  mocks.create.mockReset();
  state.outstandingAtRead = 0;
  state.outstandingUnderLock = 0;
  state.log = [];
  state.promoDiscountCents = 0;
  state.creditAppliedCents = 0;
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

describe("discounted bookings: no shorter or cheaper stay (launch rule)", () => {
  const shorter = () => ask("2027-03-03"); // 3 nights -> 2

  it("refuses to shorten a promo booking, explains why and offers cancelling instead", async () => {
    state.promoDiscountCents = 2_000;
    const response = await shorter();
    expect(response.status).toBe(409);
    const { error } = await response.json();
    expect(error).toMatch(/promo code or referral credit/);
    expect(error).toMatch(/cancel it under its cancellation policy/);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("refuses to shorten a referral-credit booking", async () => {
    state.creditAppliedCents = 1_500;
    expect((await shorter()).status).toBe(409);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("refuses a shortening to a single night on a promo and credit booking", async () => {
    state.promoDiscountCents = 2_000;
    state.creditAppliedCents = 500;
    // The one-penny and cheaper-nights boundaries are covered on the rule
    // itself in changeRequests.test.ts.
    expect((await ask("2027-03-02")).status).toBe(409);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("still lets a promo booking move to a longer stay - the extra is a separate, undiscounted payment", async () => {
    state.promoDiscountCents = 2_000;
    const response = await ask("2027-03-05");
    expect(response.status).toBe(201);
    expect(mocks.create.mock.calls[0][0].data.priceDeltaCents).toBe(10_000);
  });

  it("still lets a promo booking move to other dates of the same length", async () => {
    state.promoDiscountCents = 2_000;
    const response = await ask("2027-03-11", "2027-03-08");
    expect(response.status).toBe(201);
    expect(mocks.create.mock.calls[0][0].data.priceDeltaCents).toBe(0);
  });

  it("still lets a booking without a discount be shortened, with the refund it's due", async () => {
    const response = await shorter();
    expect(response.status).toBe(201);
    expect(mocks.create.mock.calls[0][0].data.priceDeltaCents).toBe(-10_000);
  });

  it("refuses every repeat of a blocked request, never creating one", async () => {
    state.promoDiscountCents = 2_000;
    for (let i = 0; i < 3; i++) expect((await shorter()).status).toBe(409);
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
