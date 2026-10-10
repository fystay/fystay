import type { PrismaClient, Booking } from "@prisma/client";
import { getStripeClient } from "@/lib/stripe";
import { bookingPayments, RefundIncompleteError, refundAcrossPayments } from "@/lib/connectRefunds";
import { bookingCancellationTerms, previewCancellation, type CancellationPreview } from "@/lib/cancellationPolicy";
import { sendBookingCancelledEmails, sendPaymentOpsAlertEmail } from "@/lib/notificationEmails";
import { giveBackReservedDiscounts } from "@/lib/bookingLifecycle";
import { formatPrice } from "@/lib/format";
import { pushBookingCancellation } from "@/lib/pms/sync";
import { BASE_URL } from "@/lib/baseUrl";
import { DepositAlreadyResolvedError, releaseDeposit } from "@/lib/depositSettlement";
import { reportError } from "@/lib/observability";

export type CancellableBooking = Booking & {
  listing: {
    title: string;
    city: string;
    cancellationPolicy: "FLEXIBLE" | "MODERATE" | "STRICT" | "NON_REFUNDABLE" | "CUSTOM";
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
    listing: bookingCancellationTerms(booking),
    wasPaid,
    totalPriceCents: booking.totalPriceCents,
    checkIn: booking.checkIn,
    now,
    paidAt: booking.paidAt,
    refundPercentOverride,
  });

  // Claim the cancellation before any money moves: of two cancellations
  // racing on one booking (a double tap, or the guest and support at the
  // same moment), only the one that flips the status gets to refund -
  // otherwise both would, and a 50% policy would pay out 100%.
  // A booking that was never paid for gives back the referral credit and
  // promo redemption it reserved, in the same transaction as the claim -
  // exactly what releaseUnpaidBooking does when the same unpaid booking
  // expires instead of being cancelled, so whichever happens first the guest
  // gets them back once.
  const releasesDiscounts = booking.status === "PENDING" && booking.paymentStatus === "UNPAID";
  const claimed = await prisma.$transaction(async (tx) => {
    const result = await tx.booking.updateMany({
      // totalPriceCents too: a date-change payment landing after this
      // booking was read would otherwise be refunded from the old total.
      where: {
        id: booking.id,
        status: booking.status,
        paymentStatus: booking.paymentStatus,
        totalPriceCents: booking.totalPriceCents,
      },
      data: { status: "CANCELLED" },
    });
    if (result.count > 0 && releasesDiscounts) await giveBackReservedDiscounts(tx, booking);
    return result;
  });
  if (claimed.count === 0) throw new BookingAlreadyProcessedError();

  let refundedCents = refund.refundCents;
  const stripe = getStripeClient();
  // An unpaid booking's payment page could otherwise still be paid after
  // cancelling (the payment would be refunded, but FYStay keeps Stripe's
  // fee on it). Best-effort: a page that already closed is fine.
  if (stripe && releasesDiscounts && booking.stripeSessionId) {
    await stripe.checkout.sessions.expire(booking.stripeSessionId).catch(() => {});
  }
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
      if (!(error instanceof RefundIncompleteError)) {
        // Stripe refused the refund before any money moved: put the booking
        // back as it was, so it's never left cancelled without the money the
        // policy promised.
        await prisma.booking.updateMany({
          where: { id: booking.id, status: "CANCELLED" },
          data: { status: booking.status },
        });
        throw error;
      }
      // Part of the refund already went back (one of several payments
      // refunded, the next refused). Putting the booking back as CONFIRMED
      // would be a lie - the guest has some of their money - so it stays
      // cancelled, the booking records what was actually refunded, and a
      // person is told to send the rest.
      refundedCents = error.refundedCents;
      reportError(error.cause, { area: "payments", message: "cancellation refund only partly went through", bookingId: booking.id });
      try {
        await sendPaymentOpsAlertEmail({
          subject: "A cancellation refund only partly went through",
          summary: `Booking cancelled. ${formatPrice(error.refundedCents)} of the ${formatPrice(error.requestedCents)} refund went back to the guest, then Stripe refused the rest.`,
          amountCents: error.requestedCents - error.refundedCents,
          bookingReference: booking.reference,
          action:
            "Refund the remaining amount to the guest from the booking's payments in the Stripe Dashboard (or another way if Stripe keeps refusing), then note it on the booking's support ticket.",
          stripeUrl: `https://dashboard.stripe.com/payments/${booking.stripePaymentIntentId}`,
        });
      } catch (alertError) {
        // The cancellation and what was refunded are already true; the
        // error log above still names the booking for someone to follow up.
        reportError(alertError, { area: "email", message: "partial-refund alert not sent", bookingId: booking.id });
      }
    }
  }

  const paymentStatus = !wasPaid
    ? booking.paymentStatus
    : refundedCents === 0
      ? "PAID"
      : refundedCents >= refund.amountPaidCents
        ? "REFUNDED"
        : "PARTIALLY_REFUNDED";

  const updated = await prisma.booking.update({
    where: { id: booking.id },
    data: {
      status: "CANCELLED",
      paymentStatus,
      ...(wasPaid ? { refundedAmountCents: refundedCents } : {}),
      ...(wasPaid && refundedCents > 0 ? { refundedAt: now } : {}),
    },
  });

  await settleDepositOnCancellation(prisma, booking.id);
  await settleTripExtrasOnCancellation(prisma, booking);

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
      // What actually went back - less than the policy amount if Stripe
      // refused part of it (the rest is with support, per the alert above).
      wasPaid ? refundedCents : 0,
    );
    // Best-effort, same reasoning as pushBookingReservation in the Stripe
    // webhook - never throws, resolves to "not_mapped" for a booking whose
    // room was never PMS-mapped in the first place.
    await pushBookingCancellation(prisma, booking.id);
  }

  return { updated, refund, wasPaid };
}

/**
 * A cancelled stay has nothing for a deposit to cover: an active hold is
 * released from the guest's card, and one not yet placed is called off
 * (its open authorization link expired, so it can't be completed later).
 * Best-effort - the cancellation itself has already happened; a hold
 * Stripe won't release here still auto-releases at its claim deadline.
 */
async function settleDepositOnCancellation(prisma: PrismaClient, bookingId: string) {
  const stripe = getStripeClient();
  try {
    // Read now, after the cancellation is recorded - not from the snapshot
    // the caller loaded before it - so a hold the guest authorized in the
    // meantime is the one released here rather than left on their card.
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: { id: true, depositStatus: true, stripeDepositPaymentIntentId: true, stripeDepositSessionId: true },
    });
    if (!booking) return;
    if (booking.depositStatus === "AUTHORIZED" && booking.stripeDepositPaymentIntentId && stripe) {
      await releaseDeposit(stripe, prisma, booking.id, booking.stripeDepositPaymentIntentId);
    } else if (booking.depositStatus === "AWAITING_AUTHORIZATION") {
      await prisma.booking.updateMany({
        where: { id: booking.id, depositStatus: "AWAITING_AUTHORIZATION" },
        data: { depositStatus: "NOT_REQUIRED" },
      });
      if (booking.stripeDepositSessionId && stripe) {
        await stripe.checkout.sessions.expire(booking.stripeDepositSessionId).catch(() => {
          // Already completed or expired - the webhook cancels any hold it produced.
        });
      }
    }
  } catch (error) {
    if (error instanceof DepositAlreadyResolvedError) return;
    reportError(error, { area: "deposits", message: "deposit not settled after cancellation", bookingId });
  }
}

/**
 * Trip Extras are separate payments to FYStay for a stay that's no longer
 * happening, so the cancellation deals with each one:
 * - awaiting payment: its payment page is closed and it's cancelled (a
 *   payment that completes anyway is refunded by the webhook, which only
 *   records extras on a CONFIRMED booking);
 * - paid, but not yet with the provider: refunded in full and marked
 *   REFUNDED. fulfillBookingExtra won't hand an extra over once the booking
 *   is cancelled, so nothing can send it between this read and the refund;
 * - paid and already with the provider (or mid-handoff): not refunded
 *   automatically - the provider may already have committed a driver or
 *   charged FYStay - so a person is asked to sort it out with them.
 * Best-effort per extra, like the deposit above: the cancellation itself has
 * already happened, and any extra that can't be settled here alerts ops.
 */
async function settleTripExtrasOnCancellation(prisma: PrismaClient, booking: Pick<Booking, "id" | "reference">) {
  const extras = await prisma.bookingExtra.findMany({
    where: { bookingId: booking.id, status: { in: ["PENDING_PAYMENT", "PAID"] } },
    select: {
      id: true,
      status: true,
      priceCents: true,
      stripeSessionId: true,
      stripePaymentIntentId: true,
      fulfillmentStatus: true,
      sentToProviderAt: true,
    },
  });
  if (extras.length === 0) return;
  const stripe = getStripeClient();

  const alertOps = async (extra: (typeof extras)[number], summary: string, action: string) => {
    try {
      await sendPaymentOpsAlertEmail({
        subject: "A cancelled booking's trip extra needs a refund decision",
        summary,
        amountCents: extra.priceCents,
        bookingReference: booking.reference,
        action,
        stripeUrl: extra.stripePaymentIntentId
          ? `https://dashboard.stripe.com/payments/${extra.stripePaymentIntentId}`
          : "https://dashboard.stripe.com/payments",
      });
    } catch (alertError) {
      reportError(alertError, { area: "email", message: "trip extra alert not sent", bookingId: booking.id });
    }
  };

  for (const extra of extras) {
    try {
      if (extra.status === "PENDING_PAYMENT") {
        if (stripe && extra.stripeSessionId) {
          await stripe.checkout.sessions.expire(extra.stripeSessionId).catch(() => {
            // Already completed or expired - the webhook refunds a payment that completed.
          });
        }
        await prisma.bookingExtra.updateMany({
          where: { id: extra.id, status: "PENDING_PAYMENT" },
          data: { status: "CANCELLED" },
        });
        continue;
      }

      const notYetWithProvider =
        !extra.sentToProviderAt && (extra.fulfillmentStatus === "PENDING" || extra.fulfillmentStatus === "FAILED");
      if (!notYetWithProvider) {
        await alertOps(
          extra,
          `Booking cancelled, but one of its paid trip extras was already handed to the provider (${extra.fulfillmentStatus}), so it wasn't refunded automatically.`,
          "Ask the provider to cancel the job, then refund the guest from the extra's payment in the Stripe Dashboard if they agree (or explain to the guest why not).",
        );
        continue;
      }

      if (!stripe && !extra.stripePaymentIntentId) {
        // Paid through the dev-mode fallback: nothing was ever charged.
        await prisma.bookingExtra.updateMany({
          where: { id: extra.id, status: "PAID", fulfillmentStatus: { in: ["PENDING", "FAILED"] } },
          data: { status: "CANCELLED" },
        });
        continue;
      }
      if (!stripe || !extra.stripePaymentIntentId) {
        await alertOps(
          extra,
          "Booking cancelled, but one of its paid trip extras couldn't be refunded automatically (no payment on record to refund).",
          "Find the extra's payment in the Stripe Dashboard and refund it to the guest.",
        );
        continue;
      }

      // Trip Extras are plain charges to FYStay (no host transfer to
      // reverse). Keyed per extra, so a retried cancellation refunds once.
      await refundAcrossPayments(
        stripe,
        [{ paymentIntentId: extra.stripePaymentIntentId, viaConnect: false }],
        extra.priceCents,
        `trip-extra-cancel:${extra.id}`,
      );
      await prisma.bookingExtra.updateMany({
        where: { id: extra.id, status: "PAID", fulfillmentStatus: { in: ["PENDING", "FAILED"] } },
        data: { status: "REFUNDED" },
      });
    } catch (error) {
      reportError(error, { area: "payments", message: `trip extra ${extra.id} not refunded after cancellation`, bookingId: booking.id });
      await alertOps(
        extra,
        "Booking cancelled, but refunding one of its paid trip extras failed.",
        "Refund the extra's payment to the guest from the Stripe Dashboard, then mark it refunded.",
      );
    }
  }
}
