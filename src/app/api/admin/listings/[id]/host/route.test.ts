import { beforeEach, describe, expect, it, vi } from "vitest";

const { state, listingUpdate, auditCreate, invitationUpdate } = vi.hoisted(() => ({
  state: {
    session: null as null | { user: { id: string; role: string } },
    listing: null as null | Record<string, unknown>,
    user: null as null | Record<string, unknown>,
    bookings: 0,
    conversations: 0,
    pms: 0,
  },
  listingUpdate: vi.fn(),
  auditCreate: vi.fn(),
  invitationUpdate: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: async () => state.session }));
vi.mock("@/lib/prisma", () => {
  const tx = {
    listing: { update: listingUpdate },
    adminAuditEvent: { create: auditCreate },
    hostInvitation: { updateMany: invitationUpdate },
  };
  return {
    prisma: {
      listing: { findUnique: async () => state.listing },
      user: { findUnique: async () => state.user, findFirst: async () => state.user },
      booking: { count: async () => state.bookings },
      conversation: { count: async () => state.conversations },
      pmsRoomMapping: { count: async () => state.pms },
      $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx),
    },
  };
});

import { PUT } from "./route";

const assign = (body: unknown) =>
  PUT(new Request("http://x", { method: "PUT", body: JSON.stringify(body) }), { params: Promise.resolve({ id: "listing_1" }) });

beforeEach(() => {
  state.session = { user: { id: "admin_1", role: "ADMIN" } };
  state.listing = { id: "listing_1", hostId: "host_old", hostInvitationId: null, preparedById: "admin_1", host: { name: "Old Host" } };
  state.user = { id: "host_new", name: "New Host", role: "HOST", suspendedAt: null, deletedAt: null };
  state.bookings = 0;
  state.conversations = 0;
  state.pms = 0;
  listingUpdate.mockReset();
  auditCreate.mockReset();
  invitationUpdate.mockReset();
});

describe("PUT /api/admin/listings/[id]/host", () => {
  it("never lets a host assign a listing - to themselves or anyone else", async () => {
    state.session = { user: { id: "host_new", role: "HOST" } };
    expect((await assign({ hostId: "host_new" })).status).toBe(403);
    state.session = { user: { id: "guest_1", role: "GUEST" } };
    expect((await assign({ hostId: "guest_1" })).status).toBe(403);
    state.session = null;
    expect((await assign({ hostId: "host_new" })).status).toBe(401);
    expect(listingUpdate).not.toHaveBeenCalled();
  });

  it("transfers to a host, unpublished and back to draft, with an admin record", async () => {
    expect((await assign({ hostEmail: "new@example.test", note: "Owner sold the flat" })).status).toBe(200);
    const data = listingUpdate.mock.calls[0][0].data;
    expect(data).toMatchObject({ hostId: "host_new", hostInvitationId: null, published: false, icalImportUrl: null, reviewStatus: "DRAFT" });
    expect(data.icalExportToken).toEqual(expect.any(String));
    expect(auditCreate.mock.calls[0][0].data).toMatchObject({ actorId: "admin_1", action: "LISTING_ASSIGNED", targetListingId: "listing_1" });
  });

  it("revokes a pending owner invitation when the listing goes to someone else", async () => {
    state.listing = { ...state.listing, hostId: "admin_1", hostInvitationId: "inv_1" };
    expect((await assign({ hostId: "host_new" })).status).toBe(200);
    expect(invitationUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: "inv_1" }) }));
  });

  it("only assigns to an active host account", async () => {
    state.user = { ...state.user, role: "GUEST" };
    expect((await assign({ hostId: "host_new" })).status).toBe(409);
    state.user = { id: "host_new", name: "New Host", role: "HOST", suspendedAt: new Date(), deletedAt: null };
    expect((await assign({ hostId: "host_new" })).status).toBe(409);
    state.user = null;
    expect((await assign({ hostId: "nobody" })).status).toBe(404);
    expect(listingUpdate).not.toHaveBeenCalled();
  });

  it("refuses while upcoming bookings, guest threads or a PMS tie it to the current host", async () => {
    for (const key of ["bookings", "conversations", "pms"] as const) {
      state[key] = 1;
      expect((await assign({ hostId: "host_new" })).status).toBe(409);
      state[key] = 0;
    }
    expect(listingUpdate).not.toHaveBeenCalled();
  });
});
