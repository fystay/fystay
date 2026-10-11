import { beforeEach, describe, expect, it, vi } from "vitest";
import { hashResetToken } from "@/lib/passwordReset";
import { acceptHostInvitation, canManageListing, findInvitationByToken } from "./listingOnboarding";

const token = "a".repeat(64);
const now = new Date("2026-10-11T12:00:00Z");

function fakeDb(overrides: { invitation?: Record<string, unknown> | null; user?: Record<string, unknown> | null } = {}) {
  const invitation =
    overrides.invitation === undefined
      ? { id: "inv_1", email: "pat@example.test", name: "Pat", expiresAt: new Date("2026-10-20"), acceptedAt: null, revokedAt: null }
      : overrides.invitation;
  const user =
    overrides.user === undefined
      ? { id: "user_1", email: "Pat@Example.test", role: "GUEST", emailVerifiedAt: new Date(), suspendedAt: null, deletedAt: null }
      : overrides.user;
  const calls = { userUpdate: vi.fn(), listingUpdateMany: vi.fn(), events: vi.fn() };
  const tx = {
    hostInvitation: { updateMany: async () => ({ count: 1 }) },
    user: { update: (args: unknown) => calls.userUpdate(args) },
    listing: {
      findMany: async () => [{ id: "listing_1", materialRevision: 4 }],
      updateMany: (args: unknown) => calls.listingUpdateMany(args),
    },
    listingReviewEvent: { create: (args: unknown) => calls.events(args) },
  };
  const db = {
    hostInvitation: {
      findUnique: async ({ where }: { where: { tokenHash: string } }) => (where.tokenHash === hashResetToken(token) ? invitation : null),
    },
    user: { findUnique: async () => user },
    $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx),
  };
  return { db: db as never, calls };
}

describe("finding an invitation", () => {
  it("rejects malformed, unknown, expired and used links", async () => {
    expect((await findInvitationByToken(fakeDb().db, "not-a-token", now)).status).toBe("invalid");
    expect((await findInvitationByToken(fakeDb().db, "b".repeat(64), now)).status).toBe("invalid");
    const expired = fakeDb({ invitation: { id: "i", email: "e", name: "n", expiresAt: new Date("2026-10-01"), acceptedAt: null, revokedAt: null } });
    expect((await findInvitationByToken(expired.db, token, now)).status).toBe("expired");
    const used = fakeDb({ invitation: { id: "i", email: "e", name: "n", expiresAt: new Date("2026-10-20"), acceptedAt: now, revokedAt: null } });
    expect((await findInvitationByToken(used.db, token, now)).status).toBe("accepted");
  });
});

describe("accepting an invitation", () => {
  let fake: ReturnType<typeof fakeDb>;
  beforeEach(() => {
    fake = fakeDb();
  });

  it("hands the held draft to the verified, invited account and turns hosting on", async () => {
    const result = await acceptHostInvitation(fake.db, token, "user_1", now);
    expect(result).toEqual({ ok: true, listingIds: ["listing_1"] });
    expect(fake.calls.userUpdate).toHaveBeenCalledWith({ where: { id: "user_1" }, data: { role: "HOST" } });
    expect(fake.calls.listingUpdateMany).toHaveBeenCalledWith({
      where: { hostInvitationId: "inv_1" },
      data: { hostId: "user_1", hostInvitationId: null },
    });
    expect(fake.calls.events.mock.calls[0][0].data).toMatchObject({ type: "HOST_ACCESS_GRANTED", revision: 4 });
  });

  it("never grants access to a different account", async () => {
    const other = fakeDb({ user: { id: "user_2", email: "someone@else.test", role: "GUEST", emailVerifiedAt: new Date(), suspendedAt: null, deletedAt: null } });
    expect(await acceptHostInvitation(other.db, token, "user_2", now)).toEqual({ ok: false, reason: "wrong_account" });
    expect(other.calls.listingUpdateMany).not.toHaveBeenCalled();
  });

  it("never grants access to an unverified email address", async () => {
    const unverified = fakeDb({ user: { id: "user_1", email: "pat@example.test", role: "GUEST", emailVerifiedAt: null, suspendedAt: null, deletedAt: null } });
    expect(await acceptHostInvitation(unverified.db, token, "user_1", now)).toEqual({ ok: false, reason: "email_unverified" });
    expect(unverified.calls.listingUpdateMany).not.toHaveBeenCalled();
  });

  it("keeps an admin's role when an admin accepts their own invitation", async () => {
    const admin = fakeDb({ user: { id: "user_1", email: "pat@example.test", role: "ADMIN", emailVerifiedAt: new Date(), suspendedAt: null, deletedAt: null } });
    await acceptHostInvitation(admin.db, token, "user_1", now);
    expect(admin.calls.userUpdate).not.toHaveBeenCalled();
  });
});

describe("listing management permissions", () => {
  const prepared = { hostId: "host_1", preparedById: "admin_1", hostInvitationId: null };
  const own = { hostId: "host_1", preparedById: null, hostInvitationId: null };
  it("lets the host and (for prepared listings only) admins manage", () => {
    expect(canManageListing({ user: { id: "host_1", role: "HOST" } }, own)).toBe(true);
    expect(canManageListing({ user: { id: "host_2", role: "HOST" } }, own)).toBe(false);
    expect(canManageListing({ user: { id: "admin_1", role: "ADMIN" } }, own)).toBe(false);
    expect(canManageListing({ user: { id: "admin_9", role: "ADMIN" } }, prepared)).toBe(true);
    expect(canManageListing(null, own)).toBe(false);
  });
});
