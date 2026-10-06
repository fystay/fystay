import type { PrismaClient, Booking } from "@prisma/client";
import { getStripeClient } from "@/lib/stripe";
import { bookingPayments, refundAcrossPayments } from "@/lib/connectRefunds";
import { previewCancellation, type CancellationPreview } from "@/lib/cancellationPolicy";
import { sendBookingCancelledEmails } from "@/lib/notificationEmails";
import { pushBookingCancellation } from "@/lib/pms/sync";
import { BASE_URL } from "@/lib/baseUrl";

export type CancellableBooking = Booking & {
  listing: {
    title: string;
    city: string;
    cancellationPolicy: "FLEXIBLE" | "MODERATE" | "STRICT" | "CUSTOM";
    customCancellationCutoffDays: number | null;
    customCancellationRefundPercent: number | null;
    host: { name: string; email: string };
  };
};

/**
 * The single place a booking is actually cancelled and (if it was paid for)
 * refunded - shared by the guest-initiated cancel route
 * (src/app/api/bookings/[id]/cancel/route.ts) and the admin manual-cancel
 * route (src/app/api/admin/bookings/[id]/cancel/route.ts), so there is only
 * ever one implementation of "what does cancelling this booking actually
 * do": recompute the refund via previewCancellation (never trust a refund
 * amount from a request body), issue the Stripe refund (Connect-aware, same
 * as the original charge), update the booking's status/paymentStatus, and -
 * only for a booking that had actually reached CONFIRMED, exactly like the
 * pre-existing guest flow - send the cancellation emails and push the
 * cancellation to any connected PMS.
 *
 * refundPercentOverride is the one behavioral difference the admin route
 * needs: a support-chosen flat refund percentage instead of the listing's
 * own cancellation-policy tiers. Every other caller omits it and gets the
 * exact same policy-driven refund the guest-facing flow always has.
 */
/** Thrown when another request cancelled (or otherwise moved on) this booking first. */
export class BookingAlreadyProcessedError extends Error {
  constructor() {
    super("This booking has already been cancelled or completed.");
    this.name = "BookingAlreadyProcessedError";
  }
}

export async function cancelBookingAndRefund(
  prisma: PrismaClient,
  booking: CancellableBooking,
  options: { refundPercentOverride?: number; now?: Date } = {},
): Promise<{ updated: Booking; refund: CancellationPreview; wasPaid: boolean }> {
  const { refundPercentOverride, now = new Date() } = options;
  const wasPaid = booking.paymentStatus === "PAID";

  const refund = previewCancellation({
    listing: booking.listing,
    wasPaid,
    totalPriceCents: booking.totalPriceCents,
    checkIn: booking.checkIn,
    now,
    refundPercentOverride,
  });

  // Claim the cancellation before any money moves: of two cancellations
  // racing on one booking (a double tap, or the guest and support at the
  // same moment), only the one that flips the status gets to refund -
  // otherwise both would, and a 50% policy would pay out 100%.
  const claimed = await prisma.booking.updateMany({
    where: { id: booking.id, status: booking.status, paymentStatus: booking.paymentStatus },
    data: { status: "CANCELLED" },
  });
  if (claimed.count === 0) throw new BookingAlreadyProcessedError();

  const stripe = getStripeClient();
  if (stripe && wasPaid && refund.refundCents > 0 && booking.stripePaymentIntentId) {
    try {
      // totalPriceCents includes any paid date changes, which were separate
      // payments - so the refund is spread across all of them rather than
      // asked of the original payment alone (which Stripe would reject if it
      // came to more than that payment). Each destination-charge payment
      // reverses the same proportion of the host's payout and FYStay's fee
      // as it refunds - see Booking.hostPaidViaConnect and connectRefunds.ts.
      const changeRequests = await prisma.bookingChangeRequest.findMany({
        where: { bookingId: booking.id, paidAt: { not: null } },
        select: { stripeSessionId: true, paidAt: true, hostPaidViaConnect: true },
      });
      const payments = await bookingPayments(stripe, { ...booking, changeRequests });
      await refundAcrossPayments(stripe, payments, refund.refundCents, `booking-cancel:${booking.id}`);
    } catch (error) {
      // Stripe refused the refund: put the booking back as it was, so it's
      // never left cancelled without the money the policy promised.
      await prisma.booking.updateMany({
        where: { id: booking.id, status: "CANCELLED" },
        data: { status: booking.status },
      });
      throw error;
    }
  }

  const paymentStatus = !wasPaid
    ? booking.paymentStatus
    : refund.refundCents === 0
      ? "PAID"
      : refund.refundCents >= refund.amountPaidCents
        ? "REFUNDED"
        : "PARTIALLY_REFUNDED";

  const updated = await prisma.booking.update({
    where: { id: booking.id },
    data: {
      status: "CANCELLED",
      paymentStatus,
      ...(wasPaid ? { refundedAmountCents: refund.refundCents } : {}),
      ...(wasPaid && refund.refundCents > 0 ? { refundedAt: now } : {}),
    },
  });

  // Only when the booking was already CONFIRMED - a still-PENDING one was
  // never paid for or announced to the host in the first place (no
  // confirmation email ever went out for it), so a cancellation notice
  // would reference a booking neither side has actually seen yet. A
  // still-PENDING booking was also never pushed to a PMS (only the
  // checkout.session.completed webhook does that), so there's nothing to
  // cancel there either.
  if (booking.status === "CONFIRMED") {
    const baseUrl = BASE_URL;
    await sendBookingCancelledEmails(
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
      wasPaid ? refund.refundCents : 0,
    );
    // Best-effort, same reasoning as pushBookingReservation in the Stripe
    // webhook - never throws, resolves to "not_mapped" for a booking whose
    // room was never PMS-mapped in the first place.
    await pushBookingCancellation(prisma, booking.id);
  }

  return { updated, refund, wasPaid };
}
