import type Stripe from "stripe";

// A card authorization hold (Stripe PaymentIntent with capture_method:
// "manual") only stays valid for about a week before most card networks
// release it automatically, regardless of what FYStay's own records say.
// That's the constraint everything below is built around:
//
// - The hold is placed shortly BEFORE check-in, not at the time of the
//   original booking payment. A stay booked months in advance would
//   otherwise have its hold silently expire long before the guest ever
//   arrives.
// - The claim window after checkout is kept short enough that
//   authorization + stay + claim window comfortably fits inside that
//   same real-world hold lifetime for a short stay.
//
// This means a security deposit is only reliably enforceable for stays up
// to roughly DEPOSIT_AUTHORIZATION_WINDOW_DAYS + DEPOSIT_CLAIM_WINDOW_DAYS
// nights - for a much longer stay, the hold can expire before the claim
// window even opens. That's a real limitation of card authorization holds
// themselves, not something this app papers over: it's surfaced to hosts
// on the listing form rather than silently promising a guarantee it can't
// keep for long stays.
export const DEPOSIT_AUTHORIZATION_WINDOW_DAYS = 3;
export const DEPOSIT_CLAIM_WINDOW_DAYS = 3;

export type DepositBooking = {
  status: string;
  depositStatus: string;
  checkIn: Date;
  checkOut: Date;
};

/**
 * True once a CONFIRMED booking's deposit hold should be placed: within
 * DEPOSIT_AUTHORIZATION_WINDOW_DAYS of check-in (including check-in day
 * itself having already arrived - a late authorization is still better
 * than none), and not already past check-out.
 */
export function needsDepositAuthorization(booking: DepositBooking, now: Date = new Date()): boolean {
  if (booking.status !== "CONFIRMED" || booking.depositStatus !== "AWAITING_AUTHORIZATION") {
    return false;
  }
  const windowStart = new Date(
    booking.checkIn.getTime() - DEPOSIT_AUTHORIZATION_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  );
  return now >= windowStart && now < booking.checkOut;
}

export function depositClaimDeadline(checkOut: Date): Date {
  return new Date(checkOut.getTime() + DEPOSIT_CLAIM_WINDOW_DAYS * 24 * 60 * 60 * 1000);
}

/** True once an AUTHORIZED hold's claim window has closed with no claim filed. */
export function isDepositClaimExpired(
  booking: { depositStatus: string; depositClaimDeadline: Date | null },
  now: Date = new Date(),
): boolean {
  return (
    booking.depositStatus === "AUTHORIZED" &&
    booking.depositClaimDeadline !== null &&
    now >= booking.depositClaimDeadline
  );
}

/**
 * A Checkout Session whose PaymentIntent is created with
 * capture_method: "manual" - Stripe never actually captures the charge
 * unless src/app/api/bookings/[id]/deposit/resolve later calls
 * paymentIntents.capture explicitly. The guest sees and completes a
 * perfectly normal Stripe Checkout page (same hosted flow as the main
 * booking payment); what makes it a hold rather than a charge is entirely
 * this one param. metadata.purpose distinguishes this from the main
 * booking/change-request Checkout Sessions the Stripe webhook also
 * handles - see its own routing on that field.
 */
export async function createDepositCheckoutSession(
  stripe: Stripe,
  params: {
    bookingId: string;
    depositCents: number;
    listingTitle: string;
    /** The guest's Stripe customer (src/lib/stripeCustomer.ts). */
    customerId: string;
    successUrl: string;
    cancelUrl: string;
  },
): Promise<Stripe.Checkout.Session> {
  return stripe.checkout.sessions.create({
    mode: "payment",
    payment_method_types: ["card"],
    customer: params.customerId,
    line_items: [
      {
        price_data: {
          currency: "gbp",
          product_data: {
            name: `Refundable security deposit hold: ${params.listingTitle}`,
          },
          unit_amount: params.depositCents,
        },
        quantity: 1,
      },
    ],
    payment_intent_data: {
      capture_method: "manual",
    },
    metadata: { bookingId: params.bookingId, purpose: "deposit" },
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
  });
}
