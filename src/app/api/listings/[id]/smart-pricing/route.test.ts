import { beforeEach, describe, expect, it, vi } from "vitest";

const { state, update } = vi.hoisted(() => ({
  state: {
    session: { user: { id: "host_1", role: "HOST" } } as { user: { id: string; role: string } } | null,
    listing: {} as Record<string, unknown>,
  },
  update: vi.fn(async (args: { data: Record<string, unknown> }) => args.data),
}));

vi.mock("@/auth", () => ({ auth: async () => state.session }));
vi.mock("@/lib/prisma", () => ({
  prisma: { listing: { findUnique: async () => state.listing, update } },
}));

import { PUT } from "./route";

const put = (body: object) =>
  PUT(new Request("http://x", { method: "PUT", body: JSON.stringify(body) }), { params: Promise.resolve({ id: "listing_1" }) });

const settings = {
  enabled: true,
  autoApply: true,
  consent: true,
  minPayoutCents: 8_000,
  targetPayoutCents: 9_000,
  minPriceCents: 9_000,
  maxPriceCents: 12_000,
  maxAdjustmentPercent: 10,
};

beforeEach(() => {
  update.mockClear();
  state.session = { user: { id: "host_1", role: "HOST" } };
  state.listing = {
    id: "listing_1",
    hostId: "host_1",
    hostInvitationId: null,
    preparedById: null,
    propertyType: "APARTMENT",
    pricePerNightCents: 10_000,
    weekendPricePerNightCents: null,
    smartPricingEnabled: false,
    smartPricingConsentAt: null,
    smartPricingConsentPolicyVersion: null,
  };
});

describe("PUT /api/listings/[id]/smart-pricing", () => {
  it("lets the host turn it on with consent, recording when and to which policy version they agreed", async () => {
    const res = await put(settings);
    expect(res.status).toBe(200);
    const data = update.mock.calls[0][0].data;
    expect(data).toMatchObject({ smartPricingEnabled: true, smartPricingConsentPolicyVersion: "dynamic-v1", smartPricingMinPayoutCents: 8_000, smartPricingMaxPriceCents: 12_000 });
    expect(data.smartPricingConsentAt).toBeInstanceOf(Date);
  });

  it("asks again when the policy changed since the host agreed, and keeps an agreement to the current one", async () => {
    state.listing = { ...state.listing, smartPricingEnabled: true, smartPricingConsentAt: new Date("2026-10-01"), smartPricingConsentPolicyVersion: "dynamic-v0" };
    expect((await put({ ...settings, consent: undefined })).status).toBe(400);
    expect((await put(settings)).status).toBe(200);
    expect(update.mock.calls[0][0].data.smartPricingConsentPolicyVersion).toBe("dynamic-v1");
    update.mockClear();
    const agreed = new Date("2026-10-02");
    state.listing = { ...state.listing, smartPricingConsentAt: agreed, smartPricingConsentPolicyVersion: "dynamic-v1" };
    expect((await put({ ...settings, consent: undefined })).status).toBe(200);
    expect(update.mock.calls[0][0].data).toMatchObject({ smartPricingConsentAt: agreed, smartPricingConsentPolicyVersion: "dynamic-v1" });
  });

  it("refuses to turn it on without consent", async () => {
    const res = await put({ ...settings, consent: false });
    expect(res.status).toBe(400);
    expect(update).not.toHaveBeenCalled();
  });

  it("refuses anyone but the listing's host - including an admin", async () => {
    state.session = null;
    expect((await put(settings)).status).toBe(401);
    state.session = { user: { id: "other_host", role: "HOST" } };
    expect((await put(settings)).status).toBe(403);
    state.session = { user: { id: "admin_1", role: "ADMIN" } };
    state.listing = { ...state.listing, preparedById: "admin_1" };
    expect((await put(settings)).status).toBe(403);
    expect(update).not.toHaveBeenCalled();
  });

  it.each([
    // £100 a night pays at most £92 (FYStay's lowest commission is 8%).
    [{ minPayoutCents: 9_300, targetPayoutCents: null }, /what your own price pays you at FYStay's lowest commission \(£92 a night\)/],
    [{ minPriceCents: 13_000 }, /lowest nightly price can't be above the highest/],
    [{ maxAdjustmentPercent: 50 }, /between 0% and 15%/],
    [{ minPayoutCents: 0 }, /Too small|greater than 0|positive/i],
    [{ minPayoutCents: null }, /Set the minimum/],
  ])("validates %o on the server", async (change, message) => {
    const res = await put({ ...settings, ...change });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(message);
    expect(update).not.toHaveBeenCalled();
  });

  it("turns it off and forgets the consent, so turning it on again asks again", async () => {
    state.listing = { ...state.listing, smartPricingEnabled: true, smartPricingConsentAt: new Date("2026-10-01") };
    expect((await put({ ...settings, enabled: false, consent: undefined })).status).toBe(200);
    expect(update.mock.calls[0][0].data).toMatchObject({ smartPricingEnabled: false, smartPricingConsentAt: null, smartPricingConsentPolicyVersion: null });
  });

  it("isn't offered for hotels", async () => {
    state.listing = { ...state.listing, propertyType: "HOTEL" };
    expect((await put(settings)).status).toBe(400);
  });
});
