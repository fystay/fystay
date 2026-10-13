import { beforeEach, describe, expect, it, vi } from "vitest";

const { state, sendEmail } = vi.hoisted(() => ({
  state: {
    user: null as null | { id: string; email: string; name: string; emailVerifiedAt: Date | null; deletedAt: Date | null },
    limited: new Set<string>(),
  },
  sendEmail: vi.fn(),
}));

vi.mock("@/lib/rateLimit", () => ({
  checkRateLimit: async ({ key }: { key: string }) => ({ allowed: !state.limited.has(key.split(":")[0]), resetAt: new Date(Date.now() + 60_000) }),
  clientIp: () => "127.0.0.1",
  rateLimitedResponse: () => new Response(JSON.stringify({ error: "Too many attempts." }), { status: 429 }),
}));
vi.mock("@/lib/emailVerification", () => ({ sendVerificationEmail: sendEmail }));
vi.mock("@/lib/prisma", () => ({ prisma: { user: { findUnique: async () => state.user } } }));

import { POST } from "./route";

const resend = (body: unknown) => POST(new Request("http://x", { method: "POST", body: JSON.stringify(body) }));
const unverified = { id: "u1", email: "sam@example.com", name: "Sam", emailVerifiedAt: null, deletedAt: null };

beforeEach(() => {
  state.user = unverified;
  state.limited.clear();
  sendEmail.mockReset();
  sendEmail.mockResolvedValue({ sent: true });
});

describe("POST /api/auth/verify-email/resend (signed out)", () => {
  it("sends a new link to an unconfirmed account", async () => {
    const res = await resend({ email: "Sam@Example.com" });
    expect(res.status).toBe(200);
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it("answers the same whether or not the address has an account waiting", async () => {
    const sent = await (await resend({ email: "sam@example.com" })).json();
    state.user = null;
    const none = await (await resend({ email: "nobody@example.com" })).json();
    state.user = { ...unverified, emailVerifiedAt: new Date() };
    const verified = await (await resend({ email: "sam@example.com" })).json();
    expect(none).toEqual(sent);
    expect(verified).toEqual(sent);
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it("says so when the provider refused - never a false 'sent'", async () => {
    sendEmail.mockResolvedValueOnce({ sent: false });
    const res = await resend({ email: "sam@example.com" });
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/couldn't send/);
  });

  it("is rate limited per address and per IP", async () => {
    state.limited.add("verify-email");
    expect((await resend({ email: "sam@example.com" })).status).toBe(429);
    state.limited.clear();
    state.limited.add("verify-email-ip");
    expect((await resend({ email: "sam@example.com" })).status).toBe(429);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("needs an email address", async () => {
    expect((await resend({})).status).toBe(400);
  });
});
