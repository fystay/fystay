import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  ABANDONED_CHECKOUT_MINUTES,
  expireAbandonedCheckouts,
  isAbandonedReservation,
  releaseUnpaidBooking,
} from "./bookingLifecycle";

/** A Prisma stand-in whose transaction runs its callback against the same mocks. */
function fakePrisma(updatedCount = 1) {
  const booking = {
    updateMany: vi.fn().mockResolvedValue({ count: updatedCount }),
    findMany: vi.fn().mockResolvedValue([]),
  };
  const user = { update: vi.fn().mockResolvedValue({}) };
  const promoCode = { update: vi.fn().mockResolvedValue({}) };
  const tx = { booking, user, promoCode };
  const prisma = { ...tx, $transaction: vi.fn((fn: (t: typeof tx) => unknown) => fn(tx)) };
  return { prisma: prisma as unknown as PrismaClient, booking, user, promoCode };
}

const unpaid = { id: "b1", guestId: "g1", creditAppliedCents: 0, promoCodeId: null };

describe("releaseUnpaidBooking", () => {
  it("cancels only a still-pending, unpaid booking", async () => {
    const { prisma, booking } = fakePrisma();
    expect(await releaseUnpaidBooking(prisma, unpaid)).toBe(true);
    expect(booking.updateMany).toHaveBeenCalledWith({
      where: { id: "b1", status: "PENDING", paymentStatus: "UNPAID" },
      data: { status: "CANCELLED" },
    });
  });

  it("gives back the referral credit and promo code redemption it reserved", async () => {
    const { prisma, user, promoCode } = fakePrisma();
    await releaseUnpaidBooking(prisma, { ...unpaid, creditAppliedCents: 1500, promoCodeId: "promo1" });
    expect(user.update).toHaveBeenCalledWith({
      where: { id: "g1" },
      data: { creditBalanceCents: { increment: 1500 } },
    });
    expect(promoCode.update).toHaveBeenCalledWith({
      where: { id: "promo1" },
      data: { redemptionCount: { decrement: 1 } },
    });
  });

  it("gives nothing back when the booking had already moved on (e.g. a payment landed first)", async () => {
    const { prisma, user, promoCode } = fakePrisma(0);
    const released = await releaseUnpaidBooking(prisma, { ...unpaid, creditAppliedCents: 1500, promoCodeId: "promo1" });
    expect(released).toBe(false);
    expect(user.update).not.toHaveBeenCalled();
    expect(promoCode.update).not.toHaveBeenCalled();
  });

  it("adds the caller's extra condition, such as the payment page that expired", async () => {
    const { prisma, booking } = fakePrisma();
    await releaseUnpaidBooking(prisma, unpaid, { stripeSessionId: "cs_1" });
    expect(booking.updateMany.mock.calls[0][0].where).toMatchObject({ id: "b1", stripeSessionId: "cs_1" });
  });
});

describe("expireAbandonedCheckouts", () => {
  it("looks only at unpaid instant bookings and approved requests untouched for the abandon window", async () => {
    const now = new Date("2026-10-06T12:00:00Z");
    const { prisma, booking } = fakePrisma();
    booking.findMany.mockResolvedValue([unpaid]);
    expect(await expireAbandonedCheckouts(prisma, { guestId: "g1" }, now)).toBe(1);

    const cutoff = new Date(now.getTime() - ABANDONED_CHECKOUT_MINUTES * 60 * 1000);
    expect(booking.findMany.mock.calls[0][0].where).toEqual({
      status: "PENDING",
      paymentStatus: "UNPAID",
      approvalStatus: { in: ["NONE", "APPROVED"] },
      updatedAt: { lt: cutoff },
      guestId: "g1",
    });
    // Re-checked at write time, so a payment page opened since the read isn't cut off.
    expect(booking.updateMany.mock.calls[0][0].where).toMatchObject({ updatedAt: { lt: cutoff } });
  });

  it("can be scoped to one host's listings, for the host dashboard", async () => {
    const { prisma, booking } = fakePrisma();
    await expireAbandonedCheckouts(prisma, { hostId: "h1" });
    expect(booking.findMany.mock.calls[0][0].where).toMatchObject({ listing: { hostId: "h1" } });
  });

  it("waits past both the 30-minute hold and a Stripe payment page's 31-minute life", () => {
    expect(ABANDONED_CHECKOUT_MINUTES).toBeGreaterThan(31);
  });
});

describe("isAbandonedReservation", () => {
  const base = { status: "CANCELLED", paymentStatus: "UNPAID", approvalStatus: "NONE", paidAt: null };

  it("is a cancelled instant booking that was never paid", () => {
    expect(isAbandonedReservation(base)).toBe(true);
  });

  it("isn't a paid booking that was cancelled, or a declined request", () => {
    expect(isAbandonedReservation({ ...base, paymentStatus: "REFUNDED", paidAt: new Date() })).toBe(false);
    expect(isAbandonedReservation({ ...base, approvalStatus: "DECLINED" })).toBe(false);
    expect(isAbandonedReservation({ ...base, status: "PENDING" })).toBe(false);
  });
});
