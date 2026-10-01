import { NextResponse } from "next/server";
import { withApiErrorHandling } from "@/lib/apiError";
import { prisma } from "@/lib/prisma";
import { getStripeClient } from "@/lib/stripe";
import { applyApprovedChange } from "@/app/api/bookings/[id]/change-requests/[requestId]/pay/route";
import { refreshConnectAccountStatus } from "@/lib/stripeConnect";
import { sendBookingConfirmedEmails } from "@/lib/notificationEmails";
import { awardReferralBonusIfEligible } from "@/lib/referral";
import { depositClaimDeadline } from "@/lib/securityDeposit";
import { pushBookingReservation } from "@/lib/pms/sync";
import { notifyTripExtraPaid } from "@/app/api/bookings/[id]/extras/route";
import { sendBookingUnavailableRefundedEmail, sendDisputeAlertEmail } from "@/lib/notificationEmails";
import { isRequestedRangeStillAvailable } from "@/lib/availability";
import { refundAcrossPayments } from "@/lib/connectRefunds";
import { evidenceDueByDate, mapStripeDisputeStatus } from "@/lib/paymentDisputes";
import type Stripe from "stripe";

/**
 * Whether a completed Checkout Session has actually been paid. "unpaid" is
 * what a delayed-notification payment method reports at completion - the
 * money hasn't moved yet, so nothing may be confirmed on it.
 */
function isCheckoutSessionPaid(session: Stripe.Checkout.Session): boolean {
  return session.payment_status === "paid" || session.payment_status === "no_payment_required";
}

/**
 * Payments that must not confirm a booking are refunded in full instead:
 * - the booking was cancelled before the payment landed (the guest cancelled
 *   with a payment page still open), so there's no stay to pay for;
 * - the booking is still PENDING but someone else took its dates after its
 *   hold lapsed (a guest finishing an old payment page late) - the last line
 *   of defence against a double booking.
 * Returns true when the payment was handled this way (or already had been,
 * on a redelivered event), so the caller must not confirm the booking.
 */
async function refundIfNotConfirmable(bookingId: string, checkoutSession: Stripe.Checkout.Session): Promise<boolean> {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { listing: { include: { host: true } } },
  });
  if (!booking || booking.status === "CONFIRMED" || booking.status === "COMPLETED") return false;

  const paymentIntentId =
    typeof checkoutSession.payment_intent === "string"
      ? checkoutSession.payment_intent
      : (checkoutSession.payment_intent?.id ?? null);

  if (booking.status === "CANCELLED") {
    // A redelivery of a payment this function already refunded.
    if (booking.paymentStatus === "REFUNDED" && booking.stripePaymentIntentId === paymentIntentId) return true;
  } else {
    const stillAvailable = await isRequestedRangeStillAvailable(prisma, {
      listingId: booking.listingId,
      roomTypeId: booking.roomTypeId,
      roomsBooked: booking.roomsBooked,
      excludeBookingId: booking.id,
      checkIn: booking.checkIn,
      checkOut: booking.checkOut,
    });
    if (stillAvailable) return false;
  }
  const paidCents = checkoutSession.amount_total ?? booking.totalPriceCents;
  const stripe = getStripeClient();
  if (stripe && paymentIntentId) {
    await refundAcrossPayments(
      stripe,
      [{ paymentIntentId, viaConnect: booking.hostPaidViaConnect }],
      paidCents,
    );
  }

  const cancelled = await prisma.booking.updateMany({
    where: { id: booking.id, status: { in: ["PENDING", "CANCELLED"] } },
    data: {
      status: "CANCELLED",
      paymentStatus: "REFUNDED",
      paidAt: new Date(),
      refundedAt: new Date(),
      refundedAmountCents: paidCents,
      stripePaymentIntentId: paymentIntentId,
    },
  });
  if (cancelled.count > 0 && booking.status === "PENDING" && booking.creditAppliedCents > 0) {
    await prisma.user.update({
      where: { id: booking.guestId },
      data: { creditBalanceCents: { increment: booking.creditAppliedCents } },
    });
  }
  console.warn("Payment refunded instead of confirming the booking", {
    bookingId: booking.id,
    paymentIntentId,
    reason: booking.status === "CANCELLED" ? "booking_cancelled" : "dates_taken",
  });

  if (cancelled.count > 0 && booking.status === "PENDING") {
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";
    await sendBookingUnavailableRefundedEmail(
      {
        reference: booking.reference,
        listingTitle: booking.listing.title,
        city: booking.listing.city,
        checkIn: booking.checkIn,
        checkOut: booking.checkOut,
        nights: booking.nights,
        guests: booking.guests,
        totalPriceCents: booking.totalPriceCents,
        guestName: booking.guestName,
        guestEmail: booking.guestEmail,
        hostName: booking.listing.host.name,
        hostEmail: booking.listing.host.email,
        bookingUrl: `${baseUrl}/bookings/${booking.id}`,
      },
      paidCents,
    );
  }
  return true;
}

/**
 * Confirms a booking once its Checkout Session is paid - shared by
 * checkout.session.completed (card payments) and
 * checkout.session.async_payment_succeeded (delayed payment methods).
 */
async function confirmPaidBooking(bookingId: string, checkoutSession: Stripe.Checkout.Session): Promise<void> {
  if (await refundIfNotConfirmable(bookingId, checkoutSession)) return;

  // Stripe's own docs are explicit that a webhook endpoint must tolerate
  // the same event arriving more than once (a retry after a slow 200, or
  // just an occasional genuine duplicate). Scoping the update to bookings
  // not already CONFIRMED makes a redelivery a pure no-op instead of
  // re-sending the guest and host their confirmation email a second (or
  // third) time for a booking that was already confirmed the first time.
  // Only a PENDING booking is confirmed. A CANCELLED one is never brought
  // back: refundIfNotConfirmable above has already refunded its payment.
  const { count } = await prisma.booking.updateMany({
    where: { id: bookingId, status: "PENDING" },
    data: {
      status: "CONFIRMED",
      paymentStatus: "PAID",
      paidAt: new Date(),
      stripePaymentIntentId:
        typeof checkoutSession.payment_intent === "string"
          ? checkoutSession.payment_intent
          : undefined,
    },
  });

  if (count > 0) {
    const booking = await prisma.booking.findUniqueOrThrow({
      where: { id: bookingId },
      include: { listing: { include: { host: true } } },
    });

    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";
    await sendBookingConfirmedEmails({
      reference: booking.reference,
      listingTitle: booking.listing.title,
      city: booking.listing.city,
      checkIn: booking.checkIn,
      checkOut: booking.checkOut,
      nights: booking.nights,
      guests: booking.guests,
      totalPriceCents: booking.totalPriceCents,
      guestName: booking.guestName,
      guestEmail: booking.guestEmail,
      hostName: booking.listing.host.name,
      hostEmail: booking.listing.host.email,
      bookingUrl: `${baseUrl}/bookings/${booking.id}`,
    });
    await awardReferralBonusIfEligible(prisma, booking.guestId);
    // Best-effort: pushBookingReservation never throws (it catches and
    // records every failure on the PmsReservationLink row itself), so
    // awaiting it here can't fail this webhook or delay Stripe's retry
    // logic - a booking with no PMS-mapped room/listing just resolves to
    // "not_mapped" immediately.
    await pushBookingReservation(prisma, bookingId);
  }
}

/**
 * Records a Stripe chargeback (see PaymentDispute's own schema comment) and
 * alerts an admin the first time this dispute is ever seen. Shared by all
 * three dispute event types below since they all carry the full current
 * Dispute object and should all leave the stored row in sync with it -
 * only whether this is the very first time this stripeDisputeId has been
 * seen (not which event type fired) decides whether the alert email sends,
 * so a redelivered charge.dispute.created can never double-alert.
 */
async function upsertPaymentDispute(dispute: Stripe.Dispute): Promise<void> {
  const chargeId = typeof dispute.charge === "string" ? dispute.charge : dispute.charge.id;
  const paymentIntentId =
    typeof dispute.payment_intent === "string"
      ? dispute.payment_intent
      : (dispute.payment_intent?.id ?? null);

  const existing = await prisma.paymentDispute.findUnique({
    where: { stripeDisputeId: dispute.id },
  });

  // Best-effort resolution back to the actual purchase this charge paid
  // for - the dispute payload itself never carries FYStay's own booking
  // id, only the PaymentIntent id already stamped onto Booking/
  // BookingExtra at checkout time.
  const [booking, bookingExtra] = paymentIntentId
    ? await Promise.all([
        prisma.booking.findFirst({ where: { stripePaymentIntentId: paymentIntentId } }),
        prisma.bookingExtra.findFirst({ where: { stripePaymentIntentId: paymentIntentId } }),
      ])
    : [null, null];

  const status = mapStripeDisputeStatus(dispute.status);
  const evidenceDueBy = evidenceDueByDate(dispute.evidence_details?.due_by ?? null);

  await prisma.paymentDispute.upsert({
    where: { stripeDisputeId: dispute.id },
    update: { status, evidenceDueBy, amountCents: dispute.amount, reason: dispute.reason },
    create: {
      stripeDisputeId: dispute.id,
      stripeChargeId: chargeId,
      stripePaymentIntentId: paymentIntentId,
      amountCents: dispute.amount,
      reason: dispute.reason,
      status,
      evidenceDueBy,
      bookingId: booking?.id,
      bookingExtraId: bookingExtra?.id,
    },
  });

  if (!existing) {
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";
    await sendDisputeAlertEmail({
      amountCents: dispute.amount,
      reason: dispute.reason,
      evidenceDueBy,
      bookingReference: booking?.reference ?? null,
      disputeUrl: `${baseUrl}/admin/disputes`,
    });
  }
}

async function postHandler(request: Request) {
  const stripe = getStripeClient();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!stripe || !webhookSecret) {
    return NextResponse.json(
      { error: "Stripe is not configured" },
      { status: 501 },
    );
  }

  const signature = request.headers.get("stripe-signature");
  const rawBody = await request.text();

  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  // Stripe signs events from FYStay's own account and events from hosts'
  // connected accounts (account.updated) with two different endpoint
  // secrets - an endpoint with "Listen to events on Connected accounts" is
  // separate in Stripe - so both are accepted when the second is set.
  const secrets = [webhookSecret, process.env.STRIPE_CONNECT_WEBHOOK_SECRET].filter(
    (secret): secret is string => Boolean(secret),
  );
  let event: Stripe.Event | undefined;
  for (const secret of secrets) {
    try {
      event = stripe.webhooks.constructEvent(rawBody, signature, secret);
      break;
    } catch {
      // try the next configured secret
    }
  }
  if (!event) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const checkoutSession = event.data.object;
    const bookingId = checkoutSession.metadata?.bookingId;
    const changeRequestId = checkoutSession.metadata?.changeRequestId;
    if (checkoutSession.metadata?.purpose === "trip_extra") {
      // A Trip Extra purchase (see docs/trip-extras-roadmap.md) completing -
      // scoped to PENDING_PAYMENT, the same redelivery-safety reasoning as
      // every other branch here, so a redelivered event never re-sends the
      // provider/guest emails for an extra that's already been marked paid.
      const bookingExtraId = checkoutSession.metadata?.bookingExtraId;
      if (bookingExtraId) {
        const { count } = await prisma.bookingExtra.updateMany({
          where: { id: bookingExtraId, status: "PENDING_PAYMENT" },
          data: {
            status: "PAID",
            paidAt: new Date(),
            stripePaymentIntentId:
              typeof checkoutSession.payment_intent === "string"
                ? checkoutSession.payment_intent
                : undefined,
          },
        });
        if (count > 0) {
          await notifyTripExtraPaid(bookingExtraId);
        }
      }
    } else if (checkoutSession.metadata?.purpose === "deposit" && bookingId) {
      // A security-deposit hold session (see createDepositCheckoutSession)
      // completing - this is the moment the card actually gets the
      // authorization hold placed on it. Scoped to AWAITING_AUTHORIZATION
      // so a redelivered event is a no-op rather than re-deriving a new
      // claim deadline from "now" a second time.
      const depositBooking = await prisma.booking.findFirst({
        where: { id: bookingId, depositStatus: "AWAITING_AUTHORIZATION" },
        select: { checkOut: true },
      });
      if (depositBooking) {
        await prisma.booking.updateMany({
          where: { id: bookingId, depositStatus: "AWAITING_AUTHORIZATION" },
          data: {
            depositStatus: "AUTHORIZED",
            depositAuthorizedAt: new Date(),
            depositClaimDeadline: depositClaimDeadline(depositBooking.checkOut),
            stripeDepositPaymentIntentId:
              typeof checkoutSession.payment_intent === "string"
                ? checkoutSession.payment_intent
                : undefined,
          },
        });
      }
    } else if (bookingId) {
      // Only a paid session confirms a booking. Card payments are paid by
      // the time this fires; a delayed payment method (e.g. a bank debit)
      // completes the session while still "unpaid" and confirms later via
      // checkout.session.async_payment_succeeded below.
      if (isCheckoutSessionPaid(checkoutSession)) {
        await confirmPaidBooking(bookingId, checkoutSession);
      }
    } else if (changeRequestId && isCheckoutSessionPaid(checkoutSession)) {
      await applyApprovedChange(changeRequestId);
    }
  } else if (event.type === "checkout.session.async_payment_succeeded") {
    // A delayed payment method (bank debit etc.) that left its session
    // "unpaid" at completion has now actually been paid. Only bookings and
    // change requests can reach here: checkout for both is otherwise
    // card-only today, and deposits and Trip Extras stay card-only.
    const checkoutSession = event.data.object;
    const bookingId = checkoutSession.metadata?.bookingId;
    const changeRequestId = checkoutSession.metadata?.changeRequestId;
    const purpose = checkoutSession.metadata?.purpose;
    if (!purpose && bookingId && isCheckoutSessionPaid(checkoutSession)) {
      await confirmPaidBooking(bookingId, checkoutSession);
    } else if (changeRequestId && isCheckoutSessionPaid(checkoutSession)) {
      await applyApprovedChange(changeRequestId);
    }
  } else if (event.type === "checkout.session.async_payment_failed") {
    // The delayed payment never arrived. Nothing was confirmed on the
    // unpaid completion, so there's nothing to undo: the booking stays
    // PENDING/UNPAID and its date hold lapses on its own. Logged so a
    // failed payment is visible rather than silent.
    const checkoutSession = event.data.object;
    console.warn("Stripe delayed payment failed", {
      sessionId: checkoutSession.id,
      bookingId: checkoutSession.metadata?.bookingId ?? null,
      changeRequestId: checkoutSession.metadata?.changeRequestId ?? null,
    });
  } else if (event.type === "account.updated") {
    // Fires on every change to a connected account, including ones this app
    // never directly caused (Stripe re-verifying details, a host adding a
    // bank account from their own Express dashboard). Written by account id
    // rather than a stored userId, since that's all this event carries -
    // see also refreshConnectAccountStatus, which does the same lookup for
    // a host returning from onboarding without waiting on this webhook.
    // The v1 snapshot's charges_enabled/payouts_enabled don't describe a
    // v2 recipient account, so this re-reads the account through Accounts
    // v2 and persists its stripe_transfers capability instead.
    const account = event.data.object;
    await refreshConnectAccountStatus(account.id).catch(() => {
      // No user has this account id yet (e.g. a stale/test event) -
      // nothing to update, and not worth failing the webhook over.
    });
  } else if (event.type === "checkout.session.expired") {
    // The guest never completed payment and Stripe's own session TTL ran
    // out (e.g. they abandoned the card form). Only ever touches a booking
    // still PENDING: if it's already CONFIRMED, some other session for the
    // same booking succeeded first, and this stale expiry must not cancel
    // a paid stay. A deposit hold session (metadata.purpose === "deposit")
    // is naturally excluded the same way, since a deposit is only ever
    // offered on a booking that's already CONFIRMED - depositStatus simply
    // stays AWAITING_AUTHORIZATION so the guest or the daily cron can
    // start a fresh session.
    // Only the booking's current session counts: a guest who restarted
    // checkout after this one expired is paying through a newer session.
    const bookingId = event.data.object.metadata?.bookingId;
    if (bookingId) {
      await prisma.booking.updateMany({
        where: { id: bookingId, status: "PENDING", stripeSessionId: event.data.object.id },
        data: { status: "CANCELLED" },
      });
    }
  } else if (
    event.type === "identity.verification_session.verified" ||
    event.type === "identity.verification_session.requires_input"
  ) {
    // The only place a user's identityVerificationStatus is ever set to
    // VERIFIED or FAILED - see createIdentityVerificationSession's own
    // comment for why this app never marks itself verified. Scoped to the
    // session id, not just the userId in metadata, so a stale/superseded
    // session's event can never overwrite the outcome of a newer one.
    const verificationSession = event.data.object;
    const userId = verificationSession.metadata?.userId;
    if (userId) {
      await prisma.user
        .updateMany({
          where: { id: userId, stripeIdentitySessionId: verificationSession.id },
          data: {
            identityVerificationStatus:
              event.type === "identity.verification_session.verified" ? "VERIFIED" : "FAILED",
            ...(event.type === "identity.verification_session.verified" && {
              identityVerifiedAt: new Date(),
            }),
          },
        })
        .catch(() => {
          // No user matches that id + session pair (e.g. a stale/test
          // event) - nothing to update, and not worth failing the webhook.
        });
    }
  } else if (
    event.type === "charge.dispute.created" ||
    event.type === "charge.dispute.updated" ||
    event.type === "charge.dispute.closed"
  ) {
    await upsertPaymentDispute(event.data.object);
  }

  return NextResponse.json({ received: true });
}

export const POST = withApiErrorHandling(postHandler);
