import { beforeEach, describe, expect, it, vi } from "vitest";

const { state, mocks } = vi.hoisted(() => ({
  state: {
    request: {} as Record<string, unknown>,
    booking: {} as Record<string, unknown>,
    available: true,
    // Other requests on the booking still awaiting the host or the guest's payment.
    otherInProgress: 0,
    log: [] as string[],
    // Runs right after the route first reads the request: another response
    // landing between that read and the route's own claim.
    afterRead: null as null | (() => void),
  },
  mocks: { refundAcrossPayments: vi.fn(), opsAlert: vi.fn() },
}));

vi.mock("@/auth", () => ({ auth: async () => ({ user: { id: "host_1" } }) }));
vi.mock("@/lib/stripe", () => ({ getStripeClient: () => ({ marker: "stripe" }) }));
vi.mock("@/lib/connectRefunds", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/connectRefunds")>()),
  // The original booking payment, then one earlier paid date change.
  bookingPayments: async () => [
    { paymentIntentId: "pi_1", viaConnect: true },
    { paymentIntentId: "pi_change", viaConnect: true },
  ],
  refundAcrossPayments: async (...a: unknown[]) => {
    state.log.push("refund");
    return mocks.refundAcrossPayments(...a);
  },
}));
vi.mock("@/lib/notificationEmails", () => ({
  sendPaymentOpsAlertEmail: async (...a: unknown[]) => mocks.opsAlert(...a),
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
    Object.entries(where).every(([key, value]) =>
      value instanceof Date ? (row[key] as Date)?.getTime() === value.getTime() : row[key] === value,
    );
  const prisma: Record<string, unknown> = {
    bookingChangeRequest: {
      findUnique: async () => {
        const read = { ...state.request, booking: { ...state.booking, listing: { hostId: "host_1" }, roomType: null } };
        state.afterRead?.();
        return read;
      },
      findUniqueOrThrow: async () => ({ ...state.request }),
      count: async () => state.otherInProgress,
      findMany: async () => [],
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        if (!matches(state.request, where)) return { count: 0 };
        state.log.push(`request:${String(data.status)}`);
        Object.assign(state.request, data);
        return { count: 1 };
      },
      update: async ({ data }: { data: Record<string, unknown> }) => Object.assign(state.request, data),
    },
    booking: {
      findUnique: async () => ({ ...state.booking }),
      update: async ({ data }: { data: Record<string, unknown> }) => {
        state.log.push("booking-update");
        return Object.assign(state.booking, data);
      },
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        if (!matches(state.booking, where)) return { count: 0 };
        Object.assign(state.booking, data);
        return { count: 1 };
      },
    },
  };
  prisma.$transaction = async (arg: unknown) =>
    typeof arg === "function" ? (arg as (tx: unknown) => unknown)(prisma) : Promise.all(arg as Promise<unknown>[]);
  return { prisma };
});

import { POST } from "./route";

const respond = (action: "approve" | "decline") =>
  POST(new Request("http://x", { method: "POST", body: JSON.stringify({ action }) }), {
    params: Promise.resolve({ id: "bk_1", requestId: "cr_1" }),
  });

const originalCheckIn = new Date("2026-12-01");
const originalCheckOut = new Date("2026-12-04");

beforeEach(() => {
  mocks.refundAcrossPayments.mockReset();
  mocks.opsAlert.mockReset();
  state.otherInProgress = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
  state.available = true;
  state.log = [];
  state.afterRead = null;
  // A 3-night stay shortened to 2: £110 back.
  state.booking = {
    id: "bk_1",
    listingId: "listing_1",
    roomTypeId: null,
    roomsBooked: 1,
    status: "CONFIRMED",
    checkIn: originalCheckIn,
    checkOut: originalCheckOut,
    nights: 3,
    guests: 2,
    totalPriceCents: 33_000,
    serviceFeeCents: 3_000,
    hostCommissionCents: 0,
    cleaningFeeCents: 0,
    taxCents: 0,
    creditAppliedCents: 0,
    promoDiscountCents: 0,
    stripePaymentIntentId: "pi_1",
    hostPaidViaConnect: true,
  };
  state.request = {
    id: "cr_1",
    bookingId: "bk_1",
    status: "PENDING",
    requestedCheckIn: new Date("2026-12-01"),
    requestedCheckOut: new Date("2026-12-03"),
    requestedGuests: 2,
    priceDeltaCents: -11_000,
    originalCheckIn,
    originalCheckOut,
    originalTotalPriceCents: 33_000,
    respondedAt: null,
  };
});

describe("approving a shorter stay", () => {
  it("claims the request and moves the dates under the lock before refunding, keyed by request", async () => {
    expect((await respond("approve")).status).toBe(200);
    expect(state.log).toEqual([
      "lock:listing_1",
      "availability-check",
      "request:APPROVED",
      "booking-update",
      "unlock:listing_1",
      "refund",
    ]);
    // Spread across every payment the booking has taken, not just the
    // original one (which an earlier paid change may have left short).
    expect(mocks.refundAcrossPayments).toHaveBeenCalledWith(
      expect.anything(),
      [
        { paymentIntentId: "pi_1", viaConnect: true },
        { paymentIntentId: "pi_change", viaConnect: true },
      ],
      11_000,
      "change-refund:cr_1",
    );
    expect(state.booking).toMatchObject({ nights: 2, totalPriceCents: 22_000 });
    expect(state.request.refundedAt).toBeInstanceOf(Date);
  });

  it("puts the request and the booking back if Stripe refuses the refund", async () => {
    mocks.refundAcrossPayments.mockRejectedValueOnce(new Error("refund_declined"));
    expect((await respond("approve")).status).toBe(500);
    expect(state.request).toMatchObject({ status: "PENDING", respondedAt: null });
    expect(state.booking).toMatchObject({
      checkIn: originalCheckIn,
      checkOut: originalCheckOut,
      nights: 3,
      totalPriceCents: 33_000,
      serviceFeeCents: 3_000,
    });
  });

  it("refunds nothing when another response claimed the request first", async () => {
    state.afterRead = () => Object.assign(state.request, { status: "DECLINED" });
    expect((await respond("approve")).status).toBe(409);
    expect(mocks.refundAcrossPayments).not.toHaveBeenCalled();
    expect(state.booking.nights).toBe(3);
  });

  it("refuses, and refunds nothing, once the booking has been cancelled", async () => {
    state.booking.status = "CANCELLED";
    expect((await respond("approve")).status).toBe(409);
    expect(mocks.refundAcrossPayments).not.toHaveBeenCalled();
    expect(state.request.status).toBe("PENDING");
  });

  it("refuses when the booking is cancelled between the first read and the locked re-check", async () => {
    state.afterRead = () => Object.assign(state.booking, { status: "CANCELLED" });
    expect((await respond("approve")).status).toBe(409);
    expect(mocks.refundAcrossPayments).not.toHaveBeenCalled();
    expect(state.request.status).toBe("PENDING");
  });
});

describe("one change at a time", () => {
  it("keeps the change and alerts ops when only part of the refund went through", async () => {
    const { RefundIncompleteError } = await import("@/lib/connectRefunds");
    mocks.refundAcrossPayments.mockRejectedValueOnce(new RefundIncompleteError(4_000, 11_000, new Error("declined")));
    expect((await respond("approve")).status).toBe(200);
    expect(state.request.status).toBe("APPROVED");
    expect(state.booking).toMatchObject({ nights: 2, totalPriceCents: 22_000 });
    expect(mocks.opsAlert).toHaveBeenCalledWith(expect.objectContaining({ amountCents: 7_000 }));
  });

  it("won't approve while another request on the booking is still in progress", async () => {
    state.otherInProgress = 1;
    expect((await respond("approve")).status).toBe(409);
    expect(state.request.status).toBe("PENDING");
    expect(state.booking.nights).toBe(3);
    expect(mocks.refundAcrossPayments).not.toHaveBeenCalled();
  });

  it("won't approve a request priced against dates or a total the booking no longer has", async () => {
    // An earlier change already moved the stay since this one was asked for.
    Object.assign(state.booking, { checkOut: new Date("2026-12-05"), nights: 4, totalPriceCents: 44_000 });
    expect((await respond("approve")).status).toBe(409);
    expect(state.request.status).toBe("PENDING");
    expect(state.booking.totalPriceCents).toBe(44_000);
    expect(mocks.refundAcrossPayments).not.toHaveBeenCalled();
  });
});

describe("declining", () => {
  it("can't overwrite an approval that landed after the request was read", async () => {
    state.afterRead = () => Object.assign(state.request, { status: "APPROVED" });
    expect((await respond("decline")).status).toBe(409);
    expect(state.request.status).toBe("APPROVED");
  });
});

describe("discounted bookings: no shorter or cheaper stay (launch rule)", () => {
  // A commission-model booking: 3 nights at £100, £30 commission, a £20
  // promo (FYStay's cost) - the guest paid £280. Shortened to 2 nights.
  const discounted = (discounts: { promoDiscountCents?: number; creditAppliedCents?: number }) => {
    const promo = discounts.promoDiscountCents ?? 0;
    const credit = discounts.creditAppliedCents ?? 0;
    Object.assign(state.booking, {
      totalPriceCents: 30_000 - promo - credit,
      serviceFeeCents: 0,
      hostCommissionCents: 3_000,
      promoDiscountCents: promo,
      creditAppliedCents: credit,
    });
    Object.assign(state.request, { priceDeltaCents: -10_000, originalTotalPriceCents: 30_000 - promo - credit });
  };

  it("won't approve a shorter stay on a promo booking: nothing claimed, moved or refunded", async () => {
    discounted({ promoDiscountCents: 2_000 });
    const response = await respond("approve");
    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/Decline this request/);
    expect(state.log).toEqual(["lock:listing_1", "unlock:listing_1"]);
    expect(mocks.refundAcrossPayments).not.toHaveBeenCalled();
    expect(state.request.status).toBe("PENDING");
    expect(state.booking).toMatchObject({ nights: 3, totalPriceCents: 28_000, hostCommissionCents: 3_000 });
  });

  it("won't approve one on a referral-credit booking either", async () => {
    discounted({ creditAppliedCents: 1_500 });
    expect((await respond("approve")).status).toBe(409);
    expect(mocks.refundAcrossPayments).not.toHaveBeenCalled();
    expect(state.request.status).toBe("PENDING");
  });

  it("refuses repeated approvals the same way, never refunding across the booking's several payments", async () => {
    // bookingPayments (mocked above) returns the original payment and an
    // earlier paid change - the refund would have spread across both.
    discounted({ promoDiscountCents: 2_000, creditAppliedCents: 500 });
    for (let i = 0; i < 3; i++) expect((await respond("approve")).status).toBe(409);
    expect(mocks.refundAcrossPayments).not.toHaveBeenCalled();
    expect(state.log.filter((e) => e === "booking-update" || e.startsWith("request:"))).toEqual([]);
  });

  it("still lets the host decline it, so the guest can cancel and rebook", async () => {
    discounted({ promoDiscountCents: 2_000 });
    expect((await respond("decline")).status).toBe(200);
    expect(state.request.status).toBe("DECLINED");
    expect(mocks.refundAcrossPayments).not.toHaveBeenCalled();
  });

  it("approves a longer stay on a promo booking, leaving the dates until the guest pays the extra", async () => {
    discounted({ promoDiscountCents: 2_000 });
    Object.assign(state.request, { requestedCheckOut: new Date("2026-12-05"), priceDeltaCents: 10_000 });
    expect((await respond("approve")).status).toBe(200);
    expect(state.request.status).toBe("APPROVED");
    expect(state.log).not.toContain("booking-update");
    expect(mocks.refundAcrossPayments).not.toHaveBeenCalled();
  });

  it("approves a shorter stay without a discount, refunding once and moving FYStay's 10% with it", async () => {
    discounted({});
    expect((await respond("approve")).status).toBe(200);
    expect(mocks.refundAcrossPayments).toHaveBeenCalledTimes(1);
    expect(mocks.refundAcrossPayments.mock.calls[0][2]).toBe(10_000);
    // £200 stay left: commission £20, the host's 90% is £180.
    expect(state.booking).toMatchObject({ nights: 2, totalPriceCents: 20_000, hostCommissionCents: 2_000 });
    // A second approval finds it already answered and refunds nothing more.
    expect((await respond("approve")).status).toBe(409);
    expect(mocks.refundAcrossPayments).toHaveBeenCalledTimes(1);
  });

  it("rounds the commission to the penny on an odd refund", async () => {
    discounted({});
    Object.assign(state.request, { priceDeltaCents: -3_333 });
    expect((await respond("approve")).status).toBe(200);
    // £266.67 stay left: 10% is 2,666.7p, rounded to £26.67.
    expect(state.booking).toMatchObject({ totalPriceCents: 26_667, hostCommissionCents: 2_667 });
  });
});
