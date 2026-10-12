import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  configured: true,
  check: vi.fn(),
  update: vi.fn(),
  allowed: true,
}));

vi.mock("@/auth", () => ({ auth: async () => ({ user: { id: "user_1" } }) }));
vi.mock("@/lib/prisma", () => ({ prisma: { user: { update: (...a: unknown[]) => mocks.update(...a) } } }));
vi.mock("@/lib/rateLimit", () => ({
  checkRateLimit: async () => ({ allowed: mocks.allowed, remaining: 1, resetAt: new Date() }),
  rateLimitedResponse: () => new Response("{}", { status: 429 }),
}));
vi.mock("@/lib/phoneVerification", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/phoneVerification")>()),
  isPhoneVerificationConfigured: () => mocks.configured,
  checkVerificationCode: (...a: unknown[]) => mocks.check(...a),
}));

import { POST } from "./route";

const req = (body: unknown) =>
  new Request("http://x/api/account/phone/verify-code", { method: "POST", body: JSON.stringify(body) });

beforeEach(() => {
  mocks.configured = true;
  mocks.allowed = true;
  mocks.check.mockReset();
  mocks.update.mockReset();
});

describe("POST /api/account/phone/verify-code", () => {
  it("marks the number verified only when Twilio approves the code", async () => {
    mocks.check.mockResolvedValueOnce("approved");
    const res = await POST(req({ phone: "+447911123456", code: "123456" }));
    expect(res.status).toBe(200);
    expect(mocks.check).toHaveBeenCalledWith("+447911123456", "123456");
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: "user_1" },
      data: { phone: "+447911123456", phoneVerifiedAt: expect.any(Date) },
    });
  });

  for (const [result, status] of [
    ["incorrect", 400],
    ["expired", 410],
    ["too_many_attempts", 429],
    ["unavailable", 502],
  ] as const) {
    it(`does not verify when the code is ${result}`, async () => {
      mocks.check.mockResolvedValueOnce(result);
      const res = await POST(req({ phone: "+447911123456", code: "123456" }));
      expect(res.status).toBe(status);
      expect((await res.json()).reason).toBe(result);
      expect(mocks.update).not.toHaveBeenCalled();
    });
  }

  it("rejects a non-numeric code without asking Twilio", async () => {
    const res = await POST(req({ phone: "+447911123456", code: "12ab56" }));
    expect(res.status).toBe(400);
    expect(mocks.check).not.toHaveBeenCalled();
  });

  it("is rate limited and refuses when Twilio isn't configured", async () => {
    mocks.allowed = false;
    expect((await POST(req({ phone: "+447911123456", code: "123456" }))).status).toBe(429);
    mocks.configured = false;
    expect((await POST(req({ phone: "+447911123456", code: "123456" }))).status).toBe(501);
    expect(mocks.check).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
