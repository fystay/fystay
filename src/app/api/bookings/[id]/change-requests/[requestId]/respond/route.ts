import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { getStripeClient } from "@/lib/stripe";
import {
  BOOKING_NOT_CHANGEABLE_MESSAGE,
  bookingFieldsAfterChange,
  bookingMatchesChangeSnapshot,
  CHANGE_REQUEST_IN_PROGRESS_MESSAGE,
  isBookingStillChangeable,
  OUTSTANDING_CHANGE_REQUEST_WHERE,
} from "@/lib/changeRequests";
import { bookingPayments, RefundIncompleteError, refundAcrossPayments } from "@/lib/connectRefunds";
import { sendPaymentOpsAlertEmail } from "@/lib/notificationEmails";
import { formatPrice } from "@/lib/format";
import { isRequestedRangeStillAvailable } from "@/lib/availability";
import { withListingAvailabilityLock } from "@/lib/availabilityLock";
import { withApiErrorHandling } from "@/lib/apiError";
import { reportError } from "@/lib/observability";

const respondSchema = z.object({ action: z.enum(["approve", "decline"]) });

async function postHandler(
  request: Request,
  { params }: { params: Promise<{ id: string; requestId: string }> },
) {
  const { id, requestId } = await params;
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const parsed = respondSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const changeRequest = await prisma.bookingChangeRequest.findUnique({
    where: { id: requestId },
    include: { booking: { include: { listing: true, roomType: true } } },
  });

  if (!changeRequest || changeRequest.bookingId !== id) {
    return NextResponse.json({ error: "Change request not found" }, { status: 404 });
  }
  if (changeRequest.booking.listing.hostId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const alreadyResponded = NextResponse.json(
    { error: "This request has already been responded to" },
    { status: 409 },
  );
  if (changeRequest.status !== "PENDING") return alreadyResponded;

  if (parsed.data.action === "decline") {
    // Claimed by the write itself, so a decline can't overwrite an approval
    // (or its refund) that landed a moment earlier.
    const { count } = await prisma.bookingChangeRequest.updateMany({
      where: { id: requestId, status: "PENDING" },
      data: { status: "DECLINED", respondedAt: new Date() },
    });
    if (count === 0) return alreadyResponded;
    const updated = await prisma.bookingChangeRequest.findUniqueOrThrow({ where: { id: requestId } });
    return NextResponse.json({ changeRequest: updated });
  }

  // A booking cancelled (or begun) since the guest asked can't take new
  // dates - and must never be refunded a difference on top of whatever its
  // cancellation already refunded.
  if (!isBookingStillChangeable(changeRequest.booking)) {
    return NextResponse.json({ error: BOOKING_NOT_CHANGEABLE_MESSAGE }, { status: 409 });
  }

  // Approving. Under the listing's availability lock, in one transaction:
  // re-check the booking and the requested dates (they may have been booked
  // or blocked since the guest asked), claim the request - only one of two
  // racing approvals gets past this - and, when there's nothing more for the
  // guest to pay, move the booking to its new dates. A change the guest
  // still has to pay for leaves the booking untouched until they do.
  const appliesNow = changeRequest.priceDeltaCents <= 0;
  const respondedAt = new Date();
  const outcome = await withListingAvailabilityLock(prisma, changeRequest.booking.listingId, async (tx) => {
    const booking = await tx.booking.findUnique({ where: { id: changeRequest.bookingId } });
    if (!booking || !isBookingStillChangeable(booking)) return { kind: "not_changeable" as const };
    // One change at a time: another request still awaiting the host or the
    // guest's payment would apply its difference on top of this one's. And
    // this request's difference was priced against the booking as it stood
    // when the guest asked - if anything has changed it since, approving it
    // would charge or refund the wrong amount.
    const otherInProgress = await tx.bookingChangeRequest.count({
      where: { bookingId: booking.id, id: { not: requestId }, ...OUTSTANDING_CHANGE_REQUEST_WHERE },
    });
    if (otherInProgress > 0) return { kind: "other_in_progress" as const };
    if (!bookingMatchesChangeSnapshot(booking, changeRequest)) return { kind: "booking_changed" as const };
    const isAvailable = await isRequestedRangeStillAvailable(tx, {
      listingId: booking.listingId,
      roomTypeId: booking.roomTypeId,
      roomsBooked: booking.roomsBooked,
      excludeBookingId: booking.id,
      checkIn: changeRequest.requestedCheckIn,
      checkOut: changeRequest.requestedCheckOut,
    });
    if (!isAvailable) return { kind: "unavailable" as const };

    const { count } = await tx.bookingChangeRequest.updateMany({
      where: { id: requestId, status: "PENDING" },
      data: { status: "APPROVED", respondedAt },
    });
    if (count === 0) return { kind: "already_responded" as const };

    const after = bookingFieldsAfterChange(booking, changeRequest);
    if (appliesNow) await tx.booking.update({ where: { id: booking.id }, data: after });
    return { kind: "approved" as const, booking, after };
  });

  if (outcome.kind === "not_changeable") {
    return NextResponse.json({ error: BOOKING_NOT_CHANGEABLE_MESSAGE }, { status: 409 });
  }
  if (outcome.kind === "unavailable") {
    return NextResponse.json(
      { error: "Those dates are no longer available" },
      { status: 409 },
    );
  }
  if (outcome.kind === "already_responded") return alreadyResponded;
  if (outcome.kind === "other_in_progress") {
    return NextResponse.json({ error: CHANGE_REQUEST_IN_PROGRESS_MESSAGE }, { status: 409 });
  }
  if (outcome.kind === "booking_changed") {
    return NextResponse.json(
      { error: "This booking has changed since the guest asked - decline this request so they can ask again." },
      { status: 409 },
    );
  }

  const { booking, after } = outcome;
  const stripe = getStripeClient();
  if (changeRequest.priceDeltaCents < 0 && stripe && booking.stripePaymentIntentId) {
    // A shorter stay: the guest gets the difference back. After an earlier
    // paid change the booking's total spans several payments, and the
    // original one alone may not have enough left to refund - so, like a
    // cancellation, the refund is spread across all of them, each reversing
    // its share of the host's transfer and FYStay's fee. Only after the
    // claim above, so two approvals can't both refund; keyed by request, so
    // a retry after a failure part-way doesn't refund twice either.
    try {
      const paidChanges = await prisma.bookingChangeRequest.findMany({
        where: { bookingId: booking.id, paidAt: { not: null } },
        select: { stripeSessionId: true, paidAt: true, hostPaidViaConnect: true },
      });
      const payments = await bookingPayments(stripe, { ...booking, changeRequests: paidChanges });
      await refundAcrossPayments(stripe, payments, Math.abs(changeRequest.priceDeltaCents), `change-refund:${requestId}`);
    } catch (error) {
      if (error instanceof RefundIncompleteError) {
        // Part of the difference already went back to the guest, so putting
        // the old dates back would leave them refunded for a change that
        // never happened. The change stands and a person sends the rest.
        reportError(error.cause, { area: "payments", message: `date-change refund only partly went through (request ${requestId})` });
        await sendPaymentOpsAlertEmail({
          subject: "A date-change refund only partly went through",
          summary: `Shorter stay approved. ${formatPrice(error.refundedCents)} of the ${formatPrice(error.requestedCents)} difference went back to the guest, then Stripe refused the rest.`,
          amountCents: error.requestedCents - error.refundedCents,
          bookingReference: booking.reference,
          action:
            "Refund the remaining amount to the guest from the booking's payments in the Stripe Dashboard, then note it on the booking's support ticket.",
          stripeUrl: `https://dashboard.stripe.com/payments/${booking.stripePaymentIntentId}`,
        }).catch((alertError) => {
          console.error(`couldn't send the partial-refund alert for change request ${requestId}:`, alertError);
        });
        const updatedRequest = await prisma.bookingChangeRequest.findUniqueOrThrow({ where: { id: requestId } });
        return NextResponse.json({ changeRequest: updatedRequest });
      }
      // Stripe refused: undo the approval and the new dates, so the host can
      // try again (the idempotency key makes that pick up where this left
      // off) rather than the booking showing a change nobody was refunded for.
      await prisma.$transaction([
        prisma.bookingChangeRequest.updateMany({
          where: { id: requestId, status: "APPROVED", respondedAt },
          data: { status: "PENDING", respondedAt: null },
        }),
        prisma.booking.updateMany({
          where: { id: booking.id, checkIn: after.checkIn, checkOut: after.checkOut, totalPriceCents: after.totalPriceCents },
          data: {
            checkIn: booking.checkIn,
            checkOut: booking.checkOut,
            nights: booking.nights,
            guests: booking.guests,
            totalPriceCents: booking.totalPriceCents,
            serviceFeeCents: booking.serviceFeeCents,
          },
        }),
      ]);
      reportError(error, { area: "payments", message: `date-change refund failed, approval undone (request ${requestId})` });
      throw error;
    }
    await prisma.bookingChangeRequest.update({ where: { id: requestId }, data: { refundedAt: new Date() } });
  }

  const updatedRequest = await prisma.bookingChangeRequest.findUniqueOrThrow({ where: { id: requestId } });
  return NextResponse.json({ changeRequest: updatedRequest });
}

export const POST = withApiErrorHandling(postHandler);
