import { beforeEach, describe, expect, it, vi } from "vitest";

const { state, mocks } = vi.hoisted(() => ({
  state: {
    log: [] as string[],
    listingBookings: [] as { checkIn: Date; checkOut: Date }[],
    listingBlocks: [] as { startDate: Date; endDate: Date; roomTypeId: string | null }[],
    creditBalanceCents: 0,
    // How many times the conditional credit write should lose a race.
    creditRacesToLose: 0,
    promoRacesToLose: 0,
    listingOverrides: {} as Record<string, unknown>,
  },
  mocks: { bookingCreate: vi.fn() },
}));

vi.mock("@/auth", () => ({ auth: async () => ({ user: { id: "guest_1" } }) }));
vi.mock("@/lib/rateLimit", () => ({
  checkRateLimit: async () => ({ allowed: true }),
  rateLimitedResponse: vi.fn(),
}));
vi.mock("@/lib/notificationEmails", () => ({ sendBookingRequestReceivedEmail: vi.fn() }));
vi.mock("@/lib/stripeConnect", () => ({
  HOST_NOT_PAYMENT_READY_MESSAGE: "host not ready",
  hostAcceptsPaidBookings: () => true,
}));
vi.mock("@/lib/availabilityLock", () => ({
  withListingAvailabilityLock: async (db: unknown, listingId: string, fn: (tx: unknown) => Promise<unknown>) => {
    state.log.push(`lock:${listingId}`);
    try {
      return await fn(db);
    } finally {
      state.log.push(`unlock:${listingId}`);
    }
  },
}));
vi.mock("@/lib/prisma", () => {
  const listing = () => ({
    id: "listing_1",
    published: true,
    suspendedAt: null,
    hostId: "host_1",
    host: { name: "Host", email: "h@x" },
    maxGuests: 4,
    minNights: 1,
    maxNights: null,
    instantBook: true,
    pricePerNightCents: 10_000,
    cleaningFeeCents: 0,
    weeklyDiscountPercent: null,
    monthlyDiscountPercent: null,
    lastMinuteDiscountPercent: null,
    lastMinuteWindowDays: null,
    securityDepositCents: 0,
    title: "Flat",
    city: "Leeds",
  });
  return {
    prisma: {
      booking: {
        findFirst: async () => null,
        create: async (args: { data: Record<string, unknown> }) => {
          state.log.push("booking-create");
          mocks.bookingCreate(args);
          return { ...args.data, id: "bk_new" };
        },
      },
      user: {
        findUnique: async () => ({ name: "Guest", email: "g@x" }),
        findUniqueOrThrow: async () => ({ creditBalanceCents: state.creditBalanceCents }),
        updateMany: async ({ data }: { data: { creditBalanceCents: { decrement: number } } }) => {
          if (state.creditRacesToLose > 0) {
            // Another booking spent the balance between our read and write.
            state.creditRacesToLose--;
            state.creditBalanceCents = 0;
            return { count: 0 };
          }
          state.creditBalanceCents -= data.creditBalanceCents.decrement;
          return { count: 1 };
        },
      },
      promoCode: {
        findUnique: async () => ({
          id: "promo_1",
          active: true,
          expiresAt: null,
          maxRedemptions: 10,
          redemptionCount: 9,
          discountType: "FIXED",
          discountValue: 1_000,
        }),
        updateMany: async () => {
          if (state.promoRacesToLose > 0) {
            state.promoRacesToLose--;
            return { count: 0 };
          }
          return { count: 1 };
        },
      },
      listing: {
        findUnique: async () => {
          state.log.push("availability-read");
          return {
            ...listing(),
            propertyType: "APARTMENT",
            _count: { roomTypes: 0 },
            bookings: state.listingBookings,
            availabilityBlocks: state.listingBlocks,
            ...state.listingOverrides,
          };
        },
      },
      roomType: {
        findUnique: async (args: { select?: object }) => {
          if (args.select) return { listingId: "listing_1" };
          state.log.push("availability-read");
          return {
            id: "rt_1",
            totalRooms: 5,
            maxGuests: 2,
            pricePerNightCents: 10_000,
            bookings: [],
            availabilityBlocks: [],
            listing: {
              ...listing(),
              propertyType: "HOTEL",
              // The route asks only for the listing-wide ones.
              availabilityBlocks: state.listingBlocks.filter((b) => b.roomTypeId === null),
            },
          };
        },
      },
    },
  };
});

import { POST } from "./route";

const book = (body: object) =>
  POST(
    new Request("http://x", {
      method: "POST",
      body: JSON.stringify({ checkIn: "2027-03-01", checkOut: "2027-03-03", guests: 2, ...body }),
    }),
  );

beforeEach(() => {
  mocks.bookingCreate.mockReset();
  state.log = [];
  state.listingBookings = [];
  state.listingBlocks = [];
  state.creditBalanceCents = 0;
  state.creditRacesToLose = 0;
  state.promoRacesToLose = 0;
  state.listingOverrides = {};
});

describe("creating a booking", () => {
  it("reads availability and creates the booking inside the listing's availability lock", async () => {
    expect((await book({ listingId: "listing_1" })).status).toBe(201);
    expect(state.log).toEqual(["lock:listing_1", "availability-read", "booking-create", "unlock:listing_1"]);
  });

  it("locks a hotel room-type booking by its listing, the same key a listing-wide block uses", async () => {
    expect((await book({ roomTypeId: "rt_1" })).status).toBe(201);
    expect(state.log[0]).toBe("lock:listing_1");
  });

  it("refuses a room type for dates closed by a listing-wide (iCal) block", async () => {
    state.listingBlocks = [{ startDate: new Date("2027-03-02"), endDate: new Date("2027-03-04"), roomTypeId: null }];
    expect((await book({ roomTypeId: "rt_1" })).status).toBe(409);
    expect(mocks.bookingCreate).not.toHaveBeenCalled();
  });

  it("refuses to book a hotel, or any listing with room types, without choosing a room type", async () => {
    state.listingOverrides = { propertyType: "HOTEL" };
    const hotel = await book({ listingId: "listing_1" });
    expect(hotel.status).toBe(400);
    expect((await hotel.json()).error).toBe("Choose a room type");

    state.listingOverrides = { _count: { roomTypes: 2 } };
    expect((await book({ listingId: "listing_1" })).status).toBe(400);
    expect(mocks.bookingCreate).not.toHaveBeenCalled();
  });

  it("retries when the guest's credit was spent by another booking mid-way, applying only what's left", async () => {
    state.creditBalanceCents = 5_000;
    state.creditRacesToLose = 1;
    expect((await book({ listingId: "listing_1" })).status).toBe(201);
    expect(mocks.bookingCreate).toHaveBeenCalledTimes(1);
    expect(mocks.bookingCreate.mock.calls[0][0].data.creditAppliedCents).toBe(0);
  });

  it("never discounts more than FYStay's own fee, so the host is paid their full price", async () => {
    // 2 nights at £100: FYStay's fee is £20. A £10 code plus £50 of credit
    // can only take £20 off; the rest of the credit stays for next time.
    state.creditBalanceCents = 5_000;
    expect((await book({ listingId: "listing_1", promoCode: "SAVE10" })).status).toBe(201);
    const data = mocks.bookingCreate.mock.calls[0][0].data;
    expect(data.promoDiscountCents).toBe(1_000);
    expect(data.creditAppliedCents).toBe(1_000);
    expect(state.creditBalanceCents).toBe(4_000);
  });

  it("doesn't oversell a capped promo code's last redemption", async () => {
    state.promoRacesToLose = 3;
    expect((await book({ listingId: "listing_1", promoCode: "LAST1" })).status).toBe(409);
    expect(mocks.bookingCreate).not.toHaveBeenCalled();
  });
});
