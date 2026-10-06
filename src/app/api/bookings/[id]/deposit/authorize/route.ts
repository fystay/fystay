import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { getStripeClient } from "@/lib/stripe";
import { createDepositCheckoutSession, needsDepositAuthorization } from "@/lib/securityDeposit";
import { BASE_URL } from "@/lib/baseUrl";
import { withApiErrorHandling } from "@/lib/apiError";
import { getOrCreateStripeCustomer } from "@/lib/stripeCustomer";

/**
 * Guest-triggered version of the same authorization the daily
 * /api/cron/security-deposits sweep does automatically - lets a guest who
 * wants to get it out of the way start it themselves once they're within
 * the window, rather than only ever waiting for the cron. Deliberately
 * still gated by needsDepositAuthorization: authorizing any earlier would
 * risk the card hold expiring before check-in even arrives (see that
 * function's own comment).
 */
async function postHandler(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const stripe = getStripeClient();
  if (!stripe) {
    return NextResponse.json({ error: "Security deposits are not available right now" }, { status: 501 });
  }

  const booking = await prisma.booking.findUnique({
    where: { id },
    include: { listing: true },
  });
  if (!booking) {
    return NextResponse.json({ error: "Booking not found" }, { status: 404 });
  }
  if (booking.guestId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // A guest re-submitting (double-click, a second tab) reuses the same
  // still-open session rather than minting a second one - the same
  // reasoning as the main booking checkout's own session reuse.
  if (booking.stripeDepositSessionId) {
    const existing = await stripe.checkout.sessions.retrieve(booking.stripeDepositSessionId);
    if (existing.status === "open" && existing.url) {
      return NextResponse.json({ url: existing.url });
    }
  }

  if (!needsDepositAuthorization(booking)) {
    return NextResponse.json(
      {
        error:
          booking.depositStatus !== "AWAITING_AUTHORIZATION"
            ? "This booking doesn't have a deposit hold to authorize"
            : "It's too early to authorize this deposit - check back closer to your check-in date",
      },
      { status: 409 },
    );
  }

  const baseUrl = BASE_URL;
  const checkoutSession = await createDepositCheckoutSession(stripe, {
    bookingId: booking.id,
    depositCents: booking.securityDepositCents,
    listingTitle: booking.listing.title,
    customerId: await getOrCreateStripeCustomer(stripe, prisma, booking.guestId),
    successUrl: `${baseUrl}/bookings/${booking.id}?deposit_authorized=1`,
    cancelUrl: `${baseUrl}/bookings/${booking.id}`,
  });

  await prisma.booking.update({
    where: { id: booking.id },
    data: { stripeDepositSessionId: checkoutSession.id },
  });

  return NextResponse.json({ url: checkoutSession.url });
}

export const POST = withApiErrorHandling(postHandler);
