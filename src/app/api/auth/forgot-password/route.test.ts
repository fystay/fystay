import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const findUser = vi.fn();
const createToken = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: (...a: unknown[]) => findUser(...a) },
    passwordResetToken: { create: (...a: unknown[]) => createToken(...a), deleteMany: vi.fn() },
  },
}));
vi.mock("@/lib/rateLimit", () => ({
  checkRateLimit: async () => ({ allowed: true, remaining: 1, resetAt: new Date() }),
  clientIp: () => "1.2.3.4",
  rateLimitedResponse: vi.fn(),
}));
vi.mock("@/lib/email", () => ({ EMAIL_FROM: "x", getResendClient: () => null }));

import { POST } from "./route";

const req = (email: string) =>
  new Request("http://x/api/auth/forgot-password", { method: "POST", body: JSON.stringify({ email }) });

beforeEach(() => {
  findUser.mockResolvedValue({ id: "user_1", email: "real@example.com" });
  createToken.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.unstubAllEnvs());

describe("POST /api/auth/forgot-password without an email provider", () => {
  for (const env of ["production", "preview"]) {
    it(`never returns a reset link on a ${env} deployment, and reveals nothing about the account`, async () => {
      vi.stubEnv("VERCEL_ENV", env);
      const known = await (await POST(req("real@example.com"))).json();
      findUser.mockResolvedValue(null);
      const unknown = await (await POST(req("nobody@example.com"))).json();

      expect(JSON.stringify(known)).not.toMatch(/token|reset-password|resetUrl/);
      expect(known).toEqual(unknown);
      expect(createToken).not.toHaveBeenCalled();
    });
  }

  it("still returns the link locally, so the flow can be tested without email", async () => {
    vi.stubEnv("VERCEL_ENV", "");
    const body = await (await POST(req("real@example.com"))).json();
    expect(body.resetUrl).toContain("/reset-password?token=");
  });
});
