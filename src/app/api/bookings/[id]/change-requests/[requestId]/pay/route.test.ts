import { beforeEach, describe, expect, it, vi } from "vitest";

const { state, mocks } = vi.hoisted(() => ({
  state: {
    request: {} as Record<string, unknown>,
    booking: {} as Record<string, unknown>,
    available: true,
    log: [] as string[],
  },
  mocks: {
    refundAcrossPayments: vi.fn(),
    sessionsCreate: vi.fn(),
    sessionsRetrieve: vi.fn(),
    sessionsExpire: vi.fn(),
  },
}));

vi.mock("@/auth", () => ({ auth: async () => ({ user: { id: "guest_1" } }) }));
vi.mock("@/lib/stripe", () => ({
  allowsUnpaidConfirmation: () => true,
  PAYMENTS_UNAVAILABLE_MESSAGE: "unavailable",
  getStripeClient: () => ({
    checkout: {
      sessions: { create: mocks.sessionsCreate, retrieve: mocks.sessionsRetrieve, expire: mocks.sessionsExpire },
    },
  }),
}));
vi.mock("@/lib/stripeConnect", () => ({
  HOST_NOT_PAYMENT_READY_MESSAGE: "host not ready",
  verifyHostPaymentReady: async () => true,
}));
vi.mock("@/lib/stripeCustomer", () => ({ getOrCreateStripeCustomer: async () => "cus_1" }));
vi.mock("@/lib/connectRefunds", () => ({
  refundAcrossPayments: (...a: unknown[]) => mocks.refundAcrossPayments(...a),
}));
vi.mock("@/lib/availability", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/availability")>()),
  isRequestedRangeStillAvailable: async () => {
    state.log.push("availability-check");
    return state.available;
  },
}));
vi.mock("@/lib/availabilityLock", () => ({
  withListingAvailabilityLock: async (db: unknown, listingId: string, fn: (tx: unknown) => Promise<unknown>) => {
    state.log.push(`lock:${listingId}`);
    const result = await fn(db);
    state.log.push(`unlock:${listingId}`);
    return result;
  },
}));
vi.mock("@/lib/prisma", () => {
  const matches = (row: Record<string, unknown>, where: Record<string, unknown>) =>
    Object.entries(where).every(([key, value]) => row[key] === value);
  const prisma: Record<string, unknown> = {
    bookingChangeRequest: {
      findUnique: async () => ({
        ...state.request,
        booking: {
          ...state.booking,
          listing: { title: "Flat", host: { stripeConnectAccountId: "acct_1" } },
        },
      }),
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        if (!matches(state.request, where)) return { count: 0 };
        state.log.push(data.paidAt ? "request:paid" : `request:${String(data.status ?? "session")}`);
        Object.assign(state.request, data);
        return { count: 1 };
      },
      update: async ({ data }: { data: Record<string, unknown> }) => Object.assign(state.request, data),
    },
    booking: {
      update: async ({ data }: { data: Record<string, unknown> }) => {
        state.log.push("booking-update");
        return Object.assign(state.booking, data);
      },
    },
  };
  prisma.$transaction = async (fn: (tx: unknown) => unknown) => fn(prisma);
  return { prisma };
});

import { applyApprovedChange, POST } from "./route";

const pay = () =>
  POST(new Request("http://x", { method: "POST" }), { params: Promise.resolve({ id: "bk_1", requestId: "cr_1" }) });

const stayCheckIn = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
const stayCheckOut = new Date(stayCheckIn.getTime() + 3 * 24 * 60 * 60 * 1000);

beforeEach(() => {
  Object.values(mocks).forEach((m) => m.mockReset());
  mocks.sessionsExpire.mockResolvedValue({});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  state.available = true;
  state.log = [];
  state.booking = {
    id: "bk_1",
    guestId: "guest_1",
    listingId: "listing_1",
    roomTypeId: null,
    roomsBooked: 1,
    status: "CONFIRMED",
    checkIn: stayCheckIn,
    checkOut: stayCheckOut,
    nights: 3,
    totalPriceCents: 33_000,
    serviceFeeCents: 3_000,
    cleaningFeeCents: 0,
    taxCents: 0,
    creditAppliedCents: 0,
    promoDiscountCents: 0,
  };
  // One extra night: £110 more.
  state.request = {
    id: "cr_1",
    bookingId: "bk_1",
    status: "APPROVED",
    paidAt: null,
    priceDeltaCents: 11_000,
    requestedCheckIn: new Date("2026-12-01"),
    requestedCheckOut: new Date("2026-12-05"),
    requestedGuests: 2,
    stripeSessionId: null,
    hostPaidViaConnect: true,
    originalCheckIn: stayCheckIn,
    originalCheckOut: stayCheckOut,
    originalTotalPriceCents: 33_000,
  };
});

describe("paying for a date change", () => {
  it("hands back the still-open payment page instead of creating a second one", async () => {
    state.request.stripeSessionId = "cs_open";
    mocks.sessionsRetrieve.mockResolvedValue({ id: "cs_open", status: "open", url: "https://pay/cs_open" });
    const response = await pay();
    expect(await response.json()).toEqual({ url: "https://pay/cs_open" });
    expect(mocks.sessionsCreate).not.toHaveBeenCalled();
  });

  it("starts a new page once the old one expired unpaid", async () => {
    state.request.stripeSessionId = "cs_old";
    mocks.sessionsRetrieve.mockResolvedValue({ id: "cs_old", status: "expired", url: null });
    mocks.sessionsCreate.mockResolvedValue({ id: "cs_new", url: "https://pay/cs_new" });
    expect(await (await pay()).json()).toEqual({ url: "https://pay/cs_new" });
    expect(state.request.stripeSessionId).toBe("cs_new");
  });

  it("closes the open payment page and declines when the new dates were taken", async () => {
    state.available = false;
    state.request.stripeSessionId = "cs_open";
    expect((await pay()).status).toBe(409);
    expect(mocks.sessionsExpire).toHaveBeenCalledWith("cs_open");
    expect(state.request.status).toBe("DECLINED");
    expect(mocks.sessionsCreate).not.toHaveBeenCalled();
  });

  it("doesn't decline a change whose payment landed while the dates were re-checked", async () => {
    state.available = false;
    state.request.stripeSessionId = "cs_paid";
    // The webhook applied the payment just before the decline is written.
    mocks.sessionsExpire.mockImplementation(async () => {
      state.request.paidAt = new Date();
      throw new Error("session already complete");
    });
    expect((await pay()).status).toBe(409);
    expect(state.request.status).toBe("APPROVED");
  });

  it("refuses once the booking has been cancelled", async () => {
    state.booking.status = "CANCELLED";
    expect((await pay()).status).toBe(409);
    expect(mocks.sessionsCreate).not.toHaveBeenCalled();
  });
});

describe("applyApprovedChange", () => {
  it("applies a correctly paid change inside the listing's availability lock", async () => {
    await applyApprovedChange("cr_1", "pi_change", { amountCents: 11_000, currency: "gbp" });
    expect(state.log).toEqual(["lock:listing_1", "availability-check", "request:paid", "booking-update", "unlock:listing_1"]);
    expect(state.booking.totalPriceCents).toBe(44_000);
    expect(mocks.refundAcrossPayments).not.toHaveBeenCalled();
  });

  it("refunds, keyed by request, when Stripe took a different amount", async () => {
    await applyApprovedChange("cr_1", "pi_change", { amountCents: 500, currency: "gbp" });
    expect(mocks.refundAcrossPayments).toHaveBeenCalledWith(
      expect.anything(),
      [{ paymentIntentId: "pi_change", viaConnect: true }],
      500,
      "change-payment-refund:cr_1",
    );
    expect(state.request).toMatchObject({ status: "DECLINED", paidAt: null });
    expect(state.booking.totalPriceCents).toBe(33_000);
  });

  it("refunds instead of applying when the booking was cancelled before the payment landed", async () => {
    state.booking.status = "CANCELLED";
    await applyApprovedChange("cr_1", "pi_change", { amountCents: 11_000, currency: "gbp" });
    expect(mocks.refundAcrossPayments).toHaveBeenCalledTimes(1);
    expect(state.request.status).toBe("DECLINED");
    expect(state.log).not.toContain("booking-update");
  });

  it("refunds instead of applying when the new dates were taken", async () => {
    state.available = false;
    await applyApprovedChange("cr_1", "pi_change", { amountCents: 11_000, currency: "gbp" });
    expect(mocks.refundAcrossPayments.mock.calls[0][3]).toBe("change-payment-refund:cr_1");
    expect(state.request.status).toBe("DECLINED");
  });

  it("refunds instead of stacking a second change on a booking another change already moved", async () => {
    // Approved against a 3-night £330 stay; another change has since made it 4 nights.
    Object.assign(state.booking, { checkOut: new Date(stayCheckOut.getTime() + 86_400_000), totalPriceCents: 44_000 });
    await applyApprovedChange("cr_1", "pi_change", { amountCents: 11_000, currency: "gbp", sessionId: "cs_1" });
    expect(mocks.refundAcrossPayments).toHaveBeenCalledTimes(1);
    expect(state.request).toMatchObject({ status: "DECLINED", paidAt: null });
    expect(state.booking.totalPriceCents).toBe(44_000);
    expect(state.log).not.toContain("booking-update");
  });

  it("refunds a payment that lands after the request was declined", async () => {
    Object.assign(state.request, { status: "DECLINED", stripeSessionId: "cs_1" });
    await applyApprovedChange("cr_1", "pi_change", { amountCents: 11_000, currency: "gbp", sessionId: "cs_1" });
    expect(mocks.refundAcrossPayments).toHaveBeenCalledWith(
      expect.anything(),
      [{ paymentIntentId: "pi_change", viaConnect: true }],
      11_000,
      "change-payment-refund:cr_1",
    );
    expect(state.request.status).toBe("DECLINED");
    expect(state.booking.totalPriceCents).toBe(33_000);
  });

  it("ignores a redelivery of the payment that applied the change, but refunds a second one", async () => {
    Object.assign(state.request, { paidAt: new Date(), stripeSessionId: "cs_1" });
    await applyApprovedChange("cr_1", "pi_change", { amountCents: 11_000, currency: "gbp", sessionId: "cs_1" });
    expect(mocks.refundAcrossPayments).not.toHaveBeenCalled();

    await applyApprovedChange("cr_1", "pi_other", { amountCents: 11_000, currency: "gbp", sessionId: "cs_other" });
    expect(mocks.refundAcrossPayments).toHaveBeenCalledTimes(1);
    expect(mocks.refundAcrossPayments.mock.calls[0][1]).toEqual([{ paymentIntentId: "pi_other", viaConnect: true }]);
    expect(state.request.status).toBe("APPROVED");
    expect(state.log).not.toContain("booking-update");
  });

  it("leaves the request approved for Stripe's retry if the refund fails", async () => {
    mocks.refundAcrossPayments.mockRejectedValueOnce(new Error("stripe down"));
    state.booking.status = "CANCELLED";
    await expect(applyApprovedChange("cr_1", "pi_change", { amountCents: 11_000, currency: "gbp" })).rejects.toThrow();
    expect(state.request.status).toBe("APPROVED");
  });
});
