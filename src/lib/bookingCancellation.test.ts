import { beforeEach, describe, expect, it, vi } from "vitest";

const { refundAcrossPayments, releaseDeposit, opsAlert, stripe } = vi.hoisted(() => ({
  refundAcrossPayments: vi.fn(),
  releaseDeposit: vi.fn(),
  opsAlert: vi.fn(),
  stripe: { marker: "stripe", checkout: { sessions: { expire: vi.fn() } } },
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
// The booking's deposit fields as the database has them after the
// cancellation is recorded (which may differ from the caller's snapshot).
let depositRow: Record<string, unknown>;
let extras: Record<string, unknown>[];
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
    findUnique: async () => ({ id: "bk_1", ...depositRow }),
  },
  bookingExtra: {
    findMany: async () => extras.map((extra) => ({ ...extra })),
    updateMany: async ({ where, data }: { where: { id: string; status: string }; data: Record<string, unknown> }) => {
      const extra = extras.find((e) => e.id === where.id);
      if (!extra || extra.status !== where.status) return { count: 0 };
      Object.assign(extra, data);
      return { count: 1 };
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
  depositRow = { depositStatus: "NOT_REQUIRED", stripeDepositPaymentIntentId: null, stripeDepositSessionId: null };
  extras = [];
  stripe.checkout.sessions.expire.mockReset().mockResolvedValue({});
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

  it("refunds a non-refundable booking in full only within 24 hours of payment", async () => {
    const nonRefundable = { ...booking, cancellationPolicy: "NON_REFUNDABLE" } as CancellableBooking;
    const { refund } = await cancelBookingAndRefund(
      prisma,
      { ...nonRefundable, paidAt: new Date("2026-10-06T09:00:00Z") } as CancellableBooking,
      { now },
    );
    expect(refund.refundCents).toBe(50_000);

    state.status = "CONFIRMED";
    const late = await cancelBookingAndRefund(
      prisma,
      { ...nonRefundable, paidAt: new Date("2026-10-05T09:00:00Z") } as CancellableBooking,
      { now },
    );
    expect(late.refund.refundCents).toBe(0);
    expect(refundAcrossPayments).toHaveBeenCalledTimes(1);
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
    depositRow = { depositStatus: "AUTHORIZED", stripeDepositPaymentIntentId: "pi_hold", stripeDepositSessionId: null };
    await cancelBookingAndRefund(prisma, withHold, { now });
    expect(releaseDeposit).toHaveBeenCalledWith(stripe, prisma, "bk_1", "pi_hold");
  });

  it("releases a hold the guest authorized after the booking was loaded for cancelling", async () => {
    // The caller's snapshot still says the hold was only awaited...
    const snapshot = { ...booking, depositStatus: "AWAITING_AUTHORIZATION", stripeDepositSessionId: "cs_dep" } as CancellableBooking;
    // ...but the guest completed it in between.
    depositRow = { depositStatus: "AUTHORIZED", stripeDepositPaymentIntentId: "pi_hold", stripeDepositSessionId: "cs_dep" };
    await cancelBookingAndRefund(prisma, snapshot, { now });
    expect(releaseDeposit).toHaveBeenCalledWith(stripe, prisma, "bk_1", "pi_hold");
  });
});

describe("trip extras on cancellation", () => {
  const extra = (overrides: Record<string, unknown>) => ({
    id: "ex_1",
    status: "PAID",
    priceCents: 4_000,
    stripeSessionId: "cs_extra",
    stripePaymentIntentId: "pi_extra",
    fulfillmentStatus: "PENDING",
    sentToProviderAt: null,
    ...overrides,
  });

  it("refunds a paid extra the provider doesn't have yet, keyed per extra, and marks it refunded", async () => {
    extras = [extra({})];
    await cancelBookingAndRefund(prisma, booking, { now });
    expect(refundAcrossPayments).toHaveBeenCalledWith(
      stripe,
      [{ paymentIntentId: "pi_extra", viaConnect: false }],
      4_000,
      "trip-extra-cancel:ex_1",
    );
    expect(extras[0].status).toBe("REFUNDED");
    expect(opsAlert).not.toHaveBeenCalled();
  });

  it("alerts ops instead of refunding an extra already sent to the provider", async () => {
    extras = [extra({ fulfillmentStatus: "SENT", sentToProviderAt: new Date() })];
    await cancelBookingAndRefund(prisma, booking, { now });
    expect(refundAcrossPayments).not.toHaveBeenCalledWith(stripe, expect.anything(), 4_000, expect.anything());
    expect(extras[0].status).toBe("PAID");
    expect(opsAlert).toHaveBeenCalledWith(expect.objectContaining({ amountCents: 4_000, bookingReference: "FY-TEST" }));
  });

  it("closes an unpaid extra's payment page and cancels it", async () => {
    extras = [extra({ status: "PENDING_PAYMENT", stripePaymentIntentId: null })];
    await cancelBookingAndRefund(prisma, booking, { now });
    expect(stripe.checkout.sessions.expire).toHaveBeenCalledWith("cs_extra");
    expect(extras[0].status).toBe("CANCELLED");
  });

  it("keeps the extra paid and alerts ops when its refund fails, without failing the cancellation", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    extras = [extra({})];
    refundAcrossPayments.mockImplementation(async (_s: unknown, _p: unknown, _a: unknown, key: string) => {
      if (key.startsWith("trip-extra-cancel")) throw new Error("stripe down");
    });
    const { updated } = await cancelBookingAndRefund(prisma, booking, { now });
    expect(updated.status).toBe("CANCELLED");
    expect(extras[0].status).toBe("PAID");
    expect(opsAlert).toHaveBeenCalledTimes(1);
  });
});
