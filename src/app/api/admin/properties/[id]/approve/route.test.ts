import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** POST /api/admin/properties/[id]/approve: FYStay's approval of a host's own listing. */

const { state, updateMany, eventCreate, notice } = vi.hoisted(() => ({
  state: {
    session: null as null | { user: { id: string; role: "GUEST" | "HOST" | "ADMIN" } },
    listing: null as null | Record<string, unknown>,
  },
  updateMany: vi.fn(),
  eventCreate: vi.fn(),
  notice: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: async () => state.session }));
vi.mock("@/lib/stripe", () => ({ getStripeClient: () => null }));
vi.mock("@/lib/listingOnboarding", async (original) => ({
  ...(await original<typeof import("@/lib/listingOnboarding")>()),
  sendReviewNotice: notice,
}));
vi.mock("@/lib/prisma", () => {
  const tx = {
    listing: { updateMany: async (args: unknown) => (updateMany(args), { count: 1 }) },
    listingReviewEvent: { create: (args: unknown) => eventCreate(args) },
  };
  return {
    prisma: {
      listing: { findUnique: async () => state.listing },
      $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx),
    },
  };
});

import { POST } from "./route";

const approve = () => POST(new Request("http://x", { method: "POST" }), { params: Promise.resolve({ id: "listing_1" }) });

const listing = (overrides: Record<string, unknown> = {}) => ({
  id: "listing_1",
  title: "Lodge on the Lake",
  description: "A three-bedroom lodge with a deck over the water.",
  city: "Carnforth",
  photos: ["https://example.test/1.jpg"],
  pricePerNightCents: 25500,
  propertyType: "HOUSE",
  published: false,
  suspendedAt: null,
  suspendedReason: null,
  preparedById: null,
  reviewStatus: null,
  hostInvitationId: null,
  approvedRevision: null,
  materialRevision: 3,
  host: {
    id: "host_1",
    name: "Sam",
    email: "sam@example.test",
    emailVerifiedAt: new Date(),
    suspendedAt: null,
    deletedAt: null,
    stripeConnectChargesEnabled: true,
    stripeConnectPayoutsEnabled: true,
  },
  hostInvitation: null,
  ...overrides,
});

beforeEach(() => {
  vi.stubEnv("HOST_LISTING_REVIEW", "required");
  state.session = { user: { id: "admin_1", role: "ADMIN" } };
  state.listing = listing();
  for (const fn of [updateMany, eventCreate, notice]) fn.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

describe("approving a host's own listing", () => {
  it("is admin-only", async () => {
    state.session = { user: { id: "host_1", role: "HOST" } };
    expect((await approve()).status).toBe(403);
    state.session = null;
    expect((await approve()).status).toBe(401);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("approves the current revision and publishes it when nothing else stops it", async () => {
    const res = await approve();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, published: true });
    expect(updateMany.mock.calls[0][0]).toMatchObject({
      where: { id: "listing_1", approvedRevision: null },
      data: { approvedRevision: 3, approvedById: "admin_1", published: true },
    });
    expect(eventCreate.mock.calls.map(([args]) => args.data.type)).toEqual(["APPROVED", "PUBLISHED"]);
    expect(notice.mock.calls[0][1].subject).toBe("Your FYStay listing is live");
  });

  it("approves without publishing while the host still has something to finish", async () => {
    state.listing = listing({ host: { ...listing().host, emailVerifiedAt: null } });
    expect(await (await approve()).json()).toEqual({ ok: true, published: false });
    expect(updateMany.mock.calls[0][0].data).not.toHaveProperty("published");
    expect(eventCreate.mock.calls.map(([args]) => args.data.type)).toEqual(["APPROVED"]);
  });

  it("refuses a listing that isn't waiting for review", async () => {
    for (const overrides of [{ approvedRevision: 1 }, { preparedById: "admin_2", reviewStatus: "DRAFT" }]) {
      state.listing = listing(overrides);
      expect((await approve()).status).toBe(409);
    }
    vi.stubEnv("HOST_LISTING_REVIEW", "off");
    state.listing = listing();
    expect((await approve()).status).toBe(409);
    expect(updateMany).not.toHaveBeenCalled();
  });
});
