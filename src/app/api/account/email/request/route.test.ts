import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createToken = vi.fn();
vi.mock("@/auth", () => ({ auth: async () => ({ user: { id: "user_1" } }) }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUniqueOrThrow: async () => ({ email: "old@example.com", passwordHash: "hash" }),
      findUnique: async () => null,
    },
    emailChangeToken: { create: (...a: unknown[]) => createToken(...a), deleteMany: vi.fn() },
  },
}));
vi.mock("@/lib/rateLimit", () => ({
  checkRateLimit: async () => ({ allowed: true, remaining: 1, resetAt: new Date() }),
  rateLimitedResponse: vi.fn(),
}));
vi.mock("@/lib/email", () => ({ EMAIL_FROM: "x", getResendClient: () => null }));

import { POST } from "./route";

const req = () =>
  new Request("http://x/api/account/email/request", {
    method: "POST",
    body: JSON.stringify({ newEmail: "new@example.com" }),
  });

beforeEach(() => {
  createToken.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.unstubAllEnvs());

describe("POST /api/account/email/request without an email provider", () => {
  for (const env of ["production", "preview"]) {
    it(`fails safely on a ${env} deployment without returning a confirmation link`, async () => {
      vi.stubEnv("VERCEL_ENV", env);
      const res = await POST(req());
      const body = await res.json();
      expect(res.status).toBe(503);
      expect(JSON.stringify(body)).not.toMatch(/token|confirmUrl/);
      expect(createToken).not.toHaveBeenCalled();
    });
  }

  it("still returns the link locally", async () => {
    vi.stubEnv("VERCEL_ENV", "");
    const body = await (await POST(req())).json();
    expect(body.confirmUrl).toContain("token=");
  });
});
