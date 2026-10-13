import Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  stripe: null as unknown,
  user: { identityVerificationStatus: "NONE", stripeIdentitySessionId: null as string | null },
  session: { user: { id: "user_1" } } as { user: { id: string } } | null,
  retrieve: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
  release: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: async () => mocks.session }));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));
vi.mock("@/lib/stripe", () => ({ getStripeClient: () => mocks.stripe }));
vi.mock("@/lib/rateLimit", () => ({
  checkRateLimit: async () => ({ allowed: true, remaining: 1, resetAt: new Date() }),
  rateLimitedResponse: vi.fn(),
  releaseRateLimitHit: (...a: unknown[]) => mocks.release(...a),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUniqueOrThrow: async () => mocks.user,
      update: (...a: unknown[]) => mocks.update(...a),
      updateMany: (...a: unknown[]) => mocks.updateMany(...a),
    },
  },
}));

import { POST } from "./route";

beforeEach(() => {
  mocks.retrieve.mockReset();
  mocks.create.mockReset().mockResolvedValue({ id: "vs_new", url: "https://verify.stripe.com/new" });
  mocks.update.mockReset();
  mocks.updateMany.mockReset();
  mocks.release.mockReset().mockResolvedValue(undefined);
  mocks.stripe = { identity: { verificationSessions: { retrieve: mocks.retrieve, create: mocks.create } } };
  mocks.user = { identityVerificationStatus: "NONE", stripeIdentitySessionId: null };
  mocks.session = { user: { id: "user_1" } };
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/account/identity/start", () => {
  it("refuses a signed-out request without touching Stripe", async () => {
    mocks.session = null;
    expect((await POST()).status).toBe(401);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("never starts a new check for someone already verified", async () => {
    mocks.user = { identityVerificationStatus: "VERIFIED", stripeIdentitySessionId: "vs_done" };
    expect((await POST()).status).toBe(409);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("ties the session to the signed-in user only - the request carries no user id to forge", async () => {
    await POST();
    expect(mocks.create.mock.calls[0][0].metadata).toEqual({ userId: "user_1" });
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: "user_1" },
      data: { stripeIdentitySessionId: "vs_new", identityVerificationStatus: "PENDING" },
    });
  });

  it("explains when Stripe isn't configured", async () => {
    mocks.stripe = null;
    const res = await POST();
    expect(res.status).toBe(501);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("creates a session and marks the account PENDING, never VERIFIED", async () => {
    const res = await POST();
    expect(await res.json()).toEqual({ url: "https://verify.stripe.com/new" });
    expect(mocks.create.mock.calls[0][0]).toMatchObject({ metadata: { userId: "user_1" } });
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: "user_1" },
      data: { stripeIdentitySessionId: "vs_new", identityVerificationStatus: "PENDING" },
    });
  });

  it("does not replace a session Stripe is still checking", async () => {
    mocks.user = { identityVerificationStatus: "PENDING", stripeIdentitySessionId: "vs_1" };
    mocks.retrieve.mockResolvedValueOnce({ id: "vs_1", status: "processing", last_error: null });
    const res = await POST();
    expect(res.status).toBe(409);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("resumes an unfinished session instead of paying for a new one", async () => {
    mocks.user = { identityVerificationStatus: "PENDING", stripeIdentitySessionId: "vs_1" };
    mocks.retrieve.mockResolvedValueOnce({ id: "vs_1", status: "requires_input", last_error: null, url: "https://verify.stripe.com/vs_1" });
    expect(await (await POST()).json()).toEqual({ url: "https://verify.stripe.com/vs_1" });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("records a verification Stripe already approved (missed webhook) instead of starting again", async () => {
    mocks.user = { identityVerificationStatus: "PENDING", stripeIdentitySessionId: "vs_1" };
    mocks.retrieve.mockResolvedValueOnce({ id: "vs_1", status: "verified", last_error: null });
    expect((await POST()).status).toBe(409);
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id: "user_1", stripeIdentitySessionId: "vs_1" },
      data: { identityVerificationStatus: "VERIFIED", identityVerifiedAt: expect.any(Date) },
    });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("says Identity is unavailable (e.g. not activated on Stripe) without changing the account", async () => {
    mocks.create.mockRejectedValueOnce(
      new Stripe.errors.StripeInvalidRequestError({ type: "invalid_request_error", message: "Identity not activated" }),
    );
    const res = await POST();
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/isn't available/);
    expect(mocks.update).not.toHaveBeenCalled();
    // Nothing was created or billed, so the attempt doesn't count toward the daily cap.
    expect(mocks.release).toHaveBeenCalledWith("identity-start:user_1");
  });

  it("says checks aren't open yet when Stripe Identity isn't activated, and logs Stripe's request id only", async () => {
    mocks.create.mockRejectedValueOnce(
      new Stripe.errors.StripePermissionError({
        type: "invalid_request_error",
        code: "identity_api_invalid_application",
        message: "Your account is not set up to use Identity.",
        requestId: "req_abc",
        statusCode: 403,
      } as Stripe.StripeRawError),
    );
    const res = await POST();
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe(
      "Identity checks aren't open on FYStay yet. Nothing was charged - please try again later.",
    );
    expect(mocks.update).not.toHaveBeenCalled();
    const logged = JSON.stringify(vi.mocked(console.error).mock.calls);
    expect(logged).toContain("identity_api_invalid_application");
    expect(logged).toContain("req_abc");
    expect(logged).not.toContain("user_1");
  });

  it("counts a session Stripe did create toward the daily cap", async () => {
    await POST();
    expect(mocks.release).not.toHaveBeenCalled();
  });
});
