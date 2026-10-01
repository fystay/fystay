import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const transaction = vi.fn();
vi.mock("@/auth", () => ({ auth: async () => ({ user: { id: "guest_1" } }) }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    booking: { findUnique: async () => ({ id: "booking_1", guestId: "guest_1", status: "CONFIRMED", listing: {} }) },
    extraOffering: {
      findUnique: async () => ({ id: "offer_1", priceCents: 5000, active: true, provider: { active: true } }),
    },
    $transaction: (...a: unknown[]) => transaction(...a),
  },
}));

import { POST } from "./route";

const call = () =>
  POST(
    new Request("http://x/api/bookings/booking_1/extras", {
      method: "POST",
      body: JSON.stringify({ offeringId: "offer_1" }),
    }),
    { params: Promise.resolve({ id: "booking_1" }) },
  );

beforeEach(() => {
  transaction.mockReset();
  vi.stubEnv("STRIPE_SECRET_KEY", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("POST /api/bookings/[id]/extras without Stripe", () => {
  it("refuses on a production deployment and never marks the extra paid", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    const res = await call();
    expect(res.status).toBe(503);
    expect(await res.json()).not.toHaveProperty("paid");
    expect(transaction).not.toHaveBeenCalled();
  });
});
