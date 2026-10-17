import type Stripe from "stripe";
import type { PrismaClient } from "@prisma/client";

/**
 * Records Stripe's actual processing fee for a confirmed booking's payment
 * (Booking.stripeProcessingFeeCents), from the charge's balance transaction
 * on FYStay's account. With destination charges that fee is FYStay's cost,
 * never the host's, so it's what turns the quote's estimate into FYStay's
 * real contribution for reports.
 *
 * Best-effort: a failure is logged and never fails or retries the webhook -
 * the booking is already confirmed and the fee can be read again later.
 * Only written once, and only in GBP (FYStay's only charge currency).
 */
export async function recordStripeProcessingFee(
  stripe: Stripe,
  db: PrismaClient,
  bookingId: string,
  paymentIntentId: string | null,
): Promise<void> {
  if (!paymentIntentId) return;
  try {
    const intent = await stripe.paymentIntents.retrieve(paymentIntentId, { expand: ["latest_charge.balance_transaction"] });
    const charge = intent.latest_charge;
    const balance = charge && typeof charge !== "string" ? charge.balance_transaction : null;
    if (!balance || typeof balance === "string" || balance.currency !== "gbp") return;
    await db.booking.updateMany({ where: { id: bookingId, stripeProcessingFeeCents: null }, data: { stripeProcessingFeeCents: balance.fee } });
  } catch (error) {
    console.warn("stripe_fee_lookup_failed", { bookingId, error: error instanceof Error ? error.message : String(error) });
  }
}
