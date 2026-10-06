import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canCancelBooking } from "@/lib/changeRequests";
import { cancelBookingAndRefund } from "@/lib/bookingCancellation";
import { withApiErrorHandling } from "@/lib/apiError";

/**
 * Cancels a booking and, if it was paid for, refunds it per the listing's
 * cancellation policy - never a blanket full refund. The actual refund math
 * and side effects (Stripe refund, status update, emails, PMS push) live in
 * cancelBookingAndRefund (src/lib/bookingCancellation.ts), shared with the
 * admin manual-cancel route, so there is only one implementation of "what
 * does cancelling a booking do". Nothing about the refund is ever taken
 * from the request - the client-side dialog shows a preview of the same
 * computation ahead of time purely so the guest isn't surprised, but this
 * is the only place the numbers that actually move money get decided.
 */
async function postHandler(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const booking = await prisma.booking.findUnique({
    where: { id },
    include: { listing: { include: { host: true } } },
  });
  if (!booking) {
    return NextResponse.json({ error: "Booking not found" }, { status: 404 });
  }
  if (booking.guestId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!canCancelBooking(booking)) {
    return NextResponse.json(
      { error: "This booking can no longer be cancelled" },
      { status: 409 },
    );
  }

  const { updated, refund } = await cancelBookingAndRefund(prisma, booking);

  return NextResponse.json({ booking: updated, refund });
}

export const POST = withApiErrorHandling(postHandler);
