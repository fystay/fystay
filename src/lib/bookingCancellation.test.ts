import { beforeEach, describe, expect, it, vi } from "vitest";

const { refundAcrossPayments, releaseDeposit, stripe } = vi.hoisted(() => ({
  refundAcrossPayments: vi.fn(),
  releaseDeposit: vi.fn(),
  stripe: { marker: "stripe" },
}));

vi.mock("@/lib/stripe", () => ({ getStripeClient: () => stripe }));
vi.mock("@/lib/connectRefunds", () => ({
  bookingPayments: async (_s: unknown, booking: { stripePaymentIntentId: string }) => [
    { paymentIntentId: booking.stripePaymentIntentId, viaConnect: true },
  ],
  refundAcrossPayments: (...a: unknown[]) => refundAcrossPayments(...a),
}));
vi.mock("@/lib/notificationEmails", () => ({ sendBookingCancelledEmails: vi.fn() }));
vi.mock("@/lib/pms/sync", () => ({ pushBookingCancellation: vi.fn() }));
vi.mock("@/lib/depositSettlement", () => ({
  DepositAlreadyResolvedError: class extends Error {},
  releaseDeposit: (...a: unknown[]) => releaseDeposit(...a),
}));

import { BookingAlreadyProcessedError, cancelBookingAndRefund, type CancellableBooking } from "./bookingCancellation";

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
const prisma = {
  booking: {
    updateMany: async (args: { where: { status: string }; data: { status: string } }) => {
      updateMany(args);
      if (args.where.status !== state.status) return { count: 0 };
      state.status = args.data.status;
      return { count: 1 };
    },
    update: async ({ data }: { data: Record<string, unknown> }) => ({ ...booking, ...data }),
  },
  bookingChangeRequest: { findMany: async () => [] },
} as unknown as Parameters<typeof cancelBookingAndRefund>[0];

beforeEach(() => {
  state = { status: "CONFIRMED" };
  refundAcrossPayments.mockReset();
  releaseDeposit.mockReset();
  updateMany.mockReset();
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

  it("releases a live deposit hold on the guest's card", async () => {
    const withHold = { ...booking, depositStatus: "AUTHORIZED", stripeDepositPaymentIntentId: "pi_hold" } as CancellableBooking;
    await cancelBookingAndRefund(prisma, withHold, { now });
    expect(releaseDeposit).toHaveBeenCalledWith(stripe, prisma, "bk_1", "pi_hold");
  });
});
