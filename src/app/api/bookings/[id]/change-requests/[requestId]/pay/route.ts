import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { allowsUnpaidConfirmation, getStripeClient, PAYMENTS_UNAVAILABLE_MESSAGE } from "@/lib/stripe";
import { formatPrice } from "@/lib/format";
import { splitBookingChange } from "@/lib/pricing";
import type { Prisma } from "@prisma/client";
import {
  BOOKING_NOT_CHANGEABLE_MESSAGE,
  bookingFieldsAfterChange,
  bookingMatchesChangeSnapshot,
  isBookingStillChangeable,
} from "@/lib/changeRequests";
import { withListingAvailabilityLock } from "@/lib/availabilityLock";
import { decideExistingSessionAction } from "@/lib/checkoutSession";
import { HOST_NOT_PAYMENT_READY_MESSAGE, verifyHostPaymentReady } from "@/lib/stripeConnect";
import { isRequestedRangeStillAvailable } from "@/lib/availability";
import { refundAcrossPayments } from "@/lib/connectRefunds";
import { BASE_URL } from "@/lib/baseUrl";
import { withApiErrorHandling } from "@/lib/apiError";
import { getOrCreateStripeCustomer } from "@/lib/stripeCustomer";

async function postHandler(
  _request: Request,
  { params }: { params: Promise<{ id: string; requestId: string }> },
) {
  const { id, requestId } = await params;
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const changeRequest = await prisma.bookingChangeRequest.findUnique({
    where: { id: requestId },
    include: { booking: { include: { listing: { include: { host: true } } } } },
  });

  if (!changeRequest || changeRequest.bookingId !== id) {
    return NextResponse.json({ error: "Change request not found" }, { status: 404 });
  }
  if (changeRequest.booking.guestId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (changeRequest.status !== "APPROVED" || changeRequest.priceDeltaCents <= 0) {
    return NextResponse.json(
      { error: "This request doesn't need payment" },
      { status: 409 },
    );
  }
  if (changeRequest.paidAt) {
    return NextResponse.json({ error: "This change has already been paid for" }, { status: 409 });
  }
  // The same rule as asking for a change: only an upcoming, CONFIRMED stay
  // can still be changed - not one cancelled or already begun since the
  // host approved.
  if (!isBookingStillChangeable(changeRequest.booking)) {
    return NextResponse.json({ error: BOOKING_NOT_CHANGEABLE_MESSAGE }, { status: 409 });
  }

  // Approval doesn't hold the new dates, so someone else may have booked
  // them while this guest was deciding to pay. Re-check before taking money.
  if (!(await changedDatesStillAvailable(prisma, changeRequest))) {
    // A payment page opened earlier may still be live: it's closed first, so
    // it can't be paid for a change that's no longer going ahead. If it was
    // completed just before (or completes anyway), applyApprovedChange
    // refunds that payment, since the request is no longer awaiting one.
    // Declined only while still approved and unpaid - a payment that landed
    // and applied the change in the meantime must not be overwritten.
    const stripe = getStripeClient();
    if (stripe && changeRequest.stripeSessionId) {
      await stripe.checkout.sessions.expire(changeRequest.stripeSessionId).catch(() => {
        // Already completed or expired.
      });
    }
    const declined = await prisma.bookingChangeRequest.updateMany({
      where: { id: requestId, status: "APPROVED", paidAt: null },
      data: { status: "DECLINED" },
    });
    if (declined.count === 0) {
      return NextResponse.json({ error: "This change has already been paid for" }, { status: 409 });
    }
    return NextResponse.json(
      { error: "Sorry, those dates have just been booked by someone else, so this change can't go ahead." },
      { status: 409 },
    );
  }

  const baseUrl = BASE_URL;
  const stripe = getStripeClient();

  if (!stripe) {
    if (!allowsUnpaidConfirmation()) {
      return NextResponse.json({ error: PAYMENTS_UNAVAILABLE_MESSAGE }, { status: 503 });
    }
    await applyApprovedChange(requestId);
    return NextResponse.json({
      url: `${baseUrl}/bookings?dev_confirmed=1`,
      devMode: true,
    });
  }

  // Same rule as the original booking's checkout: the extra payment is a
  // destination charge, so the host's share reaches them automatically, and
  // it can't be taken at all unless their Connect account can receive it.
  if (!(await verifyHostPaymentReady(changeRequest.booking.listing.host))) {
    return NextResponse.json({ error: HOST_NOT_PAYMENT_READY_MESSAGE }, { status: 409 });
  }

  // A guest pressing Pay twice (a double click, a second tab, Back then
  // Pay) must get the same payment page back, never a second live one -
  // two open sessions for one change are two ways to be charged for it.
  // Same rule as the booking's own checkout (see /api/checkout).
  if (changeRequest.stripeSessionId) {
    const existingSession = await stripe.checkout.sessions.retrieve(changeRequest.stripeSessionId);
    const action = decideExistingSessionAction(existingSession.status);
    if (action === "reuse" && existingSession.url) {
      return NextResponse.json({ url: existingSession.url });
    }
    if (action === "already_paid") {
      // The webhook applies it; nothing more to pay.
      return NextResponse.json({ url: `${baseUrl}/bookings?success=1` });
    }
    // "create_new": the earlier page expired unpaid.
  }
  const { platformShareCents: applicationFeeCents } = splitBookingChange(
    changeRequest.priceDeltaCents,
    changeRequest.booking,
  );

  const checkoutSession = await stripe.checkout.sessions.create({
    mode: "payment",
    payment_method_types: ["card"],
    customer: await getOrCreateStripeCustomer(stripe, prisma, changeRequest.booking.guestId),
    line_items: [
      {
        price_data: {
          currency: "gbp",
          product_data: {
            name: `${changeRequest.booking.listing.title}: date change (+${formatPrice(changeRequest.priceDeltaCents)})`,
          },
          unit_amount: changeRequest.priceDeltaCents,
        },
        quantity: 1,
      },
    ],
    metadata: { changeRequestId: changeRequest.id },
    // Just over Stripe's 30-minute minimum (instead of its 24-hour default),
    // so a stale payment page can't be completed much later.
    expires_at: Math.floor(Date.now() / 1000) + 31 * 60,
    success_url: `${baseUrl}/bookings?success=1`,
    cancel_url: `${baseUrl}/bookings`,
    payment_intent_data: {
      application_fee_amount: applicationFeeCents,
      transfer_data: { destination: changeRequest.booking.listing.host.stripeConnectAccountId! },
    },
  });

  // Attached only if no other request attached a session since we read it;
  // otherwise that one is the page to pay through, and ours is expired so it
  // can't be paid as well.
  const attached = await prisma.bookingChangeRequest.updateMany({
    where: { id: requestId, stripeSessionId: changeRequest.stripeSessionId },
    data: {
      stripeSessionId: checkoutSession.id,
      hostPaidViaConnect: true,
      applicationFeeCents,
    },
  });
  if (attached.count === 0) {
    await stripe.checkout.sessions.expire(checkoutSession.id).catch(() => {});
    const winner = await prisma.bookingChangeRequest.findUnique({
      where: { id: requestId },
      select: { stripeSessionId: true },
    });
    if (winner?.stripeSessionId) {
      const winningSession = await stripe.checkout.sessions.retrieve(winner.stripeSessionId);
      if (winningSession.url) return NextResponse.json({ url: winningSession.url });
    }
    return NextResponse.json({ error: "Please try again" }, { status: 409 });
  }

  return NextResponse.json({ url: checkoutSession.url });
}

async function changedDatesStillAvailable(
  db: Prisma.TransactionClient,
  changeRequest: {
    bookingId: string;
    requestedCheckIn: Date;
    requestedCheckOut: Date;
    booking: { listingId: string; roomTypeId: string | null; roomsBooked: number };
  },
): Promise<boolean> {
  return isRequestedRangeStillAvailable(db, {
    listingId: changeRequest.booking.listingId,
    roomTypeId: changeRequest.booking.roomTypeId,
    roomsBooked: changeRequest.booking.roomsBooked,
    excludeBookingId: changeRequest.bookingId,
    checkIn: changeRequest.requestedCheckIn,
    checkOut: changeRequest.requestedCheckOut,
  });
}

/**
 * Shared with the webhook handler for the real-Stripe path. paymentIntentId
 * is the change payment's own and paid is what Stripe actually took (both
 * absent on the dev-mode path, where nothing was charged). The change is
 * applied only if, under the listing's availability lock, the request is
 * still approved and unpaid, the booking is still CONFIRMED and still the
 * stay the request was priced against, the new dates are still free, and
 * the amount paid is exactly the request's difference. Otherwise the payment
 * is refunded in full and the change declined, rather than applied on top
 * of someone else's booking, to a cancelled stay, on top of another change,
 * or for the wrong money.
 *
 * A payment for a request that isn't waiting to be paid (declined because
 * its dates were taken or the guest withdrew it, or already paid through a
 * different session) is refunded too - only a redelivery of the payment
 * already recorded against it is ignored.
 */
export async function applyApprovedChange(
  requestId: string,
  paymentIntentId?: string | null,
  paid?: { amountCents: number | null; currency: string | null; sessionId?: string },
) {
  const located = await prisma.bookingChangeRequest.findUnique({
    where: { id: requestId },
    select: { booking: { select: { listingId: true } } },
  });
  if (!located) return;

  const outcome = await withListingAvailabilityLock(prisma, located.booking.listingId, async (tx) => {
    const changeRequest = await tx.bookingChangeRequest.findUnique({
      where: { id: requestId },
      include: { booking: true },
    });
    if (!changeRequest) return { kind: "noop" as const };
    const refund = (reason: string) => ({ kind: "refund" as const, reason, changeRequest });
    if (changeRequest.paidAt || changeRequest.status !== "APPROVED") {
      // Nothing was charged (the dev-mode path), or this is Stripe
      // redelivering the very payment that applied the change.
      if (!paymentIntentId) return { kind: "noop" as const };
      if (changeRequest.paidAt && (!paid?.sessionId || paid.sessionId === changeRequest.stripeSessionId)) {
        return { kind: "noop" as const };
      }
      return refund("not_awaiting_payment");
    }
    if (
      paid &&
      (paid.amountCents !== changeRequest.priceDeltaCents || paid.currency?.toLowerCase() !== "gbp")
    ) {
      return refund("amount_mismatch");
    }
    if (changeRequest.booking.status !== "CONFIRMED") return refund("booking_not_confirmed");
    if (!bookingMatchesChangeSnapshot(changeRequest.booking, changeRequest)) return refund("booking_changed");
    if (!(await changedDatesStillAvailable(tx, changeRequest))) return refund("dates_taken");

    // Claimed by the write itself, so a duplicate delivery applies it once.
    const { count } = await tx.bookingChangeRequest.updateMany({
      where: { id: requestId, status: "APPROVED", paidAt: null },
      data: { paidAt: new Date() },
    });
    if (count === 0) return { kind: "noop" as const };
    await tx.booking.update({
      where: { id: changeRequest.bookingId },
      data: bookingFieldsAfterChange(changeRequest.booking, changeRequest),
    });
    return { kind: "applied" as const };
  });
  if (outcome.kind !== "refund") return;

  // Refunded before the request is marked declined: if Stripe refuses, the
  // webhook fails and Stripe's retry finds the request still APPROVED and
  // tries again (the idempotency key keeps that to one refund).
  const stripe = getStripeClient();
  if (stripe && paymentIntentId) {
    await refundAcrossPayments(
      stripe,
      [{ paymentIntentId, viaConnect: outcome.changeRequest.hostPaidViaConnect }],
      paid?.amountCents ?? outcome.changeRequest.priceDeltaCents,
      `change-payment-refund:${requestId}`,
    );
  }
  await prisma.bookingChangeRequest.updateMany({
    where: { id: requestId, status: "APPROVED", paidAt: null },
    data: { status: "DECLINED", refundedAt: new Date() },
  });
  console.warn("Change payment refunded instead of applied", {
    changeRequestId: requestId,
    paymentIntentId,
    reason: outcome.reason,
  });
}

export const POST = withApiErrorHandling(postHandler);
