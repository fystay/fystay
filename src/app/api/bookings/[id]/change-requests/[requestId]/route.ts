import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { withApiErrorHandling } from "@/lib/apiError";
import { getStripeClient } from "@/lib/stripe";

async function deleteHandler(
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
    include: { booking: true },
  });

  if (!changeRequest || changeRequest.bookingId !== id) {
    return NextResponse.json({ error: "Change request not found" }, { status: 404 });
  }
  if (changeRequest.booking.guestId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  // A change the host approved but the guest hasn't paid for can be
  // withdrawn too: only one change runs at a time (see
  // OUTSTANDING_CHANGE_REQUEST_WHERE), so otherwise a guest who decides not
  // to pay could never ask for a different one. It's declined rather than
  // deleted, and any open payment page closed first, so a payment that
  // completes anyway still finds the request and is refunded by
  // applyApprovedChange.
  const awaitingPayment =
    changeRequest.status === "APPROVED" && !changeRequest.paidAt && changeRequest.priceDeltaCents > 0;
  if (awaitingPayment) {
    const stripe = getStripeClient();
    if (stripe && changeRequest.stripeSessionId) {
      await stripe.checkout.sessions.expire(changeRequest.stripeSessionId).catch(() => {
        // Already completed or expired.
      });
    }
    const { count } = await prisma.bookingChangeRequest.updateMany({
      where: { id: requestId, status: "APPROVED", paidAt: null },
      data: { status: "DECLINED" },
    });
    if (count === 0) {
      return NextResponse.json({ error: "This change has already been paid for" }, { status: 409 });
    }
    return NextResponse.json({ ok: true });
  }

  if (changeRequest.status !== "PENDING") {
    return NextResponse.json(
      { error: "This request has already been responded to" },
      { status: 409 },
    );
  }

  await prisma.bookingChangeRequest.delete({ where: { id: requestId } });

  return NextResponse.json({ ok: true });
}

export const DELETE = withApiErrorHandling(deleteHandler);
