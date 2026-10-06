import { NextResponse } from "next/server";
import { withApiErrorHandling } from "@/lib/apiError";
import { isAuthorizedCronRequest } from "@/lib/cronAuth";
import { prisma } from "@/lib/prisma";
import { expireAbandonedCheckouts, expireStaleBookingRequests } from "@/lib/bookingLifecycle";
import { sendBookingRequestRespondedEmail } from "@/lib/notificationEmails";
import { BASE_URL } from "@/lib/baseUrl";

/**
 * Daily backstop for request-to-book requests (see Listing.instantBook)
 * the host never responded to. expireStaleBookingRequests itself already
 * runs lazily whenever a guest's or host's own bookings are read, so this
 * only matters for a request neither of them happens to check back on -
 * this app has no background job runner to fire the moment
 * requestExpiresAt actually passes, so a guest can wait up to a day past
 * that deadline for this email if they never open their booking in the
 * meantime.
 */
async function getHandler(request: Request) {
  if (!isAuthorizedCronRequest(request, process.env.BOOKING_REQUEST_CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const baseUrl = BASE_URL;
  const expired = await expireStaleBookingRequests(prisma);
  // Same daily backstop for reservations nobody paid for (see
  // expireAbandonedCheckouts) - no email: the guest chose not to pay.
  const abandonedCheckouts = await expireAbandonedCheckouts(prisma);

  for (const booking of expired) {
    try {
      await sendBookingRequestRespondedEmail(
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
        "expired",
      );
    } catch (error) {
      console.error(`expiry email failed for booking ${booking.id}:`, error);
    }
  }

  return NextResponse.json({ expiredAt: new Date().toISOString(), count: expired.length, abandonedCheckouts });
}

export const GET = withApiErrorHandling(getHandler);
