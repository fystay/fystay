import { beforeEach, describe, expect, it, vi } from "vitest";

const { state, userCreate, sendEmail } = vi.hoisted(() => ({
  state: { existing: null as null | { id: string } },
  userCreate: vi.fn(),
  sendEmail: vi.fn(),
}));

vi.mock("@/lib/rateLimit", () => ({
  checkRateLimit: async () => ({ allowed: true, resetAt: new Date() }),
  clientIp: () => "127.0.0.1",
  rateLimitedResponse: () => new Response(null, { status: 429 }),
}));
vi.mock("@/lib/emailVerification", () => ({ sendVerificationEmail: sendEmail }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: async ({ where }: { where: { email?: string } }) => (where.email ? state.existing : null),
      create: async (args: { data: { email: string; name: string; role: string } }) => {
        userCreate(args);
        return { id: "u1", name: args.data.name, email: args.data.email, role: args.data.role };
      },
    },
  },
}));

import { POST } from "./route";

const signup = (overrides: Record<string, unknown> = {}) =>
  POST(
    new Request("http://x", {
      method: "POST",
      body: JSON.stringify({ name: "Sam", email: "sam@example.com", password: "longenough1", termsAccepted: true, ...overrides }),
    }),
  );

beforeEach(() => {
  state.existing = null;
  userCreate.mockReset();
  sendEmail.mockReset();
  sendEmail.mockResolvedValue({ sent: true });
});

describe("POST /api/signup", () => {
  it("creates the account, emails a confirmation link to that exact address, and says it was sent", async () => {
    const res = await signup();
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ emailSent: true });
    expect(sendEmail.mock.calls[0][1]).toMatchObject({ email: "sam@example.com" });
    // Not verified until the link is opened.
    expect(userCreate.mock.calls[0][0].data).not.toHaveProperty("emailVerifiedAt");
  });

  it("never says the email went when the provider refused or failed", async () => {
    sendEmail.mockResolvedValueOnce({ sent: false });
    expect(await (await signup()).json()).toMatchObject({ emailSent: false });
    sendEmail.mockRejectedValueOnce(new Error("provider down"));
    expect(await (await signup({ email: "other@example.com" })).json()).toMatchObject({ emailSent: false });
  });

  it("asks about a likely typo instead of creating the account", async () => {
    const res = await signup({ email: "hello@fystay.couk" });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ suggestion: "hello@fystay.co.uk" });
    expect(userCreate).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("uses the address exactly as typed once the person keeps it - never the suggestion", async () => {
    const res = await signup({ email: "sam@gmial.com", emailConfirmedAsTyped: true });
    expect(res.status).toBe(201);
    expect(userCreate.mock.calls[0][0].data.email).toBe("sam@gmial.com");
  });

  it("rejects a malformed address", async () => {
    expect((await signup({ email: "sam@example" })).status).toBe(400);
    expect(userCreate).not.toHaveBeenCalled();
  });

  it("passes a same-site return path to the email link", async () => {
    await signup({ callbackUrl: "/listings/abc" });
    expect(sendEmail.mock.calls[0][2]).toMatchObject({ next: "/listings/abc" });
  });

  it("accepts a sign-up with no return path", async () => {
    expect((await signup({ callbackUrl: null })).status).toBe(201);
  });

  it("refuses an address that already has an account", async () => {
    state.existing = { id: "u0" };
    expect((await signup()).status).toBe(409);
  });
});
