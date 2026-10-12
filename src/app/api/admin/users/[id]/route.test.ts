import { beforeEach, describe, expect, it, vi } from "vitest";

const { state, anonymize, auditCreate } = vi.hoisted(() => ({
  state: {
    session: null as null | { user: { id: string; role: string } },
    user: null as null | { id: string; role: string; deletedAt: Date | null },
    blocks: [] as string[],
  },
  anonymize: vi.fn(),
  auditCreate: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: async () => state.session }));
vi.mock("@/lib/adminUserLookup", () => ({ getUserDetailForAdmin: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: { user: { findUnique: async () => state.user }, adminAuditEvent: { create: auditCreate } },
}));
vi.mock("@/lib/accountDeletion", async (original) => ({
  ...(await original<typeof import("@/lib/accountDeletion")>()),
  findAccountDeletionBlocks: async () => state.blocks,
  anonymizeAccount: anonymize,
}));

import { DELETE } from "./route";

const remove = (body: unknown, id = "user_1") =>
  DELETE(new Request("http://x", { method: "DELETE", body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });

beforeEach(() => {
  state.session = { user: { id: "admin_1", role: "ADMIN" } };
  state.user = { id: "user_1", role: "GUEST", deletedAt: null };
  state.blocks = [];
  anonymize.mockReset();
  auditCreate.mockReset();
});

describe("DELETE /api/admin/users/[id]", () => {
  it("is admin-only", async () => {
    state.session = { user: { id: "host_1", role: "HOST" } };
    expect((await remove({ confirm: "DELETE" })).status).toBe(403);
    state.session = null;
    expect((await remove({ confirm: "DELETE" })).status).toBe(401);
    expect(anonymize).not.toHaveBeenCalled();
  });

  it("needs DELETE typed as confirmation", async () => {
    expect((await remove({})).status).toBe(400);
    expect((await remove({ confirm: "delete" })).status).toBe(400);
    expect(anonymize).not.toHaveBeenCalled();
  });

  it("never deletes an admin, or the admin's own account", async () => {
    state.user = { id: "admin_2", role: "ADMIN", deletedAt: null };
    expect((await remove({ confirm: "DELETE" }, "admin_2")).status).toBe(400);
    expect(anonymize).not.toHaveBeenCalled();
  });

  it("refuses while bookings, listings or payouts still need the account", async () => {
    state.blocks = ["listings_still_exist"];
    const res = await remove({ confirm: "DELETE" });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/listings/);
    expect(anonymize).not.toHaveBeenCalled();
  });

  it("anonymizes the account in place and records who did it", async () => {
    expect((await remove({ confirm: "DELETE", reason: "Fraud" })).status).toBe(200);
    expect(anonymize).toHaveBeenCalledWith(expect.anything(), "user_1");
    expect(auditCreate.mock.calls[0][0].data).toMatchObject({ actorId: "admin_1", action: "USER_DELETED", targetUserId: "user_1", note: "Fraud" });
  });
});
