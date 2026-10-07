import { NextResponse } from "next/server";
import { withApiErrorHandling } from "@/lib/apiError";
import { isAuthorizedCronRequest } from "@/lib/cronAuth";
import { reportError, withCronMonitor } from "@/lib/observability";
import { prisma } from "@/lib/prisma";
import { getStripeClient } from "@/lib/stripe";
import {
  createDepositCheckoutSession,
  isDepositClaimExpired,
  needsDepositAuthorization,
} from "@/lib/securityDeposit";
import { sendDepositAuthorizationRequestEmail, sendDepositResolvedEmail } from "@/lib/notificationEmails";
import { BASE_URL } from "@/lib/baseUrl";
import { getOrCreateStripeCustomer } from "@/lib/stripeCustomer";
import { DepositAlreadyResolvedError, releaseDeposit, transferDepositToHost } from "@/lib/depositSettlement";

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
 * 3. Retry any captured claim whose transfer to the host failed.
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

  const baseUrl = BASE_URL;

  const awaitingAuthorization = await prisma.booking.findMany({
    where: { status: "CONFIRMED", depositStatus: "AWAITING_AUTHORIZATION" },
    include: { listing: { include: { host: true } } },
  });

  let authorizationsStarted = 0;
  for (const booking of awaitingAuthorization) {
    if (!needsDepositAuthorization(booking)) continue;
    try {
      // Already asked and the link is still open: don't send another one
      // each day (an older link would stay payable alongside the new one).
      if (booking.stripeDepositSessionId) {
        const existing = await stripe.checkout.sessions.retrieve(booking.stripeDepositSessionId);
        if (existing.status === "open") continue;
      }
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
      reportError(error, { area: "deposits", message: "deposit authorization request failed", bookingId: booking.id });
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
      try {
        await releaseDeposit(stripe, prisma, booking.id, booking.stripeDepositPaymentIntentId);
      } catch (error) {
        // The host claimed or released it themselves in the meantime.
        if (error instanceof DepositAlreadyResolvedError) continue;
        throw error;
      }
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
      reportError(error, { area: "deposits", message: "deposit auto-release failed", bookingId: booking.id });
    }
  }

  // Claims whose transfer to the host failed at the time (see
  // transferDepositToHost) - retried until they go through.
  const untransferred = await prisma.booking.findMany({
    where: { depositStatus: "CAPTURED", depositTransferId: null, depositCapturedCents: { gt: 0 } },
    select: {
      id: true,
      reference: true,
      stripeDepositPaymentIntentId: true,
      depositCapturedCents: true,
      listing: { select: { host: { select: { stripeConnectAccountId: true } } } },
    },
  });
  let transfersRetried = 0;
  for (const booking of untransferred) {
    if (!booking.stripeDepositPaymentIntentId || !booking.depositCapturedCents) continue;
    const sent = await transferDepositToHost(stripe, prisma, {
      id: booking.id,
      reference: booking.reference,
      stripeDepositPaymentIntentId: booking.stripeDepositPaymentIntentId,
      hostConnectAccountId: booking.listing.host.stripeConnectAccountId,
      depositCapturedCents: booking.depositCapturedCents,
    });
    if (sent) transfersRetried += 1;
  }

  return NextResponse.json({ ranAt: new Date().toISOString(), authorizationsStarted, released, transfersRetried });
}

export const GET = withCronMonitor("security-deposits", "0 8 * * *", "SECURITY_DEPOSIT_CRON_SECRET", withApiErrorHandling(getHandler));
