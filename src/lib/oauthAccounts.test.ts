import { beforeEach, describe, expect, it } from "vitest";
import { claimIsTrue, isApplePrivateRelayEmail, resolveOAuthSignIn, type OAuthSignInInput } from "./oauthAccounts";

// A small in-memory stand-in for the two Prisma models resolveOAuthSignIn
// touches, enough to check which account each sign-in lands on.
type UserRow = {
  id: string;
  email: string;
  name: string;
  image: string | null;
  passwordHash: string | null;
  suspendedAt: Date | null;
  deletedAt: Date | null;
};
type IdentityRow = { userId: string; provider: string; providerAccountId: string; email: string | null };

let users: UserRow[];
let identities: IdentityRow[];
let nextId: number;

const pick = <T extends object>(row: T | undefined) => (row ? { ...row } : null);

const db = {
  user: {
    findUnique: async ({ where }: { where: { id?: string; email?: string } }) =>
      pick(users.find((u) => (where.id ? u.id === where.id : u.email === where.email))),
    update: async ({ where, data }: { where: { id: string }; data: Partial<UserRow> }) => {
      const user = users.find((u) => u.id === where.id)!;
      Object.assign(user, data);
      return user;
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const id = `user_${nextId++}`;
      users.push({
        id,
        email: data.email as string,
        name: data.name as string,
        image: (data.image as string | null) ?? null,
        passwordHash: null,
        suspendedAt: null,
        deletedAt: null,
      });
      const nested = (data.authIdentities as { create: Omit<IdentityRow, "userId"> }).create;
      identities.push({ ...nested, userId: id });
      return { id };
    },
  },
  authIdentity: {
    findUnique: async ({
      where,
    }: {
      where: { provider_providerAccountId: { provider: string; providerAccountId: string } };
    }) => {
      const key = where.provider_providerAccountId;
      const row = identities.find((i) => i.provider === key.provider && i.providerAccountId === key.providerAccountId);
      if (!row) return null;
      const user = users.find((u) => u.id === row.userId)!;
      return { userId: row.userId, user: { suspendedAt: user.suspendedAt, deletedAt: user.deletedAt } };
    },
    findFirst: async ({ where }: { where: { userId: string; provider: string } }) =>
      pick(identities.find((i) => i.userId === where.userId && i.provider === where.provider)),
    create: async ({ data }: { data: IdentityRow }) => {
      identities.push({ ...data });
      return data;
    },
  },
  $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
} as unknown as Parameters<typeof resolveOAuthSignIn>[0];

function addUser(partial: Partial<UserRow> & { email: string }): UserRow {
  const user: UserRow = {
    id: `user_${nextId++}`,
    name: "Existing",
    image: null,
    passwordHash: null,
    suspendedAt: null,
    deletedAt: null,
    ...partial,
  };
  users.push(user);
  return user;
}

const google = (overrides: Partial<OAuthSignInInput> = {}): OAuthSignInInput => ({
  provider: "google",
  providerAccountId: "google-sub-1",
  email: "Ana@Example.com",
  emailVerified: true,
  name: "Ana Smith",
  image: "https://lh3.googleusercontent.com/a/photo",
  ...overrides,
});

beforeEach(() => {
  users = [];
  identities = [];
  nextId = 1;
});

describe("resolveOAuthSignIn", () => {
  it("creates a new account, with the identity, on a first sign-in", async () => {
    const result = await resolveOAuthSignIn(db, google());
    expect(result).toEqual({ ok: true, userId: "user_1", created: true, linked: false });
    expect(users[0]).toMatchObject({ email: "ana@example.com", name: "Ana Smith", image: expect.any(String) });
    expect(identities).toEqual([
      { userId: "user_1", provider: "google", providerAccountId: "google-sub-1", email: "ana@example.com" },
    ]);
  });

  it("signs a returning person in by their identity, never creating a second account", async () => {
    await resolveOAuthSignIn(db, google());
    const again = await resolveOAuthSignIn(db, google({ email: "changed@example.com", name: "New Name" }));
    expect(again).toEqual({ ok: true, userId: "user_1", created: false, linked: false });
    expect(users).toHaveLength(1);
    // Their own edits aren't overwritten by what the provider says now.
    expect(users[0].name).toBe("Ana Smith");
  });

  it("refuses to take over an account that signs in with a password", async () => {
    addUser({ email: "ana@example.com", passwordHash: "bcrypt-hash" });
    expect(await resolveOAuthSignIn(db, google())).toEqual({ ok: false, reason: "AccountExists" });
    expect(identities).toHaveLength(0);
    expect(users).toHaveLength(1);
  });

  it("links to an account with no password (made through the other provider) when the email is verified", async () => {
    const existing = addUser({ email: "ana@example.com", name: "Ana (edited)" });
    identities.push({ userId: existing.id, provider: "apple", providerAccountId: "apple-sub", email: "ana@example.com" });
    const result = await resolveOAuthSignIn(db, google());
    expect(result).toEqual({ ok: true, userId: existing.id, created: false, linked: true });
    expect(users[0].name).toBe("Ana (edited)");
    // A missing photo is filled in; nothing else changes.
    expect(users[0].image).toBe("https://lh3.googleusercontent.com/a/photo");
  });

  it("keeps an existing photo when linking", async () => {
    addUser({ email: "ana@example.com", image: "https://storage/own-photo.jpg" });
    await resolveOAuthSignIn(db, google());
    expect(users[0].image).toBe("https://storage/own-photo.jpg");
  });

  it("refuses an email the provider hasn't verified, or no email at all", async () => {
    expect(await resolveOAuthSignIn(db, google({ emailVerified: false }))).toEqual({
      ok: false,
      reason: "EmailUnverified",
    });
    expect(await resolveOAuthSignIn(db, google({ email: null }))).toEqual({ ok: false, reason: "EmailMissing" });
    expect(users).toHaveLength(0);
  });

  it("refuses a suspended account, by identity or by email", async () => {
    const byEmail = addUser({ email: "ana@example.com", suspendedAt: new Date() });
    expect(await resolveOAuthSignIn(db, google())).toEqual({ ok: false, reason: "Suspended" });
    identities.push({ userId: byEmail.id, provider: "google", providerAccountId: "google-sub-1", email: null });
    expect(await resolveOAuthSignIn(db, google())).toEqual({ ok: false, reason: "Suspended" });
  });

  describe("connecting from the account page (link intent)", () => {
    it("links a new identity to the signed-in account, whatever its email", async () => {
      const me = addUser({ email: "me@example.com", passwordHash: "bcrypt-hash" });
      const result = await resolveOAuthSignIn(db, google({ email: "other@gmail.com", linkToUserId: me.id }));
      expect(result).toEqual({ ok: true, userId: me.id, created: false, linked: true });
      expect(identities[0]).toMatchObject({ userId: me.id, email: "other@gmail.com" });
    });

    it("refuses an identity already connected to someone else", async () => {
      await resolveOAuthSignIn(db, google());
      const me = addUser({ email: "me@example.com", passwordHash: "bcrypt-hash" });
      expect(await resolveOAuthSignIn(db, google({ linkToUserId: me.id }))).toEqual({
        ok: false,
        reason: "AlreadyLinked",
      });
    });

    it("refuses a second Google account on the same FYStay account", async () => {
      const me = addUser({ email: "me@example.com", passwordHash: "bcrypt-hash" });
      await resolveOAuthSignIn(db, google({ linkToUserId: me.id }));
      expect(
        await resolveOAuthSignIn(db, google({ providerAccountId: "google-sub-2", linkToUserId: me.id })),
      ).toEqual({ ok: false, reason: "ProviderAlreadyConnected" });
    });
  });

  it("creates an Apple account with a private relay email and no name", async () => {
    const result = await resolveOAuthSignIn(db, {
      provider: "apple",
      providerAccountId: "001234.abcd",
      email: "x7k2p9@privaterelay.appleid.com",
      emailVerified: true,
      name: null,
      image: null,
    });
    expect(result).toMatchObject({ ok: true, created: true });
    expect(users[0]).toMatchObject({ email: "x7k2p9@privaterelay.appleid.com", name: "FYStay guest", image: null });
  });
});

describe("helpers", () => {
  it("reads Apple's string email_verified claim", () => {
    expect(claimIsTrue("true")).toBe(true);
    expect(claimIsTrue(true)).toBe(true);
    expect(claimIsTrue("false")).toBe(false);
    expect(claimIsTrue(undefined)).toBe(false);
  });

  it("recognises Apple private relay addresses", () => {
    expect(isApplePrivateRelayEmail("abc@privaterelay.appleid.com")).toBe(true);
    expect(isApplePrivateRelayEmail("abc@icloud.com")).toBe(false);
  });
});
