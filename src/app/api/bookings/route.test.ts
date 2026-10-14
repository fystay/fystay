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
    emailVerified: true,
    // Bookings this guest already made with the promo code.
    promoUses: 0,
    listingOverrides: {} as Record<string, unknown>,
  },
  mocks: { bookingCreate: vi.fn(), decisionCreate: vi.fn() },
}));

vi.mock("@/auth", () => ({ auth: async () => ({ user: { id: "guest_1" } }) }));
vi.mock("@/lib/rateLimit", () => ({
  checkRateLimit: async () => ({ allowed: true }),
  rateLimitedResponse: vi.fn(),
}));
vi.mock("@/lib/notificationEmails", () => ({ sendBookingRequestReceivedEmail: vi.fn() }));
// The calendar refresh before booking is covered in icalSync.test.ts.
vi.mock("@/lib/icalSync", () => ({ refreshStaleIcalImport: vi.fn(async () => {}) }));
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
      $executeRaw: async () => 0,
      priceDecision: {
        create: async (args: { data: Record<string, unknown> }) => {
          mocks.decisionCreate(args);
          return { id: "pd_1" };
        },
      },
      // No verified event feed for this town: smart pricing reads only the calendar.
      localTown: { findFirst: async () => null },
      booking: {
        findFirst: async () => null,
        count: async () => state.promoUses,
        create: async (args: { data: Record<string, unknown> }) => {
          state.log.push("booking-create");
          mocks.bookingCreate(args);
          return { ...args.data, id: "bk_new" };
        },
      },
      user: {
        findUnique: async () => ({ name: "Guest", email: "g@x" }),
        findUniqueOrThrow: async () => ({
          creditBalanceCents: state.creditBalanceCents,
          emailVerifiedAt: state.emailVerified ? new Date("2026-01-01") : null,
        }),
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
  vi.unstubAllEnvs();
  mocks.bookingCreate.mockReset();
  mocks.decisionCreate.mockReset();
  state.log = [];
  state.listingBookings = [];
  state.listingBlocks = [];
  state.creditBalanceCents = 0;
  state.creditRacesToLose = 0;
  state.promoRacesToLose = 0;
  state.emailVerified = true;
  state.promoUses = 0;
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

  it("lets each person use a promo code once", async () => {
    state.promoUses = 1;
    const res = await book({ listingId: "listing_1", promoCode: "SAVE10" });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("You've already used this promo code.");
    expect(mocks.bookingCreate).not.toHaveBeenCalled();
  });

  it("only takes promo codes from a verified email address", async () => {
    state.emailVerified = false;
    const res = await book({ listingId: "listing_1", promoCode: "SAVE10" });
    expect(res.status).toBe(403);
    expect(mocks.bookingCreate).not.toHaveBeenCalled();
  });

  it("doesn't oversell a capped promo code's last redemption", async () => {
    state.promoRacesToLose = 3;
    expect((await book({ listingId: "listing_1", promoCode: "LAST1" })).status).toBe(409);
    expect(mocks.bookingCreate).not.toHaveBeenCalled();
  });
});

describe("pricing a booking (stayQuote.ts)", () => {
  // Every night two weeks either side of the stay is booked: high demand.
  const busyCalendar = () => {
    state.listingBookings = [
      { checkIn: new Date("2027-02-15T00:00:00Z"), checkOut: new Date("2027-03-01T00:00:00Z") },
      { checkIn: new Date("2027-03-03T00:00:00Z"), checkOut: new Date("2027-03-17T00:00:00Z") },
    ];
  };
  const optedIn = (overrides: Record<string, unknown> = {}) => {
    state.listingOverrides = {
      weekendPricePerNightCents: null,
      smartPricingEnabled: true,
      smartPricingAutoApply: true,
      smartPricingConsentAt: new Date("2026-10-01"),
      smartPricingMinPayoutCents: 8_000,
      smartPricingTargetPayoutCents: null,
      smartPricingMinPriceCents: null,
      smartPricingMaxPriceCents: null,
      smartPricingMaxAdjustmentPercent: null,
      ...overrides,
    };
  };

  it("snapshots the fixed-10% policy on an ordinary booking", async () => {
    expect((await book({ listingId: "listing_1" })).status).toBe(201);
    expect(mocks.bookingCreate.mock.calls[0][0].data).toMatchObject({
      nightlyPriceCents: 10_000,
      hostCommissionCents: 2_000,
      totalPriceCents: 20_000,
      pricingPolicyVersion: "fixed-10-v1",
      commissionRateBps: 1000,
      basePriceSubtotalCents: null,
      priceDecisionId: null,
    });
    expect(mocks.decisionCreate).not.toHaveBeenCalled();
  });

  it("refuses to book at a price the guest wasn't shown", async () => {
    const res = await book({ listingId: "listing_1", expectedTotalCents: 19_000 });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/now £200\.00/);
    expect(mocks.bookingCreate).not.toHaveBeenCalled();
    expect((await book({ listingId: "listing_1", expectedTotalCents: 20_000 })).status).toBe(201);
  });

  it("ignores a host's smart-pricing settings while SMART_PRICING_MODE is off", async () => {
    busyCalendar();
    optedIn();
    expect((await book({ listingId: "listing_1" })).status).toBe(201);
    expect(mocks.bookingCreate.mock.calls[0][0].data).toMatchObject({ totalPriceCents: 20_000, pricingPolicyVersion: "fixed-10-v1" });
  });

  it("charges the smart price when it's on and the host opted in, recording the decision", async () => {
    vi.stubEnv("SMART_PRICING_MODE", "on");
    busyCalendar();
    optedIn();
    expect((await book({ listingId: "listing_1" })).status).toBe(201);
    expect(mocks.bookingCreate.mock.calls[0][0].data).toMatchObject({
      nightlyPriceCents: 10_500,
      totalPriceCents: 21_000,
      hostCommissionCents: 2_100,
      pricingPolicyVersion: "smart-v1",
      commissionRateBps: 1000,
      basePriceSubtotalCents: 20_000,
      priceDecisionId: "pd_1",
    });
    expect(mocks.decisionCreate.mock.calls[0][0].data).toMatchObject({ mode: "applied", outcome: "adjusted", adjustmentPercent: 5 });
  });

  it("in shadow mode charges the host's own price and only records the smart one", async () => {
    vi.stubEnv("SMART_PRICING_MODE", "shadow");
    busyCalendar();
    optedIn();
    expect((await book({ listingId: "listing_1" })).status).toBe(201);
    expect(mocks.bookingCreate.mock.calls[0][0].data).toMatchObject({ totalPriceCents: 20_000, pricingPolicyVersion: "fixed-10-v1", priceDecisionId: null });
    expect(mocks.decisionCreate.mock.calls[0][0].data).toMatchObject({ mode: "shadow", chosenAccommodationCents: 21_000 });
  });

  it("only suggests when the host wants to approve changes, and never prices without their consent", async () => {
    vi.stubEnv("SMART_PRICING_MODE", "on");
    busyCalendar();
    optedIn({ smartPricingAutoApply: false });
    expect((await book({ listingId: "listing_1" })).status).toBe(201);
    expect(mocks.bookingCreate.mock.calls[0][0].data.totalPriceCents).toBe(20_000);
    expect(mocks.decisionCreate.mock.calls[0][0].data.mode).toBe("suggested");

    mocks.bookingCreate.mockReset();
    mocks.decisionCreate.mockReset();
    optedIn({ smartPricingConsentAt: null });
    expect((await book({ listingId: "listing_1" })).status).toBe(201);
    expect(mocks.bookingCreate.mock.calls[0][0].data.totalPriceCents).toBe(20_000);
    expect(mocks.decisionCreate).not.toHaveBeenCalled();
  });

  it("prices hotel room types at the fixed 10%", async () => {
    vi.stubEnv("SMART_PRICING_MODE", "on");
    expect((await book({ roomTypeId: "rt_1" })).status).toBe(201);
    expect(mocks.bookingCreate.mock.calls[0][0].data).toMatchObject({ pricingPolicyVersion: "fixed-10-v1", commissionRateBps: 1000 });
  });
});
