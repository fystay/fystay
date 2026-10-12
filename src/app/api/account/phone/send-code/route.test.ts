import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  configured: true,
  send: vi.fn(),
  rateLimit: vi.fn(),
  user: { phone: null as string | null, phoneVerifiedAt: null as Date | null },
}));

vi.mock("@/auth", () => ({ auth: async () => ({ user: { id: "user_1" } }) }));
vi.mock("@/lib/prisma", () => ({
  prisma: { user: { findUniqueOrThrow: async () => mocks.user } },
}));
vi.mock("@/lib/rateLimit", () => ({
  checkRateLimit: (...a: unknown[]) => mocks.rateLimit(...a),
  clientIp: () => "203.0.113.5",
  rateLimitedResponse: () => new Response(JSON.stringify({ error: "Too many attempts." }), { status: 429 }),
}));
vi.mock("@/lib/phoneVerification", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/phoneVerification")>()),
  isPhoneVerificationConfigured: () => mocks.configured,
  sendVerificationCode: (...a: unknown[]) => mocks.send(...a),
}));

import { POST } from "./route";
import { PhoneVerificationError } from "@/lib/phoneVerification";

const req = (phone: string) =>
  new Request("http://x/api/account/phone/send-code", { method: "POST", body: JSON.stringify({ phone }) });

beforeEach(() => {
  mocks.configured = true;
  mocks.send.mockReset().mockResolvedValue(undefined);
  mocks.rateLimit.mockReset().mockResolvedValue({ allowed: true, remaining: 1, resetAt: new Date() });
  mocks.user = { phone: null, phoneVerifiedAt: null };
});

describe("POST /api/account/phone/send-code", () => {
  it("says plainly when Twilio isn't configured, without sending", async () => {
    mocks.configured = false;
    const res = await POST(req("07911123456"));
    expect(res.status).toBe(501);
    expect((await res.json()).error).toMatch(/isn't switched on/);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("normalises a UK number and returns the expiry and resend timings", async () => {
    const res = await POST(req("07911 123456"));
    expect(res.status).toBe(200);
    expect(mocks.send).toHaveBeenCalledWith("+447911123456");
    expect(await res.json()).toMatchObject({ sent: true, phone: "+447911123456", expiresInSeconds: 600, resendInSeconds: 30 });
  });

  it("checks a resend cooldown and per-account, per-number and per-IP limits, none keyed by the raw number", async () => {
    await POST(req("07911123456"));
    const keys = mocks.rateLimit.mock.calls.map(([p]) => (p as { key: string }).key);
    expect(keys).toEqual([
      "phone-verify-cooldown:user_1",
      "phone-verify-send:user_1",
      expect.stringMatching(/^phone-verify-number:[0-9a-f]{32}$/),
      "phone-verify-ip:203.0.113.5",
    ]);
    expect(keys.join()).not.toContain("7911123456");
  });

  it("stops at the first limit hit without sending", async () => {
    mocks.rateLimit.mockResolvedValueOnce({ allowed: false, remaining: 0, resetAt: new Date() });
    const res = await POST(req("07911123456"));
    expect(res.status).toBe(429);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("rejects a malformed number and an already-verified one", async () => {
    expect((await POST(req("not a number"))).status).toBe(400);
    mocks.user = { phone: "+447911123456", phoneVerifiedAt: new Date() };
    expect((await POST(req("07911123456"))).status).toBe(409);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("passes on Twilio's mapped error without claiming success", async () => {
    mocks.send.mockRejectedValueOnce(new PhoneVerificationError("Too many codes sent to this number.", 429));
    const res = await POST(req("07911123456"));
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "Too many codes sent to this number." });
  });
});
