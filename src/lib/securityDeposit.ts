import type Stripe from "stripe";

// A card authorization hold (Stripe PaymentIntent with capture_method:
// "manual") stays valid for 7 days on most cards (Stripe's documented
// window for customer-initiated online payments), after which the card
// network releases it and the PaymentIntent becomes "canceled" -
// regardless of what FYStay's own records say. Lodging businesses on
// eligible Stripe pricing can get up to 30 days, which is requested where
// available. Everything below is built around that:
//
// - The hold is placed the day before check-in, not at the time of the
//   original booking payment, so as much of its life as possible falls
//   after the stay.
// - The claim deadline is the earlier of DEPOSIT_CLAIM_WINDOW_DAYS after
//   checkout and shortly before the hold itself expires (Stripe's own
//   capture_before for the payment, when known). A host is never shown a
//   claim window the card hold can't honour.
//
// For a stay longer than about 5 nights on a standard 7-day hold, that
// leaves little or no time after checkout: a real limitation of card
// holds, surfaced to hosts on the listing form rather than papered over.
export const DEPOSIT_AUTHORIZATION_WINDOW_DAYS = 1;
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

const DAY_MS = 24 * 60 * 60 * 1000;
/** A standard online card hold's life, less a margin for the capture itself. */
const STANDARD_HOLD_MS = 7 * DAY_MS - 12 * 60 * 60 * 1000;

/**
 * The last moment a host can claim: DEPOSIT_CLAIM_WINDOW_DAYS after
 * checkout, but never past the hold's own expiry - Stripe's capture_before
 * for the authorization when known (it reflects any extended hold),
 * otherwise a standard 7-day hold from when it was placed. Both less a
 * 12-hour margin so a claim made at the deadline still captures.
 */
export function depositClaimDeadline(checkOut: Date, authorizedAt: Date = new Date(), captureBefore?: Date | null): Date {
  const claimWindowEnd = checkOut.getTime() + DEPOSIT_CLAIM_WINDOW_DAYS * DAY_MS;
  const holdEnd = captureBefore ? captureBefore.getTime() - 12 * 60 * 60 * 1000 : authorizedAt.getTime() + STANDARD_HOLD_MS;
  return new Date(Math.min(claimWindowEnd, holdEnd));
}

/** When Stripe says an authorized deposit must be captured by, if it says. */
export async function depositCaptureBefore(stripe: Stripe, paymentIntentId: string): Promise<Date | null> {
  const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId, { expand: ["latest_charge"] });
  const charge = paymentIntent.latest_charge;
  const captureBefore = charge && typeof charge !== "string" ? charge.payment_method_details?.card?.capture_before : null;
  return captureBefore ? new Date(captureBefore * 1000) : null;
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
    // Up to 30 days for lodging where the account's Stripe pricing allows
    // it; otherwise the standard 7 days. depositClaimDeadline uses
    // whichever the card actually got.
    payment_method_options: { card: { request_extended_authorization: "if_available" } },
    metadata: { bookingId: params.bookingId, purpose: "deposit" },
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
  });
}
