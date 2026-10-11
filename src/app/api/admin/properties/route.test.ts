import { beforeEach, describe, expect, it, vi } from "vitest";

const { state, listingCreate, invitationCreate, eventCreate } = vi.hoisted(() => ({
  state: {
    session: null as null | { user: { id: string; role: string } },
    user: null as null | { id: string; role: string; suspendedAt: Date | null; deletedAt: Date | null },
  },
  listingCreate: vi.fn(),
  invitationCreate: vi.fn(),
  eventCreate: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: async () => state.session }));
vi.mock("@/lib/prisma", () => {
  const tx = {
    listing: { create: async (args: unknown) => (listingCreate(args), { id: "listing_1", materialRevision: 1 }) },
    listingReviewEvent: { create: (args: unknown) => eventCreate(args) },
  };
  return {
    prisma: {
      user: { findUnique: async () => state.user },
      hostInvitation: { create: async (args: unknown) => (invitationCreate(args), { id: "inv_1" }) },
      $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx),
    },
  };
});

import { POST } from "./route";

const create = (body: unknown) => POST(new Request("http://x", { method: "POST", body: JSON.stringify(body) }));
const property = { title: "Lodge on the Lake", city: "Carnforth", propertyType: "HOUSE" };
const invite = {
  kind: "invite",
  name: "Pat Owner",
  email: "Pat@Example.test",
  consentNote: "Phone call with the owner on 9 October, who asked us to list it",
};

beforeEach(() => {
  state.session = { user: { id: "admin_1", role: "ADMIN" } };
  state.user = { id: "host_1", role: "HOST", suspendedAt: null, deletedAt: null };
  listingCreate.mockReset();
  invitationCreate.mockReset();
  eventCreate.mockReset();
});

describe("POST /api/admin/properties", () => {
  it("is admin-only", async () => {
    state.session = null;
    expect((await create({ ...property, host: invite })).status).toBe(401);
    state.session = { user: { id: "host_1", role: "HOST" } };
    expect((await create({ ...property, host: invite })).status).toBe(403);
    expect(listingCreate).not.toHaveBeenCalled();
  });

  it("starts a private draft assigned to an existing host", async () => {
    expect((await create({ ...property, host: { kind: "existing", userId: "host_1" } })).status).toBe(201);
    const data = listingCreate.mock.calls[0][0].data;
    expect(data).toMatchObject({ hostId: "host_1", preparedById: "admin_1", reviewStatus: "DRAFT", published: false, hostInvitationId: null });
    expect(eventCreate.mock.calls[0][0].data).toMatchObject({ type: "PREPARED", actorId: "admin_1" });
  });

  it("won't assign a draft to a non-host account - they must accept an invitation themselves", async () => {
    state.user = { id: "guest_1", role: "GUEST", suspendedAt: null, deletedAt: null };
    expect((await create({ ...property, host: { kind: "existing", userId: "guest_1" } })).status).toBe(409);
    expect(listingCreate).not.toHaveBeenCalled();
  });

  it("holds an invited owner's draft without creating any account for them", async () => {
    expect((await create({ ...property, host: invite })).status).toBe(201);
    expect(invitationCreate.mock.calls[0][0].data).toMatchObject({ email: "pat@example.test", invitedById: "admin_1" });
    expect(listingCreate.mock.calls[0][0].data).toMatchObject({ hostId: "admin_1", hostInvitationId: "inv_1", published: false });
  });

  it("requires a record of how the owner agreed to be contacted", async () => {
    const res = await create({ ...property, host: { ...invite, consentNote: "" } });
    expect(res.status).toBe(400);
    expect(invitationCreate).not.toHaveBeenCalled();
  });
});
