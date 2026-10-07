import { beforeEach, describe, expect, it, vi } from "vitest";

const { state, mocks } = vi.hoisted(() => ({
  state: { request: {} as Record<string, unknown> },
  mocks: { expire: vi.fn(), delete: vi.fn() },
}));

vi.mock("@/auth", () => ({ auth: async () => ({ user: { id: "guest_1" } }) }));
vi.mock("@/lib/stripe", () => ({
  getStripeClient: () => ({ checkout: { sessions: { expire: mocks.expire } } }),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    bookingChangeRequest: {
      findUnique: async () => ({ ...state.request, booking: { guestId: "guest_1" } }),
      delete: mocks.delete,
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const ok = Object.entries(where).every(([key, value]) => state.request[key] === value);
        if (!ok) return { count: 0 };
        Object.assign(state.request, data);
        return { count: 1 };
      },
    },
  },
}));

import { DELETE } from "./route";

const withdraw = () =>
  DELETE(new Request("http://x", { method: "DELETE" }), { params: Promise.resolve({ id: "bk_1", requestId: "cr_1" }) });

beforeEach(() => {
  mocks.expire.mockReset().mockResolvedValue({});
  mocks.delete.mockReset();
  state.request = {
    id: "cr_1",
    bookingId: "bk_1",
    status: "APPROVED",
    paidAt: null,
    priceDeltaCents: 11_000,
    stripeSessionId: "cs_open",
  };
});

describe("withdrawing a change request", () => {
  it("lets the guest withdraw an approved change they haven't paid for, closing its payment page", async () => {
    expect((await withdraw()).status).toBe(200);
    expect(mocks.expire).toHaveBeenCalledWith("cs_open");
    // Kept (declined), so a payment that completes anyway is still refunded.
    expect(state.request.status).toBe("DECLINED");
    expect(mocks.delete).not.toHaveBeenCalled();
  });

  it("won't withdraw a change once it's been paid for", async () => {
    // The payment landed while the page was being closed.
    mocks.expire.mockImplementation(async () => {
      state.request.paidAt = new Date();
      throw new Error("already complete");
    });
    expect((await withdraw()).status).toBe(409);
    expect(state.request.status).toBe("APPROVED");
  });

  it("still deletes a request the host hasn't answered", async () => {
    Object.assign(state.request, { status: "PENDING", stripeSessionId: null });
    expect((await withdraw()).status).toBe(200);
    expect(mocks.delete).toHaveBeenCalledTimes(1);
  });

  it("won't withdraw a declined request", async () => {
    state.request.status = "DECLINED";
    expect((await withdraw()).status).toBe(409);
  });
});
