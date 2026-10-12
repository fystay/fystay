import type Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";
import { identityStateFromSession, syncIdentityVerification } from "./identity";

const vs = (status: string, lastErrorCode?: string) =>
  ({ id: "vs_1", status, last_error: lastErrorCode ? { code: lastErrorCode } : null }) as unknown as Stripe.Identity.VerificationSession;

describe("identityStateFromSession", () => {
  it("is VERIFIED only when Stripe says verified", () => {
    expect(identityStateFromSession(vs("verified")).status).toBe("VERIFIED");
    for (const status of ["processing", "requires_input", "canceled"]) {
      expect(identityStateFromSession(vs(status)).status).not.toBe("VERIFIED");
    }
  });

  it("keeps an opened-but-unsubmitted session PENDING and a submitted one processing", () => {
    expect(identityStateFromSession(vs("requires_input"))).toEqual({ status: "PENDING", processing: false, failureReason: null });
    expect(identityStateFromSession(vs("processing"))).toEqual({ status: "PENDING", processing: true, failureReason: null });
  });

  it("marks a failed check FAILED with a plain reason, and a cancelled one FAILED", () => {
    const failed = identityStateFromSession(vs("requires_input", "document_expired"));
    expect(failed.status).toBe("FAILED");
    expect(failed.failureReason).toMatch(/expired/);
    expect(identityStateFromSession(vs("requires_input", "something_new")).failureReason).toBeNull();
    expect(identityStateFromSession(vs("canceled")).status).toBe("FAILED");
  });
});

describe("syncIdentityVerification", () => {
  const setup = (session: Stripe.Identity.VerificationSession | Error) => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const retrieve = session instanceof Error ? vi.fn().mockRejectedValue(session) : vi.fn().mockResolvedValue(session);
    const stripe = { identity: { verificationSessions: { retrieve } } } as unknown as Stripe;
    return { prisma: { user: { updateMany } } as never, stripe, updateMany, retrieve };
  };
  const user = { id: "user_1", identityVerificationStatus: "PENDING" as const, stripeIdentitySessionId: "vs_1" };

  it("applies Stripe's verified result to the row still on that session", async () => {
    const { prisma, stripe, updateMany } = setup(vs("verified"));
    expect((await syncIdentityVerification(prisma, stripe, user)).status).toBe("VERIFIED");
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "user_1", stripeIdentitySessionId: "vs_1" },
      data: { identityVerificationStatus: "VERIFIED", identityVerifiedAt: expect.any(Date) },
    });
  });

  it("writes nothing while the status is unchanged", async () => {
    const { prisma, stripe, updateMany } = setup(vs("processing"));
    expect(await syncIdentityVerification(prisma, stripe, user)).toMatchObject({ status: "PENDING", processing: true });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("keeps the stored status if Stripe can't be reached", async () => {
    const { prisma, stripe, updateMany } = setup(new Error("Stripe down"));
    expect((await syncIdentityVerification(prisma, stripe, user)).status).toBe("PENDING");
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("doesn't call Stripe for verified or never-started accounts", async () => {
    const { prisma, stripe, retrieve } = setup(vs("verified"));
    await syncIdentityVerification(prisma, stripe, { ...user, identityVerificationStatus: "VERIFIED" });
    await syncIdentityVerification(prisma, stripe, { ...user, identityVerificationStatus: "NONE", stripeIdentitySessionId: null });
    expect(retrieve).not.toHaveBeenCalled();
  });
});
