import type Stripe from "stripe";

/**
 * Refund helpers for destination charges (see /api/checkout). With
 * application_fee_amount, Stripe transfers the *whole* charge to the host's
 * connected account and collects FYStay's fee back from it - so undoing part
 * of a payment means reversing that part of the transfer and returning the
 * matching part of the application fee, or FYStay's own balance covers the
 * refund while the host keeps the money.
 */

/**
 * Marks a refund as made by FYStay itself (cancellations, date changes,
 * unconfirmable payments), so the webhook can tell those apart from a
 * refund someone made by hand in the Stripe Dashboard.
 */
export const FYSTAY_REFUND_METADATA = { source: "fystay" } as const;

export function isFystayRefund(refund: { metadata?: Record<string, string> | null }): boolean {
  return refund.metadata?.source === FYSTAY_REFUND_METADATA.source;
}

type PaymentToRefund = {
  paymentIntentId: string;
  /** Whether this payment was a destination charge to the host (Booking.hostPaidViaConnect). */
  viaConnect: boolean;
};

async function latestCharge(stripe: Stripe, paymentIntentId: string): Promise<Stripe.Charge | null> {
  const intent = await stripe.paymentIntents.retrieve(paymentIntentId, { expand: ["latest_charge"] });
  const charge = intent.latest_charge;
  return charge && typeof charge !== "string" ? charge : null;
}

/**
 * Refunds a stay-change difference with the exact split from
 * splitBookingChange: the guest gets refundCents back, the host gives up
 * hostShareCents and FYStay gives up platformShareCents (they sum to
 * refundCents). A payment that never went to the host is a plain refund.
 */
export async function refundChangeDifference(
  stripe: Stripe,
  payment: PaymentToRefund,
  split: { refundCents: number; platformShareCents: number },
): Promise<void> {
  await stripe.refunds.create({
    payment_intent: payment.paymentIntentId,
    amount: split.refundCents,
    metadata: FYSTAY_REFUND_METADATA,
  });
  if (!payment.viaConnect) return;

  const charge = await latestCharge(stripe, payment.paymentIntentId);
  const transferId = typeof charge?.transfer === "string" ? charge.transfer : charge?.transfer?.id;
  const applicationFeeId =
    typeof charge?.application_fee === "string" ? charge.application_fee : charge?.application_fee?.id;
  if (transferId) {
    // The whole difference comes back from the host's account...
    await stripe.transfers.createReversal(transferId, { amount: split.refundCents });
  }
  if (applicationFeeId && split.platformShareCents > 0) {
    // ...and FYStay returns its own share of it, leaving the host down
    // exactly their accommodation share.
    await stripe.applicationFees.createRefund(applicationFeeId, { amount: split.platformShareCents });
  }
}

/**
 * Refunds amountCents across a booking's payments - the original booking
 * payment and any paid date changes - newest first, never more than each
 * payment still has to refund. Each destination-charge payment reverses the
 * same proportion of the host's transfer and of FYStay's fee as it refunds
 * (Stripe's reverse_transfer/refund_application_fee), so a cancellation
 * unwinds both sides the way the original booking was split.
 */
export async function refundAcrossPayments(
  stripe: Stripe,
  payments: PaymentToRefund[],
  amountCents: number,
  /**
   * Names this refund for Stripe's idempotency (with each payment and
   * amount appended), so the same refund requested twice - a duplicate
   * webhook, a retried request - is made once and the second call gets
   * the first one back.
   */
  idempotencyKey?: string,
): Promise<void> {
  let remaining = amountCents;
  for (const payment of [...payments].reverse()) {
    if (remaining <= 0) break;
    const charge = await latestCharge(stripe, payment.paymentIntentId);
    const refundable = charge ? charge.amount - charge.amount_refunded : 0;
    const amount = Math.min(remaining, refundable);
    if (amount <= 0) continue;
    await stripe.refunds.create(
      {
        payment_intent: payment.paymentIntentId,
        amount,
        metadata: FYSTAY_REFUND_METADATA,
        ...(payment.viaConnect && { reverse_transfer: true, refund_application_fee: true }),
      },
      idempotencyKey ? { idempotencyKey: `${idempotencyKey}:${payment.paymentIntentId}:${amount}` } : undefined,
    );
    remaining -= amount;
  }
  if (remaining > 0) {
    console.error("Refund exceeded what the booking's payments can return", {
      unrefundedCents: remaining,
    });
  }
}

/**
 * Every payment a booking has taken through Stripe, oldest first: the
 * booking itself, then each paid date change (whose PaymentIntent is read
 * from its Checkout Session, the only Stripe id stored for it).
 */
export async function bookingPayments(
  stripe: Stripe,
  booking: {
    stripePaymentIntentId: string | null;
    hostPaidViaConnect: boolean;
    changeRequests?: { stripeSessionId: string | null; paidAt: Date | null; hostPaidViaConnect: boolean }[];
  },
): Promise<PaymentToRefund[]> {
  const payments: PaymentToRefund[] = [];
  if (booking.stripePaymentIntentId) {
    payments.push({ paymentIntentId: booking.stripePaymentIntentId, viaConnect: booking.hostPaidViaConnect });
  }
  const paidChanges = (booking.changeRequests ?? [])
    .filter((change) => change.paidAt && change.stripeSessionId)
    .sort((a, b) => a.paidAt!.getTime() - b.paidAt!.getTime());
  for (const change of paidChanges) {
    const session = await stripe.checkout.sessions.retrieve(change.stripeSessionId!);
    const intentId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
    if (intentId) payments.push({ paymentIntentId: intentId, viaConnect: change.hostPaidViaConnect });
  }
  return payments;
}
