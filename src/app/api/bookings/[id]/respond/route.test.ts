import { beforeEach, describe, expect, it, vi } from "vitest";

const { state, mocks } = vi.hoisted(() => ({
  state: {
    booking: {} as Record<string, unknown>,
    available: true,
    log: [] as string[],
    // Runs right after the route reads the booking: something else acting
    // on it between that read and the route's own write.
    afterRead: null as null | (() => void),
  },
  mocks: {
    userUpdate: vi.fn(),
    promoUpdate: vi.fn(),
    respondedEmail: vi.fn(),
  },
}));

vi.mock("@/auth", () => ({ auth: async () => ({ user: { id: "host_1" } }) }));
vi.mock("@/lib/notificationEmails", () => ({
  sendBookingRequestRespondedEmail: (...a: unknown[]) => mocks.respondedEmail(...a),
}));
vi.mock("@/lib/availability", () => ({
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
  // Applies a conditional update only if every condition still holds - the
  // same guarantee Postgres gives the real updateMany.
  const matches = (where: Record<string, unknown>) =>
    Object.entries(where).every(([key, condition]) => {
      const value = state.booking[key];
      if (condition && typeof condition === "object" && "gt" in condition) {
        return value instanceof Date && value > (condition as { gt: Date }).gt;
      }
      return value === condition;
    });
  const prisma: Record<string, unknown> = {
    booking: {
      findUnique: async () => {
        const read = {
          ...state.booking,
          listing: { hostId: "host_1", title: "Flat", city: "Leeds", host: { name: "Host", email: "h@x" } },
        };
        state.afterRead?.();
        return read;
      },
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        if (!matches(where)) return { count: 0 };
        state.log.push(`booking-write:${String(data.approvalStatus)}`);
        Object.assign(state.booking, data);
        return { count: 1 };
      },
    },
    user: { update: (...a: unknown[]) => mocks.userUpdate(...a) },
    promoCode: { update: (...a: unknown[]) => mocks.promoUpdate(...a) },
  };
  prisma.$transaction = async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma);
  return { prisma };
});

import { POST } from "./route";

const respond = (action: "approve" | "decline") =>
  POST(new Request("http://x", { method: "POST", body: JSON.stringify({ action }) }), {
    params: Promise.resolve({ id: "bk_1" }),
  });

beforeEach(() => {
  Object.values(mocks).forEach((m) => m.mockReset());
  state.available = true;
  state.log = [];
  state.afterRead = null;
  state.booking = {
    id: "bk_1",
    listingId: "listing_1",
    roomTypeId: null,
    roomsBooked: 1,
    status: "PENDING",
    approvalStatus: "AWAITING",
    requestExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
    guestId: "guest_1",
    creditAppliedCents: 1_500,
    promoCodeId: "promo_1",
    checkIn: new Date("2026-12-01"),
    checkOut: new Date("2026-12-03"),
  };
});

describe("declining a booking request", () => {
  it("gives the guest's credit and promo back once, however many declines race", async () => {
    // Both requests read the booking as AWAITING before either writes.
    const [first, second] = await Promise.all([respond("decline"), respond("decline")]);
    expect([first.status, second.status].sort()).toEqual([200, 409]);
    expect(mocks.userUpdate).toHaveBeenCalledTimes(1);
    expect(mocks.promoUpdate).toHaveBeenCalledTimes(1);
    expect(mocks.respondedEmail).toHaveBeenCalledTimes(1);
  });

  it("gives nothing back if the expiry sweep got there first", async () => {
    // The sweep's own guarded update lands between the route's read and write.
    state.afterRead = () => Object.assign(state.booking, { status: "CANCELLED", approvalStatus: "EXPIRED" });
    expect((await respond("decline")).status).toBe(409);
    expect(mocks.userUpdate).not.toHaveBeenCalled();
    expect(mocks.promoUpdate).not.toHaveBeenCalled();
    expect(state.booking.approvalStatus).toBe("EXPIRED");
  });
});

describe("approving a booking request", () => {
  it("re-checks availability and approves inside the listing's availability lock", async () => {
    expect((await respond("approve")).status).toBe(200);
    expect(state.log).toEqual(["lock:listing_1", "availability-check", "booking-write:APPROVED", "unlock:listing_1"]);
    expect(state.booking.approvalStatus).toBe("APPROVED");
  });

  it("refuses when the dates have been taken", async () => {
    state.available = false;
    expect((await respond("approve")).status).toBe(409);
    expect(state.booking.approvalStatus).toBe("AWAITING");
  });

  it("refuses a request whose hold has already expired, even before the sweep runs", async () => {
    state.booking.requestExpiresAt = new Date(Date.now() - 1000);
    expect((await respond("approve")).status).toBe(409);
    expect(state.booking.approvalStatus).toBe("AWAITING");
    expect(mocks.respondedEmail).not.toHaveBeenCalled();
  });

  it("doesn't approve a request declined in another tab after it was read", async () => {
    state.afterRead = () => Object.assign(state.booking, { status: "CANCELLED", approvalStatus: "DECLINED" });
    expect((await respond("approve")).status).toBe(409);
    expect(state.booking.approvalStatus).toBe("DECLINED");
    expect(mocks.respondedEmail).not.toHaveBeenCalled();
  });

  it("approves only once when the host double-clicks", async () => {
    const [first, second] = await Promise.all([respond("approve"), respond("approve")]);
    expect([first.status, second.status].sort()).toEqual([200, 409]);
    expect(mocks.respondedEmail).toHaveBeenCalledTimes(1);
  });
});
