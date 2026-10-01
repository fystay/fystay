import { NextResponse } from "next/server";
import { withApiErrorHandling } from "@/lib/apiError";
import { isAuthorizedCronRequest } from "@/lib/cronAuth";
import { prisma } from "@/lib/prisma";
import { getStripeClient } from "@/lib/stripe";
import {
  createDepositCheckoutSession,
  isDepositClaimExpired,
  needsDepositAuthorization,
} from "@/lib/securityDeposit";
import { sendDepositAuthorizationRequestEmail, sendDepositResolvedEmail } from "@/lib/notificationEmails";

/**
 * Daily housekeeping for security deposits (see src/lib/securityDeposit.ts
 * for why both of these are time-sensitive, not just occasional cleanup):
 *
 * 1. Start authorization for any CONFIRMED booking that's just entered its
 *    DEPOSIT_AUTHORIZATION_WINDOW_DAYS window - the guest's own "Authorize
 *    now" button (POST .../deposit/authorize) covers a guest who comes
 *    back on their own; this covers everyone else.
 * 2. Auto-release any AUTHORIZED hold whose claim window has closed with
 *    no claim filed - protects the guest from a card hold a host simply
 *    never acts on, and protects against Stripe's own authorization
 *    naturally lapsing uncancelled.
 *
 * One combined route rather than two, since both are cheap daily sweeps
 * over the same small set of bookings.
 */
async function getHandler(request: Request) {
  if (!isAuthorizedCronRequest(request, process.env.SECURITY_DEPOSIT_CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const stripe = getStripeClient();
  if (!stripe) {
    return NextResponse.json({ error: "Stripe is not configured" }, { status: 501 });
  }

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";

  const awaitingAuthorization = await prisma.booking.findMany({
    where: { status: "CONFIRMED", depositStatus: "AWAITING_AUTHORIZATION" },
    include: { listing: { include: { host: true } } },
  });

  let authorizationsStarted = 0;
  for (const booking of awaitingAuthorization) {
    if (!needsDepositAuthorization(booking)) continue;
    try {
      const checkoutSession = await createDepositCheckoutSession(stripe, {
        bookingId: booking.id,
        depositCents: booking.securityDepositCents,
        listingTitle: booking.listing.title,
        guestEmail: booking.guestEmail,
        successUrl: `${baseUrl}/bookings/${booking.id}?deposit_authorized=1`,
        cancelUrl: `${baseUrl}/bookings/${booking.id}`,
      });
      await prisma.booking.update({
        where: { id: booking.id },
        data: { stripeDepositSessionId: checkoutSession.id },
      });
      await sendDepositAuthorizationRequestEmail(
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
        booking.securityDepositCents,
        checkoutSession.url ?? `${baseUrl}/bookings/${booking.id}`,
      );
      authorizationsStarted += 1;
    } catch (error) {
      console.error(`deposit authorization failed for booking ${booking.id}:`, error);
    }
  }

  const authorized = await prisma.booking.findMany({
    where: { depositStatus: "AUTHORIZED" },
    include: { listing: { include: { host: true } } },
  });

  let released = 0;
  for (const booking of authorized) {
    if (!isDepositClaimExpired(booking) || !booking.stripeDepositPaymentIntentId) continue;
    try {
      await stripe.paymentIntents.cancel(booking.stripeDepositPaymentIntentId);
      await prisma.booking.update({
        where: { id: booking.id },
        data: { depositStatus: "RELEASED", depositReleasedAt: new Date() },
      });
      await sendDepositResolvedEmail(
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
        { outcome: "released", depositCents: booking.securityDepositCents },
      );
      released += 1;
    } catch (error) {
      console.error(`deposit auto-release failed for booking ${booking.id}:`, error);
    }
  }

  return NextResponse.json({ ranAt: new Date().toISOString(), authorizationsStarted, released });
}

export const GET = withApiErrorHandling(getHandler);
