import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * PATCH /api/listings/[id] as the publication gate and host-review hook:
 * who may edit, when a listing may go live, and how FYStay's edits to an
 * approved listing send it back to the host.
 */

type Listing = Record<string, unknown> & { id: string; hostId: string };

const { state, listingUpdate, eventCreate } = vi.hoisted(() => ({
  state: {
    session: null as null | { user: { id: string; role: "GUEST" | "HOST" | "ADMIN" } },
    listing: null as null | Listing,
    host: {} as Record<string, unknown>,
    stripe: false,
  },
  listingUpdate: vi.fn(),
  eventCreate: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: async () => state.session }));
vi.mock("@/lib/stripe", () => ({ getStripeClient: () => (state.stripe ? {} : null) }));
vi.mock("@/lib/prisma", () => {
  const tx = {
    listing: {
      update: async (args: { data: Record<string, unknown> }) => {
        listingUpdate(args);
        // Like Prisma: an undefined field leaves the stored value alone.
        const defined = Object.fromEntries(Object.entries(args.data).filter(([, v]) => v !== undefined));
        return { ...state.listing, ...defined };
      },
    },
    listingReviewEvent: { create: (args: unknown) => eventCreate(args) },
  };
  return {
    prisma: {
      listing: {
        findUnique: async () => state.listing,
        findUniqueOrThrow: async () => ({ ...state.listing, host: state.host, hostInvitation: null }),
      },
      booking: { count: async () => 0 },
      roomType: { count: async () => 1 },
      $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx),
    },
  };
});

import { PATCH } from "./route";

const patch = (body: unknown) =>
  PATCH(new Request("http://x", { method: "PATCH", body: JSON.stringify(body) }), { params: Promise.resolve({ id: "listing_1" }) });

const hostSession = { user: { id: "host_1", role: "HOST" as const } };
const adminSession = { user: { id: "admin_1", role: "ADMIN" as const } };

const listing = (overrides: Record<string, unknown> = {}): Listing => ({
  id: "listing_1",
  hostId: "host_1",
  title: "Lodge on the Lake",
  description: "A three-bedroom lodge with a deck over the water.",
  propertyType: "HOUSE",
  city: "Carnforth",
  country: "United Kingdom",
  address: null,
  maxGuests: 6,
  bedrooms: 3,
  beds: 4,
  bathrooms: 2,
  photos: ["https://example.test/1.jpg"],
  amenities: [],
  pricePerNightCents: 25500,
  weekendPricePerNightCents: null,
  cleaningFeeCents: 0,
  securityDepositCents: 0,
  weeklyDiscountPercent: null,
  monthlyDiscountPercent: null,
  lastMinuteDiscountPercent: null,
  lastMinuteWindowDays: null,
  cancellationPolicy: "MODERATE",
  customCancellationCutoffDays: null,
  customCancellationRefundPercent: null,
  minNights: 1,
  maxNights: null,
  instantBook: true,
  checkInTime: null,
  checkOutTime: null,
  selfCheckIn: false,
  smokingAllowed: false,
  partiesAllowed: false,
  quietHoursStart: null,
  quietHoursEnd: null,
  additionalRules: null,
  createdAt: new Date("2026-01-01"),
  priceChangedAt: null,
  priceDropFromCents: null,
  priceDroppedAt: null,
  published: false,
  suspendedAt: null,
  suspendedReason: null,
  preparedById: null,
  reviewStatus: null,
  hostInvitationId: null,
  materialRevision: 1,
  approvedRevision: null,
  ...overrides,
});

beforeEach(() => {
  state.session = hostSession;
  state.listing = listing();
  state.host = {
    id: "host_1",
    name: "Sam",
    email: "sam@example.test",
    emailVerifiedAt: new Date(),
    suspendedAt: null,
    deletedAt: null,
    stripeConnectChargesEnabled: true,
    stripeConnectPayoutsEnabled: true,
  };
  state.stripe = false;
  listingUpdate.mockReset();
  eventCreate.mockReset();
});

describe("who may edit", () => {
  it("ignores a hostId in the request - a host can't hand their listing to anyone, or take one", async () => {
    expect((await patch({ title: "Lodge on the Lake, renamed", hostId: "host_2", preparedById: null })).status).toBe(200);
    const data = listingUpdate.mock.calls[0][0].data;
    expect(data).not.toHaveProperty("hostId");
    expect(data).not.toHaveProperty("preparedById");
  });

  it("refuses another host - one host never touches another's listing", async () => {
    state.session = { user: { id: "host_2", role: "HOST" } };
    expect((await patch({ title: "Mine now" })).status).toBe(403);
    expect(listingUpdate).not.toHaveBeenCalled();
  });

  it("refuses an admin on a listing the host created themselves", async () => {
    state.session = adminSession;
    expect((await patch({ title: "Edited by FYStay" })).status).toBe(403);
  });

  it("lets an admin edit a listing FYStay prepared", async () => {
    state.session = adminSession;
    state.listing = listing({ hostId: "host_1", preparedById: "admin_1", reviewStatus: "DRAFT" });
    expect((await patch({ title: "Lodge on the Lake, Carnforth" })).status).toBe(200);
  });

  it("refuses the host while the draft is still held for their invitation", async () => {
    state.listing = listing({ hostId: "admin_1", preparedById: "admin_1", reviewStatus: "DRAFT", hostInvitationId: "inv_1" });
    state.session = { user: { id: "admin_1", role: "HOST" } as never };
    expect((await patch({ title: "x x x" })).status).toBe(403);
  });
});

describe("saving progress on a draft", () => {
  it("lets FYStay save a prepared draft before it has photos, a description or a price", async () => {
    state.session = adminSession;
    state.listing = listing({ preparedById: "admin_1", reviewStatus: "DRAFT", photos: [], description: "", pricePerNightCents: 0 });
    expect((await patch({ photos: [], description: "", pricePerNightCents: 0 })).status).toBe(200);
  });

  it("still requires photos on a host's own listing", async () => {
    expect((await patch({ photos: [] })).status).toBe(400);
  });
});

describe("going live", () => {
  it("publishes a host's own complete listing when the host is ready", async () => {
    const res = await patch({ published: true });
    expect(res.status).toBe(200);
    expect(listingUpdate.mock.calls[0][0].data.published).toBe(true);
  });

  it("refuses while the host's email is unverified", async () => {
    state.host.emailVerifiedAt = null;
    const res = await patch({ published: true });
    expect(res.status).toBe(409);
    expect((await res.json()).blockers[0].code).toBe("host_email_unverified");
  });

  it("refuses while payouts aren't set up, wherever payments are on", async () => {
    state.stripe = true;
    state.host.stripeConnectPayoutsEnabled = false;
    const res = await patch({ published: true });
    expect(res.status).toBe(409);
    expect((await res.json()).blockers.map((b: { code: string }) => b.code)).toContain("payouts_not_ready");
  });

  it("refuses a prepared listing the host hasn't approved, whoever asks", async () => {
    state.listing = listing({ preparedById: "admin_1", reviewStatus: "AWAITING_HOST_REVIEW" });
    expect((await patch({ published: true })).status).toBe(409);
    state.session = adminSession;
    expect((await patch({ published: true })).status).toBe(409);
    expect(listingUpdate).not.toHaveBeenCalled();
  });

  it("publishes an approved, ready prepared listing and records it", async () => {
    state.session = adminSession;
    state.listing = listing({ preparedById: "admin_1", reviewStatus: "HOST_APPROVED", approvedRevision: 1 });
    expect((await patch({ published: true })).status).toBe(200);
    expect(eventCreate.mock.calls.map((c) => c[0].data.type)).toEqual(["PUBLISHED"]);
  });
});

describe("approval after material changes", () => {
  const approvedLive = () =>
    listing({ preparedById: "admin_1", reviewStatus: "HOST_APPROVED", approvedRevision: 1, published: true });

  it("sends FYStay's material change back to the host and takes the listing down", async () => {
    state.session = adminSession;
    state.listing = approvedLive();
    const res = await patch({ pricePerNightCents: 30000 });
    expect(res.status).toBe(200);
    const data = listingUpdate.mock.calls[0][0].data;
    expect(data.reviewStatus).toBe("AWAITING_HOST_REVIEW");
    expect(data.published).toBe(false);
    expect(data.materialRevision).toBe(2);
    expect(eventCreate.mock.calls.map((c) => c[0].data.type)).toEqual(["APPROVAL_INVALIDATED", "UNPUBLISHED"]);
    expect((await res.json()).notice).toMatch(/Nightly price/);
  });

  it("keeps the approval for FYStay's typo fix", async () => {
    state.session = adminSession;
    state.listing = approvedLive();
    await patch({ description: "A three-bedroom lodge with a deck over the watter." });
    const data = listingUpdate.mock.calls[0][0].data;
    expect(data.reviewStatus).toBeUndefined();
    expect(data.materialRevision).toBe(1);
    expect(eventCreate).not.toHaveBeenCalled();
  });

  it("doesn't reset the host's approval for their own edits", async () => {
    state.listing = approvedLive();
    await patch({ pricePerNightCents: 30000 });
    const data = listingUpdate.mock.calls[0][0].data;
    expect(data.reviewStatus).toBeUndefined();
    expect(data.published).toBeUndefined();
    expect(data.materialRevision).toBe(2);
  });
});

describe("FYStay review of a host's own listing", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("won't let the host publish it until FYStay approves it, where review is required", async () => {
    vi.stubEnv("HOST_LISTING_REVIEW", "required");
    const res = await patch({ published: true });
    expect(res.status).toBe(409);
    expect((await res.json()).blockers.map((b: { code: string }) => b.code)).toEqual(["awaiting_fystay_review"]);
    expect(listingUpdate).not.toHaveBeenCalled();
  });

  it("lets it go live once approved", async () => {
    vi.stubEnv("HOST_LISTING_REVIEW", "required");
    state.listing = listing({ approvedRevision: 1 });
    expect((await patch({ published: true })).status).toBe(200);
    expect(listingUpdate.mock.calls[0][0].data.published).toBe(true);
  });
});

describe("house-rule times and stay length", () => {
  it("saves a picker time", async () => {
    expect((await patch({ checkInTime: "15:00", checkOutTime: "11:00" })).status).toBe(200);
    expect(listingUpdate.mock.calls[0][0].data).toMatchObject({ checkInTime: "15:00", checkOutTime: "11:00" });
  });

  it("refuses new free text, with a message the host can act on", async () => {
    const res = await patch({ checkInTime: "3pm" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/like 15:00/);
  });

  it("accepts an older free-text time re-sent exactly as saved", async () => {
    state.listing = listing({ checkInTime: "After 3pm" });
    expect((await patch({ checkInTime: "After 3pm", title: "Lodge on the Lake, renamed" })).status).toBe(200);
  });

  it("accepts overnight quiet hours, but not the same start and end", async () => {
    expect((await patch({ quietHoursStart: "22:00", quietHoursEnd: "07:00" })).status).toBe(200);
    expect((await patch({ quietHoursStart: "22:00", quietHoursEnd: "22:00" })).status).toBe(400);
  });

  it("checks one quiet-hours end against the saved other end", async () => {
    expect((await patch({ quietHoursStart: "22:00" })).status).toBe(400);
    state.listing = listing({ quietHoursStart: "22:00" });
    expect((await patch({ quietHoursEnd: "07:00" })).status).toBe(200);
  });

  it("refuses a maximum stay shorter than the saved minimum", async () => {
    state.listing = listing({ minNights: 7 });
    expect((await patch({ maxNights: 3 })).status).toBe(400);
  });
});
