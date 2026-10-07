import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { getStripeClient } from "@/lib/stripe";
import { splitBookingChange } from "@/lib/pricing";
import { BOOKING_NOT_CHANGEABLE_MESSAGE, bookingFieldsAfterChange, isBookingStillChangeable } from "@/lib/changeRequests";
import { refundChangeDifference } from "@/lib/connectRefunds";
import { isRequestedRangeStillAvailable } from "@/lib/availability";
import { withListingAvailabilityLock } from "@/lib/availabilityLock";
import { withApiErrorHandling } from "@/lib/apiError";

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

  const { booking, after } = outcome;
  const stripe = getStripeClient();
  if (changeRequest.priceDeltaCents < 0 && stripe && booking.stripePaymentIntentId) {
    // A shorter stay: the guest gets the difference back, and the host's
    // accommodation share and FYStay's fee share of it come back out of
    // each side exactly (not out of FYStay's balance alone). Only after the
    // claim above, so two approvals can't both refund; keyed by request, so
    // a retry after a failure part-way doesn't refund twice either.
    const { platformShareCents } = splitBookingChange(changeRequest.priceDeltaCents, booking);
    try {
      await refundChangeDifference(
        stripe,
        { paymentIntentId: booking.stripePaymentIntentId, viaConnect: booking.hostPaidViaConnect },
        { refundCents: Math.abs(changeRequest.priceDeltaCents), platformShareCents: Math.abs(platformShareCents) },
        `change-refund:${requestId}`,
      );
    } catch (error) {
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
      console.error("Change refund failed - approval undone", { changeRequestId: requestId, error });
      throw error;
    }
    await prisma.bookingChangeRequest.update({ where: { id: requestId }, data: { refundedAt: new Date() } });
  }

  const updatedRequest = await prisma.bookingChangeRequest.findUniqueOrThrow({ where: { id: requestId } });
  return NextResponse.json({ changeRequest: updatedRequest });
}

export const POST = withApiErrorHandling(postHandler);
