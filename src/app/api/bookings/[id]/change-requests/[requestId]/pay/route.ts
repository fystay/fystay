import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { allowsUnpaidConfirmation, getStripeClient, PAYMENTS_UNAVAILABLE_MESSAGE } from "@/lib/stripe";
import { formatPrice } from "@/lib/format";
import { splitBookingChange } from "@/lib/pricing";
import { bookingFieldsAfterChange } from "@/lib/changeRequests";
import { HOST_NOT_PAYMENT_READY_MESSAGE, verifyHostPaymentReady } from "@/lib/stripeConnect";
import { isRequestedRangeStillAvailable } from "@/lib/availability";
import { refundAcrossPayments } from "@/lib/connectRefunds";

export async function POST(
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

  // Approval doesn't hold the new dates, so someone else may have booked
  // them while this guest was deciding to pay. Re-check before taking money.
  if (!(await changedDatesStillAvailable(changeRequest))) {
    await prisma.bookingChangeRequest.update({
      where: { id: requestId },
      data: { status: "DECLINED" },
    });
    return NextResponse.json(
      { error: "Sorry, those dates have just been booked by someone else, so this change can't go ahead." },
      { status: 409 },
    );
  }

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";
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
  const { platformShareCents: applicationFeeCents } = splitBookingChange(
    changeRequest.priceDeltaCents,
    changeRequest.booking,
  );

  const checkoutSession = await stripe.checkout.sessions.create({
    mode: "payment",
    payment_method_types: ["card"],
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

  await prisma.bookingChangeRequest.update({
    where: { id: requestId },
    data: {
      stripeSessionId: checkoutSession.id,
      hostPaidViaConnect: true,
      applicationFeeCents,
    },
  });

  return NextResponse.json({ url: checkoutSession.url });
}

async function changedDatesStillAvailable(changeRequest: {
  bookingId: string;
  requestedCheckIn: Date;
  requestedCheckOut: Date;
  booking: { listingId: string; roomTypeId: string | null; roomsBooked: number };
}): Promise<boolean> {
  return isRequestedRangeStillAvailable(prisma, {
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
 * is the change payment's own; if the new dates were taken after the guest
 * opened the payment page, that payment is refunded in full and the change
 * declined rather than applied on top of someone else's booking.
 */
export async function applyApprovedChange(requestId: string, paymentIntentId?: string | null) {
  const changeRequest = await prisma.bookingChangeRequest.findUnique({
    where: { id: requestId },
    include: { booking: true },
  });
  if (!changeRequest || changeRequest.paidAt || changeRequest.status !== "APPROVED") return;

  if (!(await changedDatesStillAvailable(changeRequest))) {
    const stripe = getStripeClient();
    if (stripe && paymentIntentId) {
      await refundAcrossPayments(
        stripe,
        [{ paymentIntentId, viaConnect: changeRequest.hostPaidViaConnect }],
        changeRequest.priceDeltaCents,
      );
    }
    await prisma.bookingChangeRequest.updateMany({
      where: { id: requestId, status: "APPROVED", paidAt: null },
      data: { status: "DECLINED", refundedAt: new Date() },
    });
    console.warn("Change payment refunded: the new dates were taken before it landed", {
      changeRequestId: requestId,
      paymentIntentId,
    });
    return;
  }

  await prisma.$transaction([
    prisma.bookingChangeRequest.update({
      where: { id: requestId },
      data: { paidAt: new Date() },
    }),
    prisma.booking.update({
      where: { id: changeRequest.bookingId },
      data: bookingFieldsAfterChange(changeRequest.booking, changeRequest),
    }),
  ]);
}

