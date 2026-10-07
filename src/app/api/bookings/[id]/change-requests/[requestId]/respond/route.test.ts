import { beforeEach, describe, expect, it, vi } from "vitest";

const { state, mocks } = vi.hoisted(() => ({
  state: {
    request: {} as Record<string, unknown>,
    booking: {} as Record<string, unknown>,
    available: true,
    log: [] as string[],
    // Runs right after the route first reads the request: another response
    // landing between that read and the route's own claim.
    afterRead: null as null | (() => void),
  },
  mocks: { refundChangeDifference: vi.fn() },
}));

vi.mock("@/auth", () => ({ auth: async () => ({ user: { id: "host_1" } }) }));
vi.mock("@/lib/stripe", () => ({ getStripeClient: () => ({ marker: "stripe" }) }));
vi.mock("@/lib/connectRefunds", () => ({
  refundChangeDifference: async (...a: unknown[]) => {
    state.log.push("refund");
    return mocks.refundChangeDifference(...a);
  },
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
  mocks.refundChangeDifference.mockReset();
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
    expect(mocks.refundChangeDifference).toHaveBeenCalledWith(
      expect.anything(),
      { paymentIntentId: "pi_1", viaConnect: true },
      expect.objectContaining({ refundCents: 11_000 }),
      "change-refund:cr_1",
    );
    expect(state.booking).toMatchObject({ nights: 2, totalPriceCents: 22_000 });
    expect(state.request.refundedAt).toBeInstanceOf(Date);
  });

  it("puts the request and the booking back if Stripe refuses the refund", async () => {
    mocks.refundChangeDifference.mockRejectedValueOnce(new Error("refund_declined"));
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
    expect(mocks.refundChangeDifference).not.toHaveBeenCalled();
    expect(state.booking.nights).toBe(3);
  });

  it("refuses, and refunds nothing, once the booking has been cancelled", async () => {
    state.booking.status = "CANCELLED";
    expect((await respond("approve")).status).toBe(409);
    expect(mocks.refundChangeDifference).not.toHaveBeenCalled();
    expect(state.request.status).toBe("PENDING");
  });

  it("refuses when the booking is cancelled between the first read and the locked re-check", async () => {
    state.afterRead = () => Object.assign(state.booking, { status: "CANCELLED" });
    expect((await respond("approve")).status).toBe(409);
    expect(mocks.refundChangeDifference).not.toHaveBeenCalled();
    expect(state.request.status).toBe("PENDING");
  });
});

describe("declining", () => {
  it("can't overwrite an approval that landed after the request was read", async () => {
    state.afterRead = () => Object.assign(state.request, { status: "APPROVED" });
    expect((await respond("decline")).status).toBe(409);
    expect(state.request.status).toBe("APPROVED");
  });
});
