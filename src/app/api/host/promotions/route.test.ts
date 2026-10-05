import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.fn();
const listingFindUnique = vi.fn();
const promotionCreate = vi.fn();
const activate = vi.fn();

vi.mock("@/auth", () => ({ auth: () => authMock() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    listing: { findUnique: (...a: unknown[]) => listingFindUnique(...a) },
    listingPromotion: {
      findMany: async () => [],
      findFirst: async () => null,
      create: (...a: unknown[]) => promotionCreate(...a),
      update: async () => ({}),
    },
  },
}));
vi.mock("@/lib/listingPromotions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/listingPromotions")>()),
  activatePaidPromotion: (...a: unknown[]) => activate(...a),
}));
vi.mock("@/lib/listingPromotionNotifications", () => ({ notifyListingPromotionActivated: async () => {} }));

import { POST } from "./route";

const host = { user: { id: "host_1", role: "HOST" } };
const readyListing = {
  id: "listing_1",
  title: "Seafront flat",
  hostId: "host_1",
  published: true,
  suspendedAt: null,
  host: { email: "host@example.com", stripeConnectChargesEnabled: true, stripeConnectPayoutsEnabled: true },
};

const call = (body: unknown) =>
  POST(new Request("http://x/api/host/promotions", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => {
  authMock.mockReset().mockResolvedValue(host);
  listingFindUnique.mockReset().mockResolvedValue(readyListing);
  promotionCreate.mockReset().mockResolvedValue({ id: "promo_1" });
  activate.mockReset().mockResolvedValue({ id: "promo_1", startsAt: new Date(), endsAt: new Date() });
  vi.stubEnv("STRIPE_SECRET_KEY", "");
  vi.stubEnv("VERCEL_ENV", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("POST /api/host/promotions", () => {
  it("requires a signed-in host", async () => {
    authMock.mockResolvedValue(null);
    expect((await call({ listingId: "listing_1", plan: "WEEK" })).status).toBe(401);
    authMock.mockResolvedValue({ user: { id: "guest_1", role: "GUEST" } });
    expect((await call({ listingId: "listing_1", plan: "WEEK" })).status).toBe(403);
  });

  it("rejects a plan that isn't one of the server's own", async () => {
    const res = await call({ listingId: "listing_1", plan: "FREE" });
    expect(res.status).toBe(400);
    expect(promotionCreate).not.toHaveBeenCalled();
  });

  it("treats another host's listing as not found", async () => {
    listingFindUnique.mockResolvedValue({ ...readyListing, hostId: "someone_else" });
    expect((await call({ listingId: "listing_1", plan: "WEEK" })).status).toBe(404);
    expect(promotionCreate).not.toHaveBeenCalled();
  });

  it("refuses a listing guests can't book yet", async () => {
    listingFindUnique.mockResolvedValue({ ...readyListing, published: false });
    expect((await call({ listingId: "listing_1", plan: "WEEK" })).status).toBe(409);
  });

  it("refuses on a production deployment without Stripe and never activates anything", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    const res = await call({ listingId: "listing_1", plan: "WEEK" });
    expect(res.status).toBe(503);
    expect(promotionCreate).not.toHaveBeenCalled();
    expect(activate).not.toHaveBeenCalled();
  });

  it("charges the plan's own price and activates directly in development without Stripe", async () => {
    const res = await call({ listingId: "listing_1", plan: "MONTH", priceCents: 1 });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ devMode: true });
    expect(promotionCreate).toHaveBeenCalledWith({
      data: { listingId: "listing_1", hostId: "host_1", plan: "MONTH", days: 30, priceCents: 4500 },
    });
    expect(activate).toHaveBeenCalledWith(expect.anything(), "promo_1", null, expect.any(Date));
  });
});
