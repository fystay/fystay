import { beforeEach, describe, expect, it, vi } from "vitest";

const { refundAcrossPayments, releaseDeposit, opsAlert, stripe } = vi.hoisted(() => ({
  refundAcrossPayments: vi.fn(),
  releaseDeposit: vi.fn(),
  opsAlert: vi.fn(),
  stripe: { marker: "stripe" },
}));

vi.mock("@/lib/stripe", () => ({ getStripeClient: () => stripe }));
vi.mock("@/lib/connectRefunds", async (importOriginal) => ({
  RefundIncompleteError: (await importOriginal<typeof import("@/lib/connectRefunds")>()).RefundIncompleteError,
  bookingPayments: async (_s: unknown, booking: { stripePaymentIntentId: string }) => [
    { paymentIntentId: booking.stripePaymentIntentId, viaConnect: true },
  ],
  refundAcrossPayments: (...a: unknown[]) => refundAcrossPayments(...a),
}));
vi.mock("@/lib/notificationEmails", () => ({
  sendBookingCancelledEmails: vi.fn(),
  sendPaymentOpsAlertEmail: (...a: unknown[]) => opsAlert(...a),
}));
vi.mock("@/lib/pms/sync", () => ({ pushBookingCancellation: vi.fn() }));
vi.mock("@/lib/depositSettlement", () => ({
  DepositAlreadyResolvedError: class extends Error {},
  releaseDeposit: (...a: unknown[]) => releaseDeposit(...a),
}));

import { BookingAlreadyProcessedError, cancelBookingAndRefund, type CancellableBooking } from "./bookingCancellation";
import { RefundIncompleteError } from "@/lib/connectRefunds";

// A stay 30 days out under a 50% policy: the refund a race would double.
const now = new Date("2026-10-06T12:00:00Z");
const booking = {
  id: "bk_1",
  reference: "FY-TEST",
  status: "CONFIRMED",
  paymentStatus: "PAID",
  totalPriceCents: 50_000,
  checkIn: new Date("2026-11-05T00:00:00Z"),
  checkOut: new Date("2026-11-08T00:00:00Z"),
  nights: 3,
  guests: 2,
  guestId: "guest_1",
  guestName: "Guest",
  guestEmail: "guest@example.com",
  stripePaymentIntentId: "pi_1",
  hostPaidViaConnect: true,
  listing: {
    title: "Seaside flat",
    city: "Blackpool",
    cancellationPolicy: "CUSTOM",
    customCancellationCutoffDays: 0,
    customCancellationRefundPercent: 50,
    host: { name: "Host", email: "host@example.com" },
  },
} as unknown as CancellableBooking;

let state: { status: string };
const updateMany = vi.fn();
const update = vi.fn();
const userUpdate = vi.fn();
const promoUpdate = vi.fn();
const db = {
  booking: {
    updateMany: async (args: { where: { status: string }; data: { status: string } }) => {
      updateMany(args);
      if (args.where.status !== state.status) return { count: 0 };
      state.status = args.data.status;
      return { count: 1 };
    },
    update: async (args: { data: Record<string, unknown> }) => {
      update(args);
      return { ...booking, ...args.data };
    },
  },
  user: { update: userUpdate },
  promoCode: { update: promoUpdate },
  bookingChangeRequest: { findMany: async () => [] },
};
const prisma = {
  ...db,
  $transaction: (fn: (tx: typeof db) => unknown) => fn(db),
} as unknown as Parameters<typeof cancelBookingAndRefund>[0];

beforeEach(() => {
  state = { status: "CONFIRMED" };
  refundAcrossPayments.mockReset();
  releaseDeposit.mockReset();
  opsAlert.mockReset();
  updateMany.mockReset();
  update.mockReset();
  userUpdate.mockReset();
  promoUpdate.mockReset();
});

describe("cancelBookingAndRefund", () => {
  it("refunds what the policy allows, once, keyed for Stripe idempotency", async () => {
    const { refund } = await cancelBookingAndRefund(prisma, booking, { now });
    expect(refund.refundCents).toBe(25_000);
    expect(refundAcrossPayments).toHaveBeenCalledTimes(1);
    expect(refundAcrossPayments).toHaveBeenCalledWith(
      stripe,
      [{ paymentIntentId: "pi_1", viaConnect: true }],
      25_000,
      "booking-cancel:bk_1",
    );
  });

  it("lets only one of two racing cancellations refund", async () => {
    const results = await Promise.allSettled([
      cancelBookingAndRefund(prisma, booking, { now }),
      cancelBookingAndRefund(prisma, booking, { now }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(BookingAlreadyProcessedError);
    expect(refundAcrossPayments).toHaveBeenCalledTimes(1);
  });

  it("puts the booking back if Stripe refuses the refund", async () => {
    refundAcrossPayments.mockRejectedValueOnce(new Error("card_declined"));
    await expect(cancelBookingAndRefund(prisma, booking, { now })).rejects.toThrow("card_declined");
    expect(state.status).toBe("CONFIRMED");
  });

  it("keeps the booking cancelled, records what went back and alerts ops when a refund fails part-way", async () => {
    refundAcrossPayments.mockRejectedValueOnce(new RefundIncompleteError(10_000, 25_000, new Error("card_declined")));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { updated } = await cancelBookingAndRefund(prisma, booking, { now });
    expect(state.status).toBe("CANCELLED");
    expect(updated).toMatchObject({ status: "CANCELLED", paymentStatus: "PARTIALLY_REFUNDED", refundedAmountCents: 10_000 });
    expect(opsAlert).toHaveBeenCalledTimes(1);
    expect(opsAlert).toHaveBeenCalledWith(expect.objectContaining({ amountCents: 15_000, bookingReference: "FY-TEST" }));
  });

  it("gives back the credit and promo an unpaid booking reserved, once", async () => {
    state = { status: "PENDING" };
    const unpaid = {
      ...booking,
      status: "PENDING",
      paymentStatus: "UNPAID",
      creditAppliedCents: 1_500,
      promoCodeId: "promo_1",
    } as CancellableBooking;
    const results = await Promise.allSettled([
      cancelBookingAndRefund(prisma, unpaid, { now }),
      cancelBookingAndRefund(prisma, unpaid, { now }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(userUpdate).toHaveBeenCalledTimes(1);
    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: "guest_1" },
      data: { creditBalanceCents: { increment: 1_500 } },
    });
    expect(promoUpdate).toHaveBeenCalledWith({ where: { id: "promo_1" }, data: { redemptionCount: { decrement: 1 } } });
    expect(refundAcrossPayments).not.toHaveBeenCalled();
  });

  it("doesn't give back discounts on a paid booking (they were part of what the guest paid for)", async () => {
    await cancelBookingAndRefund(prisma, { ...booking, creditAppliedCents: 1_500, promoCodeId: "promo_1" } as CancellableBooking, {
      now,
    });
    expect(userUpdate).not.toHaveBeenCalled();
    expect(promoUpdate).not.toHaveBeenCalled();
  });

  it("releases a live deposit hold on the guest's card", async () => {
    const withHold = { ...booking, depositStatus: "AUTHORIZED", stripeDepositPaymentIntentId: "pi_hold" } as CancellableBooking;
    await cancelBookingAndRefund(prisma, withHold, { now });
    expect(releaseDeposit).toHaveBeenCalledWith(stripe, prisma, "bk_1", "pi_hold");
  });
});
