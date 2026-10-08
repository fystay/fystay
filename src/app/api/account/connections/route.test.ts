import bcrypt from "bcryptjs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { state, cookieSet, deleteMany } = vi.hoisted(() => ({
  state: {
    passwordHash: null as string | null,
    emailVerified: true,
    identities: [] as { provider: string }[],
    providers: { google: true, apple: true },
  },
  cookieSet: vi.fn(),
  deleteMany: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: async () => ({ user: { id: "user_1" } }) }));
vi.mock("next/headers", () => ({ cookies: async () => ({ set: cookieSet }) }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUniqueOrThrow: async () => ({
        passwordHash: state.passwordHash,
        emailVerifiedAt: state.emailVerified ? new Date("2026-01-01") : null,
        authIdentities: state.identities,
      }),
    },
    authIdentity: { deleteMany: (...a: unknown[]) => deleteMany(...a) },
  },
}));
vi.mock("@/lib/rateLimit", () => ({
  checkRateLimit: async () => ({ allowed: true, remaining: 1, resetAt: new Date() }),
  rateLimitedResponse: vi.fn(),
}));
vi.mock("@/lib/authProviders", () => ({ enabledSocialProviders: () => state.providers }));

import { DELETE, POST } from "./route";
import { LINK_INTENT_COOKIE, verifyLinkIntent } from "@/lib/oauthLinkIntent";

const req = (method: string, body: object) =>
  new Request("http://x/api/account/connections", { method, body: JSON.stringify(body) });

beforeEach(() => {
  cookieSet.mockReset();
  deleteMany.mockReset();
  state.passwordHash = bcrypt.hashSync("right-password", 4);
  state.emailVerified = true;
  state.identities = [];
  state.providers = { google: true, apple: true };
  vi.stubEnv("AUTH_SECRET", "test-secret");
});

describe("POST /api/account/connections (connect)", () => {
  it("sets a signed link intent for this user and provider after the right password", async () => {
    const res = await POST(req("POST", { provider: "google", currentPassword: "right-password" }));
    expect(res.status).toBe(200);
    const [name, value, options] = cookieSet.mock.calls[0];
    expect(name).toBe(LINK_INTENT_COOKIE);
    expect(verifyLinkIntent(value, "google", "test-secret")).toBe("user_1");
    expect(options).toMatchObject({ httpOnly: true, path: "/" });
  });

  it("refuses to connect Google/Apple until the email address is verified", async () => {
    state.emailVerified = false;
    const res = await POST(req("POST", { provider: "google", currentPassword: "right-password" }));
    expect(res.status).toBe(403);
  });

  it("refuses a wrong or missing password", async () => {
    expect((await POST(req("POST", { provider: "google", currentPassword: "nope" }))).status).toBe(400);
    expect((await POST(req("POST", { provider: "google" }))).status).toBe(400);
    expect(cookieSet).not.toHaveBeenCalled();
  });

  it("needs no password for an account that doesn't have one", async () => {
    state.passwordHash = null;
    state.identities = [{ provider: "apple" }];
    expect((await POST(req("POST", { provider: "google" }))).status).toBe(200);
  });

  it("refuses a provider that isn't switched on, or is already connected", async () => {
    state.providers = { google: true, apple: false };
    expect((await POST(req("POST", { provider: "apple", currentPassword: "right-password" }))).status).toBe(400);
    state.identities = [{ provider: "google" }];
    expect((await POST(req("POST", { provider: "google", currentPassword: "right-password" }))).status).toBe(409);
    expect(cookieSet).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/account/connections (disconnect)", () => {
  it("disconnects with the password", async () => {
    state.identities = [{ provider: "google" }];
    const res = await DELETE(req("DELETE", { provider: "google", currentPassword: "right-password" }));
    expect(res.status).toBe(200);
    expect(deleteMany).toHaveBeenCalledWith({ where: { userId: "user_1", provider: "google" } });
  });

  it("never removes the last way into a passwordless account", async () => {
    state.passwordHash = null;
    state.identities = [{ provider: "google" }];
    const res = await DELETE(req("DELETE", { provider: "google" }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/Add a password first/);
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it("lets a passwordless account drop one of two providers", async () => {
    state.passwordHash = null;
    state.identities = [{ provider: "google" }, { provider: "apple" }];
    expect((await DELETE(req("DELETE", { provider: "apple" }))).status).toBe(200);
  });
});
