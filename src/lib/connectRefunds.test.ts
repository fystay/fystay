import { describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import { bookingPayments, RefundIncompleteError, refundAcrossPayments, refundChangeDifference } from "./connectRefunds";

function fakeStripe(charges: Record<string, { amount: number; amount_refunded?: number }>) {
  const calls = {
    refunds: [] as unknown[],
    reversals: [] as unknown[],
    feeRefunds: [] as unknown[],
  };
  const stripe = {
    paymentIntents: {
      retrieve: vi.fn(async (id: string) => ({
        latest_charge: {
          id: `ch_${id}`,
          amount: charges[id].amount,
          amount_refunded: charges[id].amount_refunded ?? 0,
          transfer: `tr_${id}`,
          application_fee: `fee_${id}`,
        },
      })),
    },
    refunds: { create: vi.fn(async (params: unknown) => calls.refunds.push(params)) },
    transfers: { createReversal: vi.fn(async (id: string, params: unknown) => calls.reversals.push([id, params])) },
    applicationFees: { createRefund: vi.fn(async (id: string, params: unknown) => calls.feeRefunds.push([id, params])) },
    checkout: {
      sessions: { retrieve: vi.fn(async (id: string) => ({ payment_intent: `pi_for_${id}` })) },
    },
  };
  return { stripe: stripe as unknown as Stripe, calls };
}

describe("refundChangeDifference", () => {
  it("refunds the guest, reverses the whole difference from the host and returns FYStay's exact fee share", async () => {
    const { stripe, calls } = fakeStripe({ pi_1: { amount: 33000 } });
    // A 3-night stay shortened by a night: £110 back = £100 host + £10 FYStay.
    await refundChangeDifference(stripe, { paymentIntentId: "pi_1", viaConnect: true }, { refundCents: 11000, platformShareCents: 1000 });
    expect(calls.refunds).toEqual([{ payment_intent: "pi_1", amount: 11000, metadata: { source: "fystay" } }]);
    expect(calls.reversals).toEqual([["tr_pi_1", { amount: 11000 }]]);
    expect(calls.feeRefunds).toEqual([["fee_pi_1", { amount: 1000 }]]);
  });

  it("keys each Stripe call when asked, so a retry after a failure part-way doesn't repeat what succeeded", async () => {
    const { stripe } = fakeStripe({ pi_1: { amount: 33000 } });
    await refundChangeDifference(
      stripe,
      { paymentIntentId: "pi_1", viaConnect: true },
      { refundCents: 11000, platformShareCents: 1000 },
      "change-refund:cr_1",
    );
    expect(stripe.refunds.create).toHaveBeenCalledWith(expect.anything(), { idempotencyKey: "change-refund:cr_1:refund" });
    expect(stripe.transfers.createReversal).toHaveBeenCalledWith("tr_pi_1", { amount: 11000 }, {
      idempotencyKey: "change-refund:cr_1:reversal",
    });
    expect(stripe.applicationFees.createRefund).toHaveBeenCalledWith("fee_pi_1", { amount: 1000 }, {
      idempotencyKey: "change-refund:cr_1:fee-refund",
    });
  });

  it("is a plain refund when the payment never went to the host", async () => {
    const { stripe, calls } = fakeStripe({ pi_1: { amount: 33000 } });
    await refundChangeDifference(stripe, { paymentIntentId: "pi_1", viaConnect: false }, { refundCents: 11000, platformShareCents: 1000 });
    expect(calls.refunds).toEqual([{ payment_intent: "pi_1", amount: 11000, metadata: { source: "fystay" } }]);
    expect(calls.reversals).toEqual([]);
    expect(calls.feeRefunds).toEqual([]);
  });
});

describe("refundAcrossPayments", () => {
  it("refunds newest payment first, never more than each can return, reversing the host split on each", async () => {
    const { stripe, calls } = fakeStripe({ pi_booking: { amount: 33000 }, pi_change: { amount: 11000 } });
    await refundAcrossPayments(
      stripe,
      [
        { paymentIntentId: "pi_booking", viaConnect: true },
        { paymentIntentId: "pi_change", viaConnect: true },
      ],
      40000,
    );
    expect(calls.refunds).toEqual([
      { payment_intent: "pi_change", amount: 11000, metadata: { source: "fystay" }, reverse_transfer: true, refund_application_fee: true },
      { payment_intent: "pi_booking", amount: 29000, metadata: { source: "fystay" }, reverse_transfer: true, refund_application_fee: true },
    ]);
  });

  it("skips what was already refunded and leaves non-host payments as plain refunds", async () => {
    const { stripe, calls } = fakeStripe({ pi_booking: { amount: 33000, amount_refunded: 33000 }, pi_old: { amount: 5000 } });
    await refundAcrossPayments(
      stripe,
      [
        { paymentIntentId: "pi_old", viaConnect: false },
        { paymentIntentId: "pi_booking", viaConnect: true },
      ],
      5000,
    );
    expect(calls.refunds).toEqual([{ payment_intent: "pi_old", amount: 5000, metadata: { source: "fystay" } }]);
  });

  it("names each refund for Stripe's idempotency when asked, so a repeat returns the first", async () => {
    const { stripe } = fakeStripe({ pi_booking: { amount: 33000 } });
    await refundAcrossPayments(stripe, [{ paymentIntentId: "pi_booking", viaConnect: true }], 12000, "booking-cancel:bk_1");
    expect(stripe.refunds.create).toHaveBeenCalledWith(expect.objectContaining({ amount: 12000 }), {
      idempotencyKey: "booking-cancel:bk_1:pi_booking:12000",
    });
  });

  it("says how much went back when a later payment's refund fails after an earlier one succeeded", async () => {
    const { stripe } = fakeStripe({ pi_booking: { amount: 33000 }, pi_change: { amount: 11000 } });
    const declined = new Error("charge_disputed");
    vi.mocked(stripe.refunds.create)
      .mockResolvedValueOnce({} as Stripe.Response<Stripe.Refund>)
      .mockRejectedValueOnce(declined);
    const error = await refundAcrossPayments(
      stripe,
      [
        { paymentIntentId: "pi_booking", viaConnect: true },
        { paymentIntentId: "pi_change", viaConnect: true },
      ],
      40000,
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RefundIncompleteError);
    expect(error).toMatchObject({ refundedCents: 11000, requestedCents: 40000, cause: declined });
  });

  it("passes the original error through when nothing was refunded", async () => {
    const { stripe } = fakeStripe({ pi_booking: { amount: 33000 } });
    const declined = new Error("charge_disputed");
    vi.mocked(stripe.refunds.create).mockRejectedValueOnce(declined);
    await expect(
      refundAcrossPayments(stripe, [{ paymentIntentId: "pi_booking", viaConnect: true }], 1000),
    ).rejects.toBe(declined);
  });
});

describe("bookingPayments", () => {
  it("lists the booking payment then paid changes in the order they were paid", async () => {
    const { stripe } = fakeStripe({});
    const payments = await bookingPayments(stripe, {
      stripePaymentIntentId: "pi_booking",
      hostPaidViaConnect: true,
      changeRequests: [
        { stripeSessionId: "cs_2", paidAt: new Date("2026-10-02"), hostPaidViaConnect: true },
        { stripeSessionId: "cs_unpaid", paidAt: null, hostPaidViaConnect: true },
        { stripeSessionId: "cs_1", paidAt: new Date("2026-10-01"), hostPaidViaConnect: false },
      ],
    });
    expect(payments).toEqual([
      { paymentIntentId: "pi_booking", viaConnect: true },
      { paymentIntentId: "pi_for_cs_1", viaConnect: false },
      { paymentIntentId: "pi_for_cs_2", viaConnect: true },
    ]);
  });
});
