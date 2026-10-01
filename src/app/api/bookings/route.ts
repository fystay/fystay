import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { withApiErrorHandling } from "@/lib/apiError";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import {
  blockingBookingWhere,
  blockingRanges,
  isRangeAvailable,
  isRoomTypeRangeAvailable,
  nightsBetween,
  REQUEST_HOLD_HOURS,
  stayLengthError,
} from "@/lib/availability";
import { computeBookingPricing } from "@/lib/pricing";
import { generateBookingReference } from "@/lib/bookingReference";
import { completePastBookings, expireStaleBookingRequests } from "@/lib/bookingLifecycle";
import { computeCreditToApply } from "@/lib/referral";
import { computePromoDiscount, normalizePromoCode, validatePromoCode } from "@/lib/promoCode";
import { sendBookingRequestReceivedEmail } from "@/lib/notificationEmails";
import { checkRateLimit, rateLimitedResponse } from "@/lib/rateLimit";
import { isSuspended } from "@/lib/suspension";
import { heldRepeatBookingWhere } from "@/lib/heldBooking";

// Exactly one of listingId (every non-hotel booking, unchanged) or
// roomTypeId (a HOTEL listing's room type, with roomsBooked defaulting to
// 1) must be given - never both, never neither.
const createBookingSchema = z
  .object({
    listingId: z.string().min(1).optional(),
    roomTypeId: z.string().min(1).optional(),
    roomsBooked: z.number().int().min(1).max(20).optional(),
    checkIn: z.string().min(1),
    checkOut: z.string().min(1),
    guests: z.number().int().min(1),
    promoCode: z.string().min(1).max(40).optional(),
  })
  .refine((data) => Boolean(data.listingId) !== Boolean(data.roomTypeId), {
    message: "Provide either a listing or a room type to book",
  });

async function getHandler() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await completePastBookings(prisma, session.user.id);
  await expireStaleBookingRequests(prisma, { guestId: session.user.id });

  const bookings = await prisma.booking.findMany({
    where: { guestId: session.user.id },
    include: { listing: true },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ bookings });
}

async function postHandler(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Keyed by guest, not IP: a PENDING booking briefly holds real dates
  // (see PENDING_BOOKING_HOLD_MINUTES in availability.ts), so a single
  // compromised or malicious account spamming this endpoint across many
  // listings could lock out real guests even without ever paying - this
  // caps that before it costs anyone else their booking, without limiting
  // how many *different* guests can book at once.
  const rateLimit = await checkRateLimit({
    key: `bookings:create:${session.user.id}`,
    limit: 20,
    windowMs: 5 * 60 * 1000,
  });
  if (!rateLimit.allowed) return rateLimitedResponse(rateLimit);

  const body = await request.json();
  const parsed = createBookingSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const { listingId, roomTypeId, guests, promoCode } = parsed.data;
  const roomsBooked = parsed.data.roomsBooked ?? 1;
  const checkIn = new Date(parsed.data.checkIn);
  const checkOut = new Date(parsed.data.checkOut);

  if (Number.isNaN(checkIn.getTime()) || Number.isNaN(checkOut.getTime())) {
    return NextResponse.json({ error: "Invalid dates" }, { status: 400 });
  }
  if (checkOut <= checkIn) {
    return NextResponse.json(
      { error: "Check-out date must be after check-in date" },
      { status: 400 },
    );
  }
  // The calendar UI already disables past dates, but that's client-side
  // only, so enforce it here too, since this endpoint is reachable directly.
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (checkIn < today) {
    return NextResponse.json({ error: "Check-in date must be in the future" }, { status: 400 });
  }

  // A repeat submission for exactly the same stay - a double-click, or Back
  // from checkout then Reserve again - gets the guest's own still-held,
  // unpaid booking back instead of colliding with its hold as "dates not
  // available". Instant-book only (a request awaiting the host is a
  // different flow), and not when a promo code is being applied this time.
  if (!promoCode) {
    const heldBooking = await prisma.booking.findFirst({
      where: heldRepeatBookingWhere(
        roomTypeId
          ? { guestId: session.user.id, roomTypeId, roomsBooked, checkIn, checkOut, guests }
          : { guestId: session.user.id, listingId: listingId!, checkIn, checkOut, guests },
      ),
      orderBy: { createdAt: "desc" },
    });
    if (heldBooking) {
      return NextResponse.json({ booking: heldBooking, reused: true }, { status: 200 });
    }
  }

  const guestAccount = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { name: true, email: true },
  });

  // Wrapped in a SERIALIZABLE transaction: two guests hitting "Continue to
  // checkout" for the same overlapping dates at the same instant must not
  // both pass the availability check before either has committed a row.
  // Postgres detects the conflict and aborts one side with a serialization
  // failure, which is caught below and turned into a normal 409. The
  // room-type branch extends the exact same guarantee to counted inventory -
  // see isRoomTypeRangeAvailable's own comment and createRoomTypeBooking
  // below for how.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const result = await prisma.$transaction(
        async (tx) => {
          if (roomTypeId) {
            return createRoomTypeBooking(tx, {
              roomTypeId,
              roomsBooked,
              checkIn,
              checkOut,
              guests,
              guestId: session.user.id,
              guestAccount,
              promoCode,
            });
          }
          return createListingBooking(tx, {
            listingId: listingId!,
            checkIn,
            checkOut,
            guests,
            guestId: session.user.id,
            guestAccount,
            promoCode,
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );

      const { booking, listingTitle, city, host } = result;

      if (booking.approvalStatus === "AWAITING") {
        const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";
        await sendBookingRequestReceivedEmail(
          {
            reference: booking.reference,
            listingTitle,
            city,
            checkIn: booking.checkIn,
            checkOut: booking.checkOut,
            nights: booking.nights,
            guests: booking.guests,
            totalPriceCents: booking.totalPriceCents,
            guestName: booking.guestName,
            guestEmail: booking.guestEmail,
            hostName: host.name,
            hostEmail: host.email,
            bookingUrl: `${baseUrl}/host/dashboard`,
          },
          REQUEST_HOLD_HOURS,
        );
      }

      return NextResponse.json({ booking }, { status: 201 });
    } catch (error) {
      if (error instanceof BookingRequestError) {
        return NextResponse.json({ error: error.message }, { status: error.status });
      }
      // P2002: the near-impossible reference collision. Retry with a freshly
      // generated one. P2034: a genuine serialization conflict with another
      // concurrent booking attempt for the same listing; also worth one
      // quiet retry, since the loser of the race may now see the dates as
      // taken (correct) rather than needing the guest to resubmit by hand.
      const isRetryable =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === "P2002" || error.code === "P2034");
      if (!isRetryable || attempt === 2) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
          return NextResponse.json(
            { error: "Those dates were just booked by someone else. Please try again." },
            { status: 409 },
          );
        }
        throw error;
      }
    }
  }

  return NextResponse.json({ error: "Could not create booking" }, { status: 500 });
}

type NewBookingParams = {
  checkIn: Date;
  checkOut: Date;
  guests: number;
  guestId: string;
  guestAccount: { name: string; email: string } | null;
  promoCode?: string;
};

/**
 * Applies an optional PromoCode and then the guest's referral credit, in
 * that order, to a booking's pre-discount total - the two stack (a
 * confirmed product decision), so the credit is computed against what's
 * left after the promo discount rather than the full total, and the
 * combined discount can never exceed the total either way. Redemption is
 * incremented inside this same transaction: two guests racing for the last
 * redemption of a capped code can't both succeed, by the identical
 * SERIALIZABLE mechanism already relied on for room-type inventory (see
 * isRoomTypeRangeAvailable's own comment) - one loses to a P2034 and the
 * outer retry loop re-validates against the now-current redemptionCount.
 */
async function applyPromoAndCredit(
  tx: Prisma.TransactionClient,
  params: { promoCodeInput: string | undefined; guestId: string; totalBeforeDiscountsCents: number },
): Promise<{ promoCodeId: string | null; promoDiscountCents: number; creditAppliedCents: number }> {
  const { promoCodeInput, guestId, totalBeforeDiscountsCents } = params;

  let promoCodeId: string | null = null;
  let promoDiscountCents = 0;
  let remainingCents = totalBeforeDiscountsCents;

  if (promoCodeInput) {
    const promoCode = await tx.promoCode.findUnique({
      where: { code: normalizePromoCode(promoCodeInput) },
    });
    if (!promoCode) {
      throw new BookingRequestError(400, "Invalid promo code");
    }
    const validation = validatePromoCode(promoCode);
    if (!validation.valid) {
      throw new BookingRequestError(400, validation.error);
    }
    promoDiscountCents = computePromoDiscount(
      promoCode.discountType,
      promoCode.discountValue,
      remainingCents,
    );
    promoCodeId = promoCode.id;
    remainingCents -= promoDiscountCents;
    await tx.promoCode.update({
      where: { id: promoCode.id },
      data: { redemptionCount: { increment: 1 } },
    });
  }

  // Read-and-decrement inside this same transaction, not from a value read
  // earlier - two bookings by the same guest racing each other must not
  // both spend the same balance (see the pre-existing comment this
  // replaces, one call site down, for the same reasoning).
  const guestCredit = await tx.user.findUniqueOrThrow({
    where: { id: guestId },
    select: { creditBalanceCents: true },
  });
  const creditAppliedCents = computeCreditToApply(guestCredit.creditBalanceCents, remainingCents);
  if (creditAppliedCents > 0) {
    await tx.user.update({
      where: { id: guestId },
      data: { creditBalanceCents: { decrement: creditAppliedCents } },
    });
  }

  return { promoCodeId, promoDiscountCents, creditAppliedCents };
}

/** The pre-existing single-unit path, byte-for-byte unchanged in behavior. */
async function createListingBooking(
  tx: Prisma.TransactionClient,
  params: NewBookingParams & { listingId: string },
) {
  const { listingId, checkIn, checkOut, guests, guestId, guestAccount, promoCode } = params;

  const listing = await tx.listing.findUnique({
    where: { id: listingId },
    include: {
      host: { select: { name: true, email: true } },
      bookings: {
        where: blockingBookingWhere(),
        select: { checkIn: true, checkOut: true },
      },
      availabilityBlocks: {
        select: { startDate: true, endDate: true },
      },
    },
  });

  if (!listing || !listing.published) {
    throw new BookingRequestError(404, "Listing not found");
  }
  if (isSuspended(listing)) {
    throw new BookingRequestError(403, "This listing is currently unavailable.");
  }
  if (listing.hostId === guestId) {
    throw new BookingRequestError(403, "You can't book your own listing");
  }
  if (guests > listing.maxGuests) {
    throw new BookingRequestError(400, `This listing sleeps up to ${listing.maxGuests} guests`);
  }
  const nights = nightsBetween(checkIn, checkOut);
  const lengthError = stayLengthError(nights, listing);
  if (lengthError) {
    throw new BookingRequestError(400, lengthError);
  }
  if (
    !isRangeAvailable(
      checkIn,
      checkOut,
      blockingRanges(listing.bookings, listing.availabilityBlocks),
    )
  ) {
    throw new BookingRequestError(409, "Those dates are not available");
  }

  const pricing = computeBookingPricing({
    nights,
    pricePerNightCents: listing.pricePerNightCents,
    cleaningFeeCents: listing.cleaningFeeCents,
    weeklyDiscountPercent: listing.weeklyDiscountPercent,
    monthlyDiscountPercent: listing.monthlyDiscountPercent,
  });

  // Spent at creation, not at payment: if this PENDING booking is later
  // abandoned and expires unpaid (see PENDING_BOOKING_HOLD_MINUTES), the
  // credit and any promo redemption aren't currently refunded/released -
  // the same trade-off as a guest simply not completing checkout in time.
  const { promoCodeId, promoDiscountCents, creditAppliedCents } = await applyPromoAndCredit(tx, {
    promoCodeInput: promoCode,
    guestId,
    totalBeforeDiscountsCents: pricing.totalPriceCents,
  });

  // instantBook is read at the moment of booking, not re-checked later - a
  // host flipping the setting must never retroactively change a request
  // that's already awaiting (or already got) a decision.
  const requiresApproval = !listing.instantBook;

  const createdBooking = await tx.booking.create({
    data: {
      reference: generateBookingReference(),
      listingId,
      guestId,
      checkIn,
      checkOut,
      guests,
      nights,
      nightlyPriceCents: listing.pricePerNightCents,
      lengthOfStayDiscountCents: pricing.lengthOfStayDiscountCents,
      lengthOfStayDiscountLabel: pricing.lengthOfStayDiscountLabel,
      cleaningFeeCents: pricing.cleaningFeeCents,
      serviceFeeCents: pricing.serviceFeeCents,
      taxCents: pricing.taxCents,
      creditAppliedCents,
      promoCodeId,
      promoDiscountCents,
      totalPriceCents: pricing.totalPriceCents - promoDiscountCents - creditAppliedCents,
      guestName: guestAccount?.name,
      guestEmail: guestAccount?.email,
      approvalStatus: requiresApproval ? "AWAITING" : "NONE",
      requestExpiresAt: requiresApproval
        ? new Date(Date.now() + REQUEST_HOLD_HOURS * 60 * 60 * 1000)
        : null,
      // Snapshotted now like every other price field, but the actual card
      // hold isn't placed until shortly before check-in - see
      // needsDepositAuthorization's own comment for why. A
      // PENDING/cancelled booking just never reaches that step; only a
      // CONFIRMED one does.
      securityDepositCents: listing.securityDepositCents,
      depositStatus: listing.securityDepositCents > 0 ? "AWAITING_AUTHORIZATION" : "NOT_REQUIRED",
    },
  });

  return {
    booking: createdBooking,
    listingTitle: listing.title,
    city: listing.city,
    host: listing.host,
  };
}

/**
 * The HOTEL room-type path. Extends the exact same SERIALIZABLE-transaction
 * guarantee to counted inventory: the `bookings` read below is scoped to
 * this roomTypeId *and* a date-overlap condition, so (with the schema's
 * @@index([roomTypeId, checkIn, checkOut])) Postgres's serializable
 * snapshot isolation predicate-locks exactly "bookings for this room type
 * that could overlap this stay" - any concurrent transaction that commits a
 * conflicting overlapping booking is guaranteed to be detected, even one
 * this read returned zero rows for. Only isRoomTypeRangeAvailable passing
 * on that scoped read allows the insert below to happen at all.
 */
async function createRoomTypeBooking(
  tx: Prisma.TransactionClient,
  params: NewBookingParams & { roomTypeId: string; roomsBooked: number },
) {
  const { roomTypeId, roomsBooked, checkIn, checkOut, guests, guestId, guestAccount, promoCode } =
    params;

  const roomType = await tx.roomType.findUnique({
    where: { id: roomTypeId },
    include: {
      listing: { include: { host: { select: { name: true, email: true } } } },
      bookings: {
        where: { ...blockingBookingWhere(), checkIn: { lt: checkOut }, checkOut: { gt: checkIn } },
        select: { checkIn: true, checkOut: true, roomsBooked: true },
      },
      availabilityBlocks: {
        select: { startDate: true, endDate: true },
      },
    },
  });

  if (!roomType || !roomType.listing.published) {
    throw new BookingRequestError(404, "Room type not found");
  }
  const { listing } = roomType;
  if (isSuspended(listing)) {
    throw new BookingRequestError(403, "This listing is currently unavailable.");
  }
  if (listing.hostId === guestId) {
    throw new BookingRequestError(403, "You can't book your own listing");
  }
  if (guests > roomType.maxGuests * roomsBooked) {
    throw new BookingRequestError(
      400,
      `This room type sleeps up to ${roomType.maxGuests} guests per room`,
    );
  }
  const nights = nightsBetween(checkIn, checkOut);
  const lengthError = stayLengthError(nights, listing);
  if (lengthError) {
    throw new BookingRequestError(400, lengthError);
  }
  if (
    !isRoomTypeRangeAvailable(
      checkIn,
      checkOut,
      roomsBooked,
      roomType.totalRooms,
      roomType.bookings,
      roomType.availabilityBlocks,
    )
  ) {
    throw new BookingRequestError(409, "Those dates are not available for this room type");
  }

  // The whole-reservation per-night total (one room's rate * how many
  // rooms) - see Booking.roomsBooked's own schema comment for why the
  // multiplication happens here rather than inside computeBookingPricing.
  const nightlyPriceCents = roomType.pricePerNightCents * roomsBooked;
  const pricing = computeBookingPricing({
    nights,
    pricePerNightCents: nightlyPriceCents,
    cleaningFeeCents: listing.cleaningFeeCents,
    weeklyDiscountPercent: listing.weeklyDiscountPercent,
    monthlyDiscountPercent: listing.monthlyDiscountPercent,
  });

  const { promoCodeId, promoDiscountCents, creditAppliedCents } = await applyPromoAndCredit(tx, {
    promoCodeInput: promoCode,
    guestId,
    totalBeforeDiscountsCents: pricing.totalPriceCents,
  });

  const requiresApproval = !listing.instantBook;

  const createdBooking = await tx.booking.create({
    data: {
      reference: generateBookingReference(),
      listingId: listing.id,
      roomTypeId: roomType.id,
      roomsBooked,
      guestId,
      checkIn,
      checkOut,
      guests,
      nights,
      nightlyPriceCents,
      lengthOfStayDiscountCents: pricing.lengthOfStayDiscountCents,
      lengthOfStayDiscountLabel: pricing.lengthOfStayDiscountLabel,
      cleaningFeeCents: pricing.cleaningFeeCents,
      serviceFeeCents: pricing.serviceFeeCents,
      taxCents: pricing.taxCents,
      creditAppliedCents,
      promoCodeId,
      promoDiscountCents,
      totalPriceCents: pricing.totalPriceCents - promoDiscountCents - creditAppliedCents,
      guestName: guestAccount?.name,
      guestEmail: guestAccount?.email,
      approvalStatus: requiresApproval ? "AWAITING" : "NONE",
      requestExpiresAt: requiresApproval
        ? new Date(Date.now() + REQUEST_HOLD_HOURS * 60 * 60 * 1000)
        : null,
      securityDepositCents: listing.securityDepositCents,
      depositStatus: listing.securityDepositCents > 0 ? "AWAITING_AUTHORIZATION" : "NOT_REQUIRED",
    },
  });

  return {
    booking: createdBooking,
    listingTitle: listing.title,
    city: listing.city,
    host: listing.host,
  };
}

class BookingRequestError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export const GET = withApiErrorHandling(getHandler);
export const POST = withApiErrorHandling(postHandler);
