import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { isRequestedRangeStillAvailable } from "@/lib/availability";
import { sendBookingRequestRespondedEmail } from "@/lib/notificationEmails";
import { withApiErrorHandling } from "@/lib/apiError";
import { BASE_URL } from "@/lib/baseUrl";
import { withListingAvailabilityLock } from "@/lib/availabilityLock";
import { giveBackReservedDiscounts } from "@/lib/bookingLifecycle";

const respondSchema = z.object({ action: z.enum(["approve", "decline"]) });

/**
 * A host accepting or declining a request-to-book request (see
 * Listing.instantBook and BookingApprovalStatus) - the equivalent of
 * change-requests/[requestId]/respond, but for the booking itself rather
 * than a change to an existing one, since a request never had a payment to
 * unwind in the first place.
 */
async function postHandler(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const parsed = respondSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const booking = await prisma.booking.findUnique({
    where: { id },
    include: { listing: { include: { host: true } } },
  });

  if (!booking) {
    return NextResponse.json({ error: "Booking not found" }, { status: 404 });
  }
  if (booking.listing.hostId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (booking.approvalStatus !== "AWAITING") {
    return NextResponse.json(
      { error: "This request has already been responded to" },
      { status: 409 },
    );
  }

  const baseUrl = BASE_URL;
  const emailCtx = {
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
  };

  // Every response claims the request with a conditional update - still
  // AWAITING and still PENDING when the write lands - so a double click, the
  // host's second tab, or the expiry sweep running at the same moment can't
  // each act on it. Only the request that flips it does anything else.
  const stillAwaiting = { id, status: "PENDING" as const, approvalStatus: "AWAITING" as const };
  const alreadyResponded = NextResponse.json(
    { error: "This request has already been responded to" },
    { status: 409 },
  );

  if (parsed.data.action === "decline") {
    // Never charged - so nothing to refund except the referral credit (see
    // referral.ts) and any promo code redemption the guest had spent on
    // this booking at creation. Unlike an instant-book PENDING booking
    // that simply goes unpaid, a decline here is entirely the host's call,
    // not something the guest let lapse.
    const declined = await prisma.$transaction(async (tx) => {
      const { count } = await tx.booking.updateMany({
        where: stillAwaiting,
        data: { status: "CANCELLED", approvalStatus: "DECLINED", hostRespondedAt: new Date() },
      });
      if (count === 0) return false;
      await giveBackReservedDiscounts(tx, booking);
      return true;
    });
    if (!declined) return alreadyResponded;
    await sendBookingRequestRespondedEmail(
      { ...emailCtx, bookingUrl: `${baseUrl}/bookings/${booking.id}` },
      "declined",
    );
    return NextResponse.json({ status: "declined" });
  }

  // Approving: re-check availability, since the dates may have been booked
  // or blocked by something else while this request sat awaiting a
  // decision (up to REQUEST_HOLD_HOURS). The check and the approval run
  // under the listing's availability lock, so nothing can take the dates
  // between them. An expired request can't be approved even if the sweep
  // hasn't got to it yet - its hold has already lapsed.
  const now = new Date();
  if (booking.requestExpiresAt && booking.requestExpiresAt <= now) {
    return NextResponse.json({ error: "This request has expired" }, { status: 409 });
  }
  const outcome =await withListingAvailabilityLock(prisma, booking.listingId, async (tx) => {
    const isAvailable = await isRequestedRangeStillAvailable(tx, {
      listingId: booking.listingId,
      roomTypeId: booking.roomTypeId,
      roomsBooked: booking.roomsBooked,
      excludeBookingId: booking.id,
      checkIn: booking.checkIn,
      checkOut: booking.checkOut,
    });
    if (!isAvailable) return "unavailable" as const;
    const { count } = await tx.booking.updateMany({
      where: { ...stillAwaiting, requestExpiresAt: { gt: now } },
      data: { approvalStatus: "APPROVED", hostRespondedAt: now },
    });
    return count > 0 ? ("approved" as const) : ("not_awaiting" as const);
  });
  if (outcome === "unavailable") {
    return NextResponse.json(
      { error: "Those dates are no longer available" },
      { status: 409 },
    );
  }
  if (outcome === "not_awaiting") return alreadyResponded;

  await sendBookingRequestRespondedEmail(
    { ...emailCtx, bookingUrl: `${baseUrl}/checkout/${booking.id}` },
    "approved",
  );

  return NextResponse.json({ status: "approved" });
}

export const POST = withApiErrorHandling(postHandler);
