import { NextResponse } from "next/server";
import { withApiErrorHandling } from "@/lib/apiError";
import { prisma } from "@/lib/prisma";
import { getStripeClient } from "@/lib/stripe";
import { applyApprovedChange } from "@/app/api/bookings/[id]/change-requests/[requestId]/pay/route";
import { refreshConnectAccountStatus } from "@/lib/stripeConnect";
import { reportError } from "@/lib/observability";
import { hostPayoutCents } from "@/lib/hostStats";
import { sendBookingConfirmedEmails } from "@/lib/notificationEmails";
import { awardReferralBonusIfEligible } from "@/lib/referral";
import { depositCaptureBefore, depositClaimDeadline } from "@/lib/securityDeposit";
import { pushBookingReservation } from "@/lib/pms/sync";
import { notifyTripExtraPaid } from "@/app/api/bookings/[id]/extras/route";
import { sendBookingUnavailableRefundedEmail, sendDisputeAlertEmail, sendPaymentOpsAlertEmail } from "@/lib/notificationEmails";
import { isRequestedRangeStillAvailable } from "@/lib/availability";
import { isFystayRefund, refundAcrossPayments } from "@/lib/connectRefunds";
import { evidenceDueByDate, mapStripeDisputeStatus } from "@/lib/paymentDisputes";
import type Stripe from "stripe";
import { BASE_URL } from "@/lib/baseUrl";
import { activatePaidPromotion } from "@/lib/listingPromotions";
import { giveBackReservedDiscounts, releaseUnpaidBooking } from "@/lib/bookingLifecycle";
import { withListingAvailabilityLock } from "@/lib/availabilityLock";
import { notifyListingPromotionActivated } from "@/lib/listingPromotionNotifications";
import { Prisma } from "@prisma/client";

/**
 * Whether a completed Checkout Session has actually been paid. "unpaid" is
 * what a delayed-notification payment method reports at completion - the
 * money hasn't moved yet, so nothing may be confirmed on it.
 */
function isCheckoutSessionPaid(session: Stripe.Checkout.Session): boolean {
  return session.payment_status === "paid" || session.payment_status === "no_payment_required";
}

type UnconfirmableReason = "amount_mismatch" | "booking_cancelled" | "dates_taken";

/**
 * Payments that must not confirm a booking are refunded in full instead:
 * - the booking was cancelled before the payment landed (the guest cancelled
 *   with a payment page still open), so there's no stay to pay for;
 * - the booking is still PENDING but someone else took its dates after its
 *   hold lapsed (a guest finishing an old payment page late) - the last line
 *   of defence against a double booking;
 * - Stripe took a different amount from the booking's total.
 * confirmPaidBooking decides which (under the listing's availability lock);
 * this only carries it out.
 */
async function refundUnconfirmablePayment(
  bookingId: string,
  checkoutSession: Stripe.Checkout.Session,
  reason: UnconfirmableReason,
): Promise<void> {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { listing: { include: { host: true } } },
  });
  if (!booking || booking.status === "CONFIRMED" || booking.status === "COMPLETED") return;

  const paymentIntentId =
    typeof checkoutSession.payment_intent === "string"
      ? checkoutSession.payment_intent
      : (checkoutSession.payment_intent?.id ?? null);

  // A cancelled booking that already recorded this very payment has been
  // dealt with: either this function refunded it (a redelivery), or the
  // booking was paid, confirmed and later cancelled - in which case the
  // cancellation policy already decided how much of it goes back, and
  // refunding the whole payment here on a redelivered event would override
  // a 0%/50% policy. Only a payment the booking never recorded is refunded.
  const alreadyRecordedPayment =
    booking.status === "CANCELLED" && (booking.paymentStatus !== "UNPAID" || Boolean(booking.paidAt));
  if (
    alreadyRecordedPayment &&
    (booking.stripePaymentIntentId === paymentIntentId || !paymentIntentId)
  ) {
    return;
  }
  // A second, different payment for a booking that already has one on
  // record (two payment pages open at once, the other one paid first) is
  // returned without overwriting the booking's own payment record - the
  // cancellation that ended it accounted for that one.
  const keepsEarlierPayment = alreadyRecordedPayment && booking.stripePaymentIntentId !== null;
  const paidCents = checkoutSession.amount_total ?? booking.totalPriceCents;
  const stripe = getStripeClient();
  if (stripe && paymentIntentId) {
    await refundAcrossPayments(
      stripe,
      [{ paymentIntentId, viaConnect: booking.hostPaidViaConnect }],
      paidCents,
      // The same delivery arriving twice at once must not refund twice.
      keepsEarlierPayment
        ? `unconfirmable-payment:${booking.id}:${paymentIntentId}`
        : `unconfirmable-payment:${booking.id}`,
    );
  }
  if (keepsEarlierPayment) {
    console.warn("Second payment for an already-paid cancelled booking refunded", {
      bookingId: booking.id,
      paymentIntentId,
      reason,
    });
    return;
  }

  // Ending a still-PENDING booking this way gives back the referral credit
  // and promo redemption it reserved, the same as any other unpaid booking
  // that never goes ahead (see giveBackReservedDiscounts) - only when this
  // request is the one that moved it off PENDING.
  const cancelled = await prisma.$transaction(async (tx) => {
    const result = await tx.booking.updateMany({
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
    if (result.count > 0 && booking.status === "PENDING") await giveBackReservedDiscounts(tx, booking);
    return result;
  });
  console.warn("Payment refunded instead of confirming the booking", {
    bookingId: booking.id,
    paymentIntentId,
    reason,
  });

  // The "those dates were just taken" email; an amount mismatch is FYStay's
  // problem to investigate, not something to explain to the guest that way.
  if (cancelled.count > 0 && booking.status === "PENDING" && reason === "dates_taken") {
    const baseUrl = BASE_URL;
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
}

/**
 * Whether Stripe took exactly what FYStay's own server-side total says this
 * booking costs. Checkout Sessions are only ever built from that total, so
 * a mismatch means a bug or tampering - never something to confirm a stay on.
 */
function paidAmountMatches(
  session: Pick<Stripe.Checkout.Session, "amount_total" | "currency">,
  totalPriceCents: number,
): boolean {
  return session.amount_total === totalPriceCents && session.currency?.toLowerCase() === "gbp";
}

/**
 * Confirms a booking once its Checkout Session is paid - shared by
 * checkout.session.completed (card payments) and
 * checkout.session.async_payment_succeeded (delayed payment methods).
 */
async function confirmPaidBooking(bookingId: string, checkoutSession: Stripe.Checkout.Session): Promise<void> {
  const located = await prisma.booking.findUnique({ where: { id: bookingId }, select: { listingId: true } });
  if (!located) return;

  // The availability re-check and the PENDING -> CONFIRMED write happen in
  // one transaction under the listing's availability lock (see
  // availabilityLock.ts), so no other booking, approval or block can take
  // these dates between the check passing and the booking confirming.
  const outcome = await withListingAvailabilityLock(prisma, located.listingId, async (tx) => {
    const booking = await tx.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        status: true,
        totalPriceCents: true,
        listingId: true,
        roomTypeId: true,
        roomsBooked: true,
        checkIn: true,
        checkOut: true,
      },
    });
    // Stripe's own docs are explicit that a webhook endpoint must tolerate
    // the same event arriving more than once (a retry after a slow 200, or
    // just an occasional genuine duplicate). An already-confirmed booking
    // makes a redelivery a pure no-op instead of re-sending the guest and
    // host their confirmation email a second (or third) time.
    if (!booking || booking.status === "CONFIRMED" || booking.status === "COMPLETED") return { kind: "noop" as const };
    // A CANCELLED booking is never brought back: its payment is refunded.
    if (booking.status === "CANCELLED") return { kind: "refund" as const, reason: "booking_cancelled" as const };
    if (!paidAmountMatches(checkoutSession, booking.totalPriceCents)) {
      console.error("Checkout payment doesn't match the booking total - refunding instead of confirming", {
        bookingId,
        expectedCents: booking.totalPriceCents,
        paidCents: checkoutSession.amount_total,
        currency: checkoutSession.currency,
      });
      return { kind: "refund" as const, reason: "amount_mismatch" as const };
    }
    const stillAvailable = await isRequestedRangeStillAvailable(tx, {
      listingId: booking.listingId,
      roomTypeId: booking.roomTypeId,
      roomsBooked: booking.roomsBooked,
      excludeBookingId: booking.id,
      checkIn: booking.checkIn,
      checkOut: booking.checkOut,
      paidOnly: true,
    });
    if (!stillAvailable) return { kind: "refund" as const, reason: "dates_taken" as const };

    const { count } = await tx.booking.updateMany({
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
    return count > 0 ? { kind: "confirmed" as const } : { kind: "noop" as const };
  });

  // The refund itself is a Stripe call, so it runs after the lock is
  // released; nothing it does makes dates unavailable.
  if (outcome.kind === "refund") {
    await refundUnconfirmablePayment(bookingId, checkoutSession, outcome.reason);
    return;
  }

  if (outcome.kind === "confirmed") {
    const booking = await prisma.booking.findUniqueOrThrow({
      where: { id: bookingId },
      include: { listing: { include: { host: true } } },
    });

    const baseUrl = BASE_URL;
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
    }, { earningsCents: hostPayoutCents(booking) });
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
 * A paid date change: applied by applyApprovedChange, which refunds the
 * payment instead if Stripe took anything other than the change's price
 * difference, the booking is no longer CONFIRMED, or the dates were taken.
 */
async function applyChangePayment(changeRequestId: string, checkoutSession: Stripe.Checkout.Session): Promise<void> {
  await applyApprovedChange(changeRequestId, paymentIntentIdOf(checkoutSession.payment_intent), {
    amountCents: checkoutSession.amount_total,
    currency: checkoutSession.currency,
    sessionId: checkoutSession.id,
  });
}

/**
 * A Trip Extra's payment completing (see docs/trip-extras-roadmap.md). It's
 * only recorded as PAID - and handed to the provider - when the extra is
 * still awaiting payment, Stripe took exactly its price, and the stay it's
 * for is still CONFIRMED, all checked by the write itself so a cancellation
 * landing at the same moment can't slip in between. Any other payment (the
 * booking was cancelled with the payment page open, the amount is wrong, or
 * a second session for an extra that's already paid) is refunded in full.
 * A redelivered event for a payment already recorded or refunded is a no-op.
 */
async function settlePaidTripExtra(
  stripe: Stripe,
  bookingExtraId: string,
  checkoutSession: Stripe.Checkout.Session,
): Promise<void> {
  const paymentIntentId = paymentIntentIdOf(checkoutSession.payment_intent);
  const extra = await prisma.bookingExtra.findUnique({
    where: { id: bookingExtraId },
    select: { priceCents: true },
  });
  if (!extra) return;

  if (paidAmountMatches(checkoutSession, extra.priceCents)) {
    const { count } = await prisma.bookingExtra.updateMany({
      where: {
        id: bookingExtraId,
        status: "PENDING_PAYMENT",
        priceCents: extra.priceCents,
        booking: { status: "CONFIRMED" },
      },
      data: { status: "PAID", paidAt: new Date(), stripePaymentIntentId: paymentIntentId ?? undefined },
    });
    if (count > 0) {
      await notifyTripExtraPaid(bookingExtraId);
      return;
    }
  }

  const current = await prisma.bookingExtra.findUnique({
    where: { id: bookingExtraId },
    select: { status: true, stripePaymentIntentId: true },
  });
  if (!current || !paymentIntentId) return;
  if (
    current.stripePaymentIntentId === paymentIntentId &&
    (current.status === "PAID" || current.status === "REFUNDED")
  ) {
    return;
  }

  const paidCents = checkoutSession.amount_total ?? extra.priceCents;
  // Trip Extras are plain charges to FYStay (no host transfer to reverse).
  await refundAcrossPayments(
    stripe,
    [{ paymentIntentId, viaConnect: false }],
    paidCents,
    `trip-extra-refund:${bookingExtraId}`,
  );
  // An extra already PAID through a different payment keeps that record;
  // this second payment was simply returned.
  await prisma.bookingExtra.updateMany({
    where: { id: bookingExtraId, status: { in: ["PENDING_PAYMENT", "CANCELLED"] } },
    data: { status: "REFUNDED", stripePaymentIntentId: paymentIntentId },
  });
  console.warn("Trip extra payment refunded instead of recorded", {
    bookingExtraId,
    paymentIntentId,
    paidCents,
    expectedCents: extra.priceCents,
  });
}

/**
 * Records a Stripe chargeback (see PaymentDispute's own schema comment) and
 * alerts an admin the first time this dispute is ever seen. Shared by all
 * three dispute event types below since they all carry the full current
 * Dispute object and should all leave the stored row in sync with it -
 * the alert email is claimed once per stripeDisputeId (not per event
 * type), so a redelivered charge.dispute.created can never double-alert.
 */
async function upsertPaymentDispute(dispute: Stripe.Dispute): Promise<void> {
  const chargeId = typeof dispute.charge === "string" ? dispute.charge : dispute.charge.id;
  const paymentIntentId =
    typeof dispute.payment_intent === "string"
      ? dispute.payment_intent
      : (dispute.payment_intent?.id ?? null);

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

  // The row above is already written, so if the email fails, Stripe's retry still needs a
  // way to send it.
  await sendPaymentAlertOnce(`dispute:${dispute.id}`, () =>
    sendDisputeAlertEmail({
      amountCents: dispute.amount,
      reason: dispute.reason,
      evidenceDueBy,
      bookingReference: booking?.reference ?? null,
      disputeUrl: `${BASE_URL}/admin/disputes`,
    }),
  );
}

/**
 * Activates the Spotlight placement a paid Checkout Session was for, then
 * emails the host. activatePaidPromotion only moves an unpaid placement, so
 * a redelivered event activates (and emails) nothing the second time.
 */
async function activateListingPromotion(checkoutSession: Stripe.Checkout.Session): Promise<void> {
  const promotionId = checkoutSession.metadata?.promotionId;
  if (!promotionId) return;
  const activated = await activatePaidPromotion(
    prisma,
    promotionId,
    typeof checkoutSession.payment_intent === "string" ? checkoutSession.payment_intent : null,
  );
  if (activated) await notifyListingPromotionActivated(promotionId);
}

/**
 * Records that an ops alert was sent, returning false if it already was -
 * so a repeated delivery of the same Stripe event emails once.
 */
async function claimPaymentAlert(key: string): Promise<boolean> {
  try {
    await prisma.paymentAlertSent.create({ data: { key } });
    return true;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return false;
    throw error;
  }
}

/** Sends an ops alert once per key; if sending fails, the claim is released so Stripe's retry sends it. */
async function sendPaymentAlertOnce(key: string, send: () => Promise<void>): Promise<void> {
  if (!(await claimPaymentAlert(key))) return;
  try {
    await send();
  } catch (error) {
    await prisma.paymentAlertSent.delete({ where: { key } }).catch(() => {});
    throw error;
  }
}

/** Which booking a payment belongs to, for an alert (the booking's own payment, or a trip extra on it). */
async function bookingReferenceForPayment(paymentIntentId: string | null): Promise<string | null> {
  if (!paymentIntentId) return null;
  const booking = await prisma.booking.findFirst({
    where: { OR: [{ stripePaymentIntentId: paymentIntentId }, { extras: { some: { stripePaymentIntentId: paymentIntentId } } }] },
    select: { reference: true },
  });
  return booking?.reference ?? null;
}

function paymentIntentIdOf(value: string | { id: string } | null | undefined): string | null {
  return typeof value === "string" ? value : (value?.id ?? null);
}

/**
 * A refund made by hand in the Stripe Dashboard, not through FYStay: the
 * money has gone back, but FYStay's booking still reads as paid. FYStay
 * stays the record of what a booking is, so this doesn't rewrite the
 * booking - it tells the ops inbox, once per refund, to put it right.
 */
async function alertOnRefundsMadeOutsideFystay(stripe: Stripe, charge: Stripe.Charge): Promise<void> {
  const refunds = await stripe.refunds.list({ charge: charge.id, limit: 100 });
  const outside = refunds.data.filter((refund) => !isFystayRefund(refund) && refund.status !== "failed");
  if (outside.length === 0) return;

  const paymentIntentId = paymentIntentIdOf(charge.payment_intent);
  const bookingReference = await bookingReferenceForPayment(paymentIntentId);
  for (const refund of outside) {
    await sendPaymentAlertOnce(`refund-outside-fystay:${refund.id}`, () =>
      sendPaymentOpsAlertEmail({
        subject: "Refund made outside FYStay",
        summary:
          "Someone refunded a payment directly in the Stripe Dashboard. The guest has their money back, but FYStay's booking record wasn't changed and still shows it as paid.",
        amountCents: refund.amount,
        bookingReference,
        action: bookingReference
          ? `If the stay is off, cancel booking ${bookingReference} in FYStay's admin (Bookings) and set the refund to only what's still owed on top of this (0% if this was the whole amount) - FYStay would otherwise refund again. If it was a goodwill refund on a stay that's going ahead, no change is needed.`
          : "This payment isn't linked to a FYStay booking (it may be a Spotlight purchase or a date-change payment) - check it in Stripe.",
        stripeUrl: paymentIntentId
          ? `https://dashboard.stripe.com/payments/${paymentIntentId}`
          : "https://dashboard.stripe.com/payments",
      }),
    );
  }
}

/**
 * Stripe couldn't put a refund back on the guest's card (a closed account,
 * say) - the money returned to FYStay's Stripe balance, and the guest was
 * promised it. A person has to arrange it another way.
 */
async function alertOnFailedRefund(refund: Stripe.Refund): Promise<void> {
  const paymentIntentId = paymentIntentIdOf(refund.payment_intent);
  const bookingReference = await bookingReferenceForPayment(paymentIntentId);
  await sendPaymentAlertOnce(`refund-failed:${refund.id}`, () =>
    sendPaymentOpsAlertEmail({
      subject: "A refund couldn't be delivered",
      summary: `Stripe couldn't return this refund to the guest's card (${refund.failure_reason ?? "no reason given"}). The money is back in FYStay's Stripe balance.`,
      amountCents: refund.amount,
      bookingReference,
      action: "Contact the guest and arrange the refund another way (e.g. a bank transfer), then note it on the booking's support ticket.",
      stripeUrl: paymentIntentId
        ? `https://dashboard.stripe.com/payments/${paymentIntentId}`
        : "https://dashboard.stripe.com/refunds",
    }),
  );
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

  // From a host's connected account, only account.updated means anything
  // here. Anything else (a charge or refund inside the host's own Stripe
  // account) isn't FYStay's payment - looking it up as one would fail and
  // have Stripe retry it for days.
  if (event.account && event.type !== "account.updated") {
    return NextResponse.json({ received: true });
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
      if (bookingExtraId && isCheckoutSessionPaid(checkoutSession)) {
        await settlePaidTripExtra(stripe, bookingExtraId, checkoutSession);
      }
    } else if (checkoutSession.metadata?.purpose === "listing_promotion") {
      // A host's Spotlight purchase (see src/lib/listingPromotions.ts).
      if (isCheckoutSessionPaid(checkoutSession)) {
        await activateListingPromotion(checkoutSession);
      }
    } else if (checkoutSession.metadata?.purpose === "deposit" && bookingId) {
      // A security-deposit hold session (see createDepositCheckoutSession)
      // completing - this is the moment the card actually gets the
      // authorization hold placed on it. Scoped to AWAITING_AUTHORIZATION
      // so a redelivered event is a no-op rather than re-deriving a new
      // claim deadline from "now" a second time.
      const holdPaymentIntentId =
        typeof checkoutSession.payment_intent === "string" ? checkoutSession.payment_intent : null;
      const depositBooking = await prisma.booking.findFirst({
        where: { id: bookingId, status: "CONFIRMED", depositStatus: "AWAITING_AUTHORIZATION" },
        select: { checkOut: true },
      });
      // The claim deadline mustn't outlive the card hold; Stripe says when
      // this one expires (a missing answer falls back to a 7-day hold).
      const captureBefore =
        depositBooking && holdPaymentIntentId
          ? await depositCaptureBefore(stripe, holdPaymentIntentId).catch(() => null)
          : null;
      const authorizedAt = new Date();
      const placed = depositBooking
        ? await prisma.booking.updateMany({
            where: { id: bookingId, status: "CONFIRMED", depositStatus: "AWAITING_AUTHORIZATION" },
            data: {
              depositStatus: "AUTHORIZED",
              depositAuthorizedAt: authorizedAt,
              depositClaimDeadline: depositClaimDeadline(depositBooking.checkOut, authorizedAt, captureBefore),
              stripeDepositPaymentIntentId: holdPaymentIntentId ?? undefined,
            },
          })
        : { count: 0 };
      if (placed.count === 0 && holdPaymentIntentId) {
        // A hold nobody will ever claim or release: the booking was
        // cancelled first, or the guest completed a second, older deposit
        // link after the first. Cancel it now rather than leave money held
        // on the guest's card for a week.
        const current = await prisma.booking.findUnique({
          where: { id: bookingId },
          select: { stripeDepositPaymentIntentId: true },
        });
        if (current?.stripeDepositPaymentIntentId !== holdPaymentIntentId) {
          await stripe.paymentIntents.cancel(holdPaymentIntentId).catch((error: unknown) => {
            if ((error as { code?: string }).code !== "payment_intent_unexpected_state") throw error;
          });
        }
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
      await applyChangePayment(changeRequestId, checkoutSession);
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
    } else if (purpose === "listing_promotion" && isCheckoutSessionPaid(checkoutSession)) {
      await activateListingPromotion(checkoutSession);
    } else if (changeRequestId && isCheckoutSessionPaid(checkoutSession)) {
      await applyChangePayment(changeRequestId, checkoutSession);
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
    await refreshConnectAccountStatus(account.id).catch((error: unknown) => {
      // No user has this account id yet (e.g. a stale/test event) -
      // nothing to update, and not worth failing the webhook over. Any
      // other failure leaves a host's payout status stale, so it's reported.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") return;
      reportError(error, { area: "payments", message: `host payout status not refreshed (${account.id})` });
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
    // Any referral credit or promo code it reserved is given back - the
    // guest was never charged (see releaseUnpaidBooking).
    const bookingId = event.data.object.metadata?.bookingId;
    if (bookingId) {
      const booking = await prisma.booking.findUnique({
        where: { id: bookingId },
        select: { id: true, guestId: true, creditAppliedCents: true, promoCodeId: true },
      });
      if (booking) await releaseUnpaidBooking(prisma, booking, { stripeSessionId: event.data.object.id });
    } else if (event.data.object.metadata?.purpose === "listing_promotion") {
      // An abandoned Spotlight checkout: never charged, so it's simply
      // closed off. Scoped to this session and to unpaid, like the above.
      await prisma.listingPromotion.updateMany({
        where: { stripeSessionId: event.data.object.id, status: "PENDING_PAYMENT" },
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
  } else if (event.type === "charge.refunded") {
    await alertOnRefundsMadeOutsideFystay(stripe, event.data.object);
  } else if (event.type === "refund.failed") {
    await alertOnFailedRefund(event.data.object);
  }

  return NextResponse.json({ received: true });
}

export const POST = withApiErrorHandling(postHandler);
