import { beforeEach, describe, expect, it, vi } from "vitest";

const { state, listingCreate } = vi.hoisted(() => ({
  state: { host: {} as Record<string, unknown>, stripe: false, role: "HOST" },
  listingCreate: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: async () => ({ user: { id: "host_1", role: state.role } }) }));
vi.mock("@/lib/stripe", () => ({ getStripeClient: () => (state.stripe ? {} : null) }));
vi.mock("@/lib/prisma", () => {
  const tx = {
    listing: {
      create: async (args: { data: Record<string, unknown> }) => (listingCreate(args), { id: "listing_1", city: "Nowhere", ...args.data }),
    },
    roomType: { createMany: async () => ({}) },
  };
  return {
    prisma: {
      user: { findUniqueOrThrow: async () => state.host },
      listing: { update: async () => ({}) },
      $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx),
    },
  };
});

import { POST } from "./route";

const body = {
  title: "Seafront flat",
  description: "A bright flat right on the promenade.",
  propertyType: "APARTMENT",
  city: "Nowhere",
  country: "United Kingdom",
  pricePerNightCents: 9000,
  maxGuests: 2,
  bedrooms: 1,
  beds: 1,
  bathrooms: 1,
  photos: ["https://example.test/1.jpg"],
  amenities: [],
};
const create = () => POST(new Request("http://x", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => {
  state.role = "HOST";
  state.stripe = false;
  state.host = {
    name: "Sam",
    emailVerifiedAt: new Date(),
    suspendedAt: null,
    deletedAt: null,
    stripeConnectChargesEnabled: true,
    stripeConnectPayoutsEnabled: true,
  };
  listingCreate.mockReset();
});

describe("POST /api/listings (host self-service)", () => {
  it("still lets a host create their own listing, live when every check passes", async () => {
    const res = await create();
    expect(res.status).toBe(201);
    expect(listingCreate.mock.calls[0][0].data).toMatchObject({ hostId: "host_1", published: true });
    expect((await res.json()).notice).toBeUndefined();
  });

  it("saves it hidden, and says why, when the host can't go live yet", async () => {
    state.stripe = true;
    state.host.stripeConnectPayoutsEnabled = false;
    const res = await create();
    expect(res.status).toBe(201);
    expect(listingCreate.mock.calls[0][0].data.published).toBe(false);
    expect((await res.json()).notice).toMatch(/payout setup/);
  });

  it("always makes the signed-in host the owner, whatever hostId the request sends", async () => {
    const res = await POST(new Request("http://x", { method: "POST", body: JSON.stringify({ ...body, hostId: "host_2", preparedById: "admin_1" }) }));
    expect(res.status).toBe(201);
    expect(listingCreate.mock.calls[0][0].data).toMatchObject({ hostId: "host_1" });
    expect(listingCreate.mock.calls[0][0].data.preparedById).toBeUndefined();
  });

  it("is still host-only", async () => {
    state.role = "GUEST";
    expect((await create()).status).toBe(403);
  });
});
