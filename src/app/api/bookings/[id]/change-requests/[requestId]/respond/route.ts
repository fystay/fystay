import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { getStripeClient } from "@/lib/stripe";
import { splitBookingChange } from "@/lib/pricing";
import { bookingFieldsAfterChange } from "@/lib/changeRequests";
import { refundChangeDifference } from "@/lib/connectRefunds";
import { isRequestedRangeStillAvailable } from "@/lib/availability";

const respondSchema = z.object({ action: z.enum(["approve", "decline"]) });

export async function POST(
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
  if (changeRequest.status !== "PENDING") {
    return NextResponse.json(
      { error: "This request has already been responded to" },
      { status: 409 },
    );
  }

  if (parsed.data.action === "decline") {
    const updated = await prisma.bookingChangeRequest.update({
      where: { id: requestId },
      data: { status: "DECLINED", respondedAt: new Date() },
    });
    return NextResponse.json({ changeRequest: updated });
  }

  // Approving: re-check availability, since the requested dates may have
  // been booked or blocked since the guest asked.
  const isAvailable = await isRequestedRangeStillAvailable(prisma, {
    listingId: changeRequest.booking.listingId,
    roomTypeId: changeRequest.booking.roomTypeId,
    roomsBooked: changeRequest.booking.roomsBooked,
    excludeBookingId: changeRequest.bookingId,
    checkIn: changeRequest.requestedCheckIn,
    checkOut: changeRequest.requestedCheckOut,
  });
  if (!isAvailable) {
    return NextResponse.json(
      { error: "Those dates are no longer available" },
      { status: 409 },
    );
  }

  if (changeRequest.priceDeltaCents > 0) {
    // The guest owes more; leave the booking untouched until they pay.
    const updated = await prisma.bookingChangeRequest.update({
      where: { id: requestId },
      data: { status: "APPROVED", respondedAt: new Date() },
    });
    return NextResponse.json({ changeRequest: updated });
  }

  if (changeRequest.priceDeltaCents < 0) {
    const stripe = getStripeClient();
    if (stripe && changeRequest.booking.stripePaymentIntentId) {
      // A shorter stay: the guest gets the difference back, and the host's
      // accommodation share and FYStay's fee share of it come back out of
      // each side exactly (not out of FYStay's balance alone).
      const { platformShareCents } = splitBookingChange(changeRequest.priceDeltaCents, changeRequest.booking);
      await refundChangeDifference(
        stripe,
        {
          paymentIntentId: changeRequest.booking.stripePaymentIntentId,
          viaConnect: changeRequest.booking.hostPaidViaConnect,
        },
        { refundCents: Math.abs(changeRequest.priceDeltaCents), platformShareCents: Math.abs(platformShareCents) },
      );
    }
  }

  const [updatedRequest] = await prisma.$transaction([
    prisma.bookingChangeRequest.update({
      where: { id: requestId },
      data: {
        status: "APPROVED",
        respondedAt: new Date(),
        refundedAt: changeRequest.priceDeltaCents < 0 ? new Date() : undefined,
      },
    }),
    prisma.booking.update({
      where: { id: changeRequest.bookingId },
      data: bookingFieldsAfterChange(changeRequest.booking, changeRequest),
    }),
  ]);

  return NextResponse.json({ changeRequest: updatedRequest });
}
