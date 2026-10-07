import { NextResponse } from "next/server";
import { withApiErrorHandling } from "@/lib/apiError";
import { isAuthorizedCronRequest } from "@/lib/cronAuth";
import { reportError, withCronMonitor } from "@/lib/observability";
import { prisma } from "@/lib/prisma";
import {
  ARRIVAL_REMINDER_WINDOW_DAYS,
  REVIEW_REQUEST_DELAY_DAYS,
  needsArrivalReminder,
  needsReviewRequest,
  needsTransferUpsellEmail,
} from "@/lib/bookingLifecycleEmails";
import {
  sendArrivalReminderEmail,
  sendReviewRequestEmail,
  sendTransferUpsellEmail,
} from "@/lib/notificationEmails";
import { getActiveOfferingByCategory } from "@/lib/travelAddons";
import { BASE_URL } from "@/lib/baseUrl";

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

/**
 * Daily sweep for the two proactive guest emails this app doesn't otherwise
 * send: an arrival reminder a couple of days before check-in, and a review
 * request a day after checkout (see src/lib/bookingLifecycleEmails.ts for
 * the exact eligibility rules). One combined route rather than two, same
 * reasoning as security-deposits' own cron - both are cheap daily sweeps
 * over a small set of bookings. Each query below is a coarse DB-level
 * filter, same two-step shape as that cron: needsArrivalReminder/
 * needsReviewRequest make the real, precise, unit-tested call per row. One
 * booking failing to send is logged and skipped, never fatal to the rest
 * of the run.
 */
async function getHandler(request: Request) {
  if (!isAuthorizedCronRequest(request, process.env.BOOKING_LIFECYCLE_CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const baseUrl = BASE_URL;
  const now = new Date();

  const arrivalCandidates = await prisma.booking.findMany({
    where: {
      status: "CONFIRMED",
      paymentStatus: "PAID",
      arrivalReminderSentAt: null,
      checkIn: { gte: now, lte: addDays(now, ARRIVAL_REMINDER_WINDOW_DAYS) },
    },
    include: { listing: { include: { host: true } } },
  });

  let arrivalRemindersSent = 0;
  for (const booking of arrivalCandidates) {
    if (!needsArrivalReminder(booking, now)) continue;
    try {
      await sendArrivalReminderEmail(
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
        {
          address: booking.listing.address,
          checkInTime: booking.listing.checkInTime,
          checkInInstructions: booking.listing.checkInInstructions,
          wifiNetwork: booking.listing.wifiNetwork,
          wifiPassword: booking.listing.wifiPassword,
        },
      );
      await prisma.booking.update({
        where: { id: booking.id },
        data: { arrivalReminderSentAt: now },
      });
      arrivalRemindersSent += 1;
    } catch (error) {
      reportError(error, { area: "cron", message: "arrival reminder not sent", bookingId: booking.id });
    }
  }

  const reviewCandidates = await prisma.booking.findMany({
    where: {
      status: { in: ["CONFIRMED", "COMPLETED"] },
      reviewRequestSentAt: null,
      review: null,
      checkOut: { lte: addDays(now, -REVIEW_REQUEST_DELAY_DAYS) },
    },
    include: { listing: { include: { host: true } }, review: { select: { id: true } } },
  });

  let reviewRequestsSent = 0;
  for (const booking of reviewCandidates) {
    if (!needsReviewRequest(booking, now)) continue;
    try {
      await sendReviewRequestEmail(
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
        // The review form itself only lives inline on the "My trips" list
        // (see BookingCard/canReviewBooking), not on the booking detail
        // page - this points straight there rather than a query param the
        // trips page doesn't read.
        `${baseUrl}/bookings`,
      );
      await prisma.booking.update({
        where: { id: booking.id },
        data: { reviewRequestSentAt: now },
      });
      reviewRequestsSent += 1;
    } catch (error) {
      reportError(error, { area: "cron", message: "review request not sent", bookingId: booking.id });
    }
  }

  let transferUpsellEmailsSent = 0;
  const transferOffering = await getActiveOfferingByCategory("AIRPORT_TRANSFER");
  if (transferOffering) {
    const transferCandidates = await prisma.booking.findMany({
      where: { status: "CONFIRMED", paymentStatus: "PAID", transferUpsellEmailSentAt: null },
      include: { listing: { include: { host: true } } },
    });

    const bookingIdsWithTransfer = new Set(
      (
        await prisma.bookingExtra.findMany({
          where: {
            bookingId: { in: transferCandidates.map((b) => b.id) },
            offeringId: transferOffering.id,
            status: "PAID",
          },
          select: { bookingId: true },
        })
      ).map((extra) => extra.bookingId),
    );

    for (const booking of transferCandidates) {
      const hasAirportTransfer = bookingIdsWithTransfer.has(booking.id);
      if (!needsTransferUpsellEmail(booking, hasAirportTransfer, now)) continue;
      try {
        await sendTransferUpsellEmail(
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
          {
            providerName: transferOffering.providerName,
            priceCents: transferOffering.priceCents,
            transferUrl: `${baseUrl}/bookings/${booking.id}#trip-extras`,
          },
        );
        await prisma.booking.update({
          where: { id: booking.id },
          data: { transferUpsellEmailSentAt: now },
        });
        transferUpsellEmailsSent += 1;
      } catch (error) {
        reportError(error, { area: "cron", message: "transfer offer email not sent", bookingId: booking.id });
      }
    }
  }

  return NextResponse.json({
    ranAt: now.toISOString(),
    arrivalRemindersSent,
    reviewRequestsSent,
    transferUpsellEmailsSent,
  });
}

export const GET = withCronMonitor("booking-lifecycle-emails", "0 10 * * *", "BOOKING_LIFECYCLE_CRON_SECRET", withApiErrorHandling(getHandler));
