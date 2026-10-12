import { beforeEach, describe, expect, it, vi } from "vitest";

const { state, listingUpdate, eventCreate } = vi.hoisted(() => ({
  state: {
    session: null as null | { user: { id: string; role: string } },
    listing: null as null | Record<string, unknown>,
  },
  listingUpdate: vi.fn(),
  eventCreate: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: async () => state.session }));
vi.mock("@/lib/email", () => ({ getResendClient: () => null, EMAIL_FROM: "x" }));
vi.mock("@/lib/prisma", () => {
  const tx = {
    listing: { update: (args: unknown) => listingUpdate(args) },
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

const review = (body: unknown) =>
  POST(new Request("http://x", { method: "POST", body: JSON.stringify(body) }), { params: Promise.resolve({ id: "listing_1" }) });
const approve = (revision = 3) => review({ action: "approve", revision, confirmed: true });

beforeEach(() => {
  state.session = { user: { id: "host_1", role: "HOST" } };
  state.listing = {
    id: "listing_1",
    hostId: "host_1",
    hostInvitationId: null,
    preparedById: "admin_1",
    preparedBy: { email: "admin@example.test", name: "FYStay" },
    reviewStatus: "AWAITING_HOST_REVIEW",
    published: false,
    materialRevision: 3,
    title: "Lodge on the Lake",
    pricePerNightCents: 25500,
  };
  listingUpdate.mockReset();
  eventCreate.mockReset();
});

describe("POST /api/host/listings/[id]/review", () => {
  it("records the approving host, time and exact revision", async () => {
    const res = await approve();
    expect(res.status).toBe(200);
    const data = listingUpdate.mock.calls[0][0].data;
    expect(data).toMatchObject({ reviewStatus: "HOST_APPROVED", approvedRevision: 3, approvedById: "host_1" });
    expect(data.approvedAt).toBeInstanceOf(Date);
    expect(data.approvedSnapshot).toMatchObject({ title: "Lodge on the Lake", pricePerNightCents: 25500 });
    expect(eventCreate.mock.calls[0][0].data).toMatchObject({ type: "APPROVED", revision: 3, actorId: "host_1" });
  });

  it("refuses to approve a revision the host didn't see", async () => {
    const res = await approve(2);
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("stale_revision");
    expect(listingUpdate).not.toHaveBeenCalled();
  });

  it("needs an explicit confirmation", async () => {
    expect((await review({ action: "approve", revision: 3 })).status).toBe(400);
  });

  it("only the listing's own host can decide - not another host, not an admin", async () => {
    state.session = { user: { id: "host_2", role: "HOST" } };
    expect((await approve()).status).toBe(403);
    state.session = { user: { id: "admin_1", role: "ADMIN" } };
    expect((await approve()).status).toBe(403);
    expect(listingUpdate).not.toHaveBeenCalled();
  });

  it("can't approve before FYStay sends it for review, or twice", async () => {
    state.listing!.reviewStatus = "DRAFT";
    expect((await approve()).status).toBe(409);
    state.listing!.reviewStatus = "HOST_APPROVED";
    expect((await approve()).status).toBe(409);
  });

  it("records requested changes with the host's explanation", async () => {
    const res = await review({ action: "request_changes", note: "Weekend price is £275, not £255." });
    expect(res.status).toBe(200);
    expect(listingUpdate.mock.calls[0][0].data).toEqual({ reviewStatus: "CHANGES_REQUESTED" });
    expect(eventCreate.mock.calls[0][0].data).toMatchObject({ type: "CHANGES_REQUESTED", note: "Weekend price is £275, not £255." });
  });

  it("needs an explanation to request changes", async () => {
    expect((await review({ action: "request_changes", note: "" })).status).toBe(400);
  });

  it("has nothing to approve on a listing the host created", async () => {
    state.listing!.preparedById = null;
    expect((await approve()).status).toBe(409);
  });
});
