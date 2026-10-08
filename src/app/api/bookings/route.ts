import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { withApiErrorHandling } from "@/lib/apiError";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import {
  blockingBookingWhere,
  blockingRanges,
  blocksForRoomType,
  isRangeAvailable,
  isRoomTypeRangeAvailable,
  nightsBetween,
  REQUEST_HOLD_HOURS,
  stayLengthError,
} from "@/lib/availability";
import { computeBookingPricing, maxFyStayDiscountCents } from "@/lib/pricing";
import { cancellationTermsSnapshot } from "@/lib/cancellationPolicy";
import { lastMinuteDiscountFor } from "@/lib/deals";
import { generateBookingReference } from "@/lib/bookingReference";
import { completePastBookings, expireAbandonedCheckouts, expireStaleBookingRequests } from "@/lib/bookingLifecycle";
import { computeCreditToApply } from "@/lib/referral";
import { computePromoDiscount, normalizePromoCode, validatePromoCode } from "@/lib/promoCode";
import { sendBookingRequestReceivedEmail } from "@/lib/notificationEmails";
import { checkRateLimit, rateLimitedResponse } from "@/lib/rateLimit";
import { isSuspended } from "@/lib/suspension";
import { heldRepeatBookingWhere } from "@/lib/heldBooking";
import { HOST_NOT_PAYMENT_READY_MESSAGE, hostAcceptsPaidBookings } from "@/lib/stripeConnect";
import { PRIVATE_LISTING_FIELDS } from "@/lib/listingPrivacy";
import { parseStayDate, todayStayDate } from "@/lib/stayDates";
import { BASE_URL } from "@/lib/baseUrl";
import { withListingAvailabilityLock } from "@/lib/availabilityLock";

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
  await expireAbandonedCheckouts(prisma, { guestId: session.user.id });

  const bookings = await prisma.booking.findMany({
    where: { guestId: session.user.id },
    include: { listing: { omit: PRIVATE_LISTING_FIELDS } },
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
  const checkIn = parseStayDate(parsed.data.checkIn);
  const checkOut = parseStayDate(parsed.data.checkOut);

  if (!checkIn || !checkOut) {
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
  const today = todayStayDate();
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
          : // Any guest count: going Back and changing it (or the count
            // resetting) shouldn't leave the guest blocked by their own hold.
            { guestId: session.user.id, listingId: listingId!, checkIn, checkOut },
      ),
      orderBy: { createdAt: "desc" },
    });
    if (heldBooking && heldBooking.guests !== guests) {
      // The price doesn't depend on the guest count, so the hold is updated
      // in place - within the listing's capacity, as a new booking would be.
      const listing = await prisma.listing.findUnique({ where: { id: heldBooking.listingId }, select: { maxGuests: true } });
      if (!listing || guests > listing.maxGuests) {
        return NextResponse.json({ error: `This listing sleeps up to ${listing?.maxGuests ?? 0} guests` }, { status: 400 });
      }
      const updated = await prisma.booking.update({ where: { id: heldBooking.id }, data: { guests } });
      return NextResponse.json({ booking: updated, reused: true }, { status: 200 });
    }
    if (heldBooking) {
      return NextResponse.json({ booking: heldBooking, reused: true }, { status: 200 });
    }
  }

  const guestAccount = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { name: true, email: true },
  });

  // Every booking is created under its listing's availability lock (see
  // availabilityLock.ts): two guests hitting "Continue to checkout" for the
  // same overlapping dates at the same instant queue on that lock, and the
  // second one's availability check - run after it holds the lock - sees
  // the first one's booking and gets a normal 409. Every other writer that
  // can take dates (payment confirmation, approving a request or a date
  // change, host blocks) takes the same lock, so none of them can race a
  // new booking either. A room type is locked by its listing, the same key
  // a listing-wide block's writer uses.
  //
  // This used to rely on a SERIALIZABLE transaction alone, which only
  // protected booking creation from other booking creations - see
  // withListingAvailabilityLock for why the lock needs READ COMMITTED.
  const lockListingId = roomTypeId
    ? (await prisma.roomType.findUnique({ where: { id: roomTypeId }, select: { listingId: true } }))?.listingId
    : listingId!;
  if (!lockListingId) {
    return NextResponse.json({ error: "Room type not found" }, { status: 404 });
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const result = await withListingAvailabilityLock(prisma, lockListingId, async (tx) => {
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
      });

      const { booking, listingTitle, city, host } = result;

      if (booking.approvalStatus === "AWAITING") {
        const baseUrl = BASE_URL;
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
      // generated one. P2034 (a write conflict) and DiscountRaceError (the
      // guest's credit, or a capped promo code's last slot, was spent by
      // another booking between our read and our write): also worth a quiet
      // retry, which re-reads the current values.
      const isRetryable =
        error instanceof DiscountRaceError ||
        (error instanceof Prisma.PrismaClientKnownRequestError &&
          (error.code === "P2002" || error.code === "P2034"));
      if (!isRetryable || attempt === 2) {
        if (error instanceof DiscountRaceError) {
          return NextResponse.json(
            { error: "Your credit balance or promo code changed while booking. Please try again." },
            { status: 409 },
          );
        }
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
 * combined discount can never exceed the total either way. Both writes are
 * conditional on what was just read still holding (a redemption slot still
 * free, the balance still covering the credit), so two bookings racing for
 * the last redemption of a capped code, or for the same guest's balance -
 * possibly on different listings, so not serialized by the availability
 * lock - can't both succeed: the loser throws DiscountRaceError and the
 * outer retry loop re-reads the now-current values.
 */
async function applyPromoAndCredit(
  tx: Prisma.TransactionClient,
  params: {
    promoCodeInput: string | undefined;
    guestId: string;
    totalBeforeDiscountsCents: number;
    /** maxFyStayDiscountCents: discounts never cut into the host's payout. */
    discountCapCents: number;
  },
): Promise<{ promoCodeId: string | null; promoDiscountCents: number; creditAppliedCents: number }> {
  const { promoCodeInput, guestId, totalBeforeDiscountsCents, discountCapCents } = params;

  let promoCodeId: string | null = null;
  let promoDiscountCents = 0;
  let remainingCents = Math.min(totalBeforeDiscountsCents, discountCapCents);

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

    // One use per person, and only from a proven email address - otherwise
    // a "first booking" code works on every booking, and on every made-up
    // account. The lock makes two bookings by the same guest with the same
    // code queue, so the second sees the first.
    const guest = await tx.user.findUniqueOrThrow({ where: { id: guestId }, select: { emailVerifiedAt: true } });
    if (!guest.emailVerifiedAt) {
      throw new BookingRequestError(403, "Please verify your email address to use a promo code - we've sent you a link.");
    }
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`promo:${promoCode.id}:${guestId}`}::text, 0))`;
    const alreadyUsed = await tx.booking.count({
      where: {
        guestId,
        promoCodeId: promoCode.id,
        // A reservation that was never paid gave its redemption back.
        NOT: { status: "CANCELLED", paymentStatus: "UNPAID" },
      },
    });
    if (alreadyUsed > 0) {
      throw new BookingRequestError(409, "You've already used this promo code.");
    }
    promoDiscountCents = Math.min(
      computePromoDiscount(promoCode.discountType, promoCode.discountValue, totalBeforeDiscountsCents),
      remainingCents,
    );
    promoCodeId = promoCode.id;
    remainingCents -= promoDiscountCents;
    const redeemed = await tx.promoCode.updateMany({
      where: {
        id: promoCode.id,
        ...(promoCode.maxRedemptions !== null && { redemptionCount: { lt: promoCode.maxRedemptions } }),
      },
      data: { redemptionCount: { increment: 1 } },
    });
    if (redeemed.count === 0) throw new DiscountRaceError();
  }

  // Read-and-decrement inside this same transaction, not from a value read
  // earlier - two bookings by the same guest racing each other must not
  // both spend the same balance.
  const guestCredit = await tx.user.findUniqueOrThrow({
    where: { id: guestId },
    select: { creditBalanceCents: true },
  });
  const creditAppliedCents = computeCreditToApply(guestCredit.creditBalanceCents, remainingCents);
  if (creditAppliedCents > 0) {
    const spent = await tx.user.updateMany({
      where: { id: guestId, creditBalanceCents: { gte: creditAppliedCents } },
      data: { creditBalanceCents: { decrement: creditAppliedCents } },
    });
    if (spent.count === 0) throw new DiscountRaceError();
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
      host: { select: { name: true, email: true, stripeConnectChargesEnabled: true, stripeConnectPayoutsEnabled: true } },
      bookings: {
        where: blockingBookingWhere(),
        select: { checkIn: true, checkOut: true },
      },
      availabilityBlocks: {
        select: { startDate: true, endDate: true },
      },
      _count: { select: { roomTypes: true } },
    },
  });

  if (!listing || !listing.published) {
    throw new BookingRequestError(404, "Listing not found");
  }
  // A hotel is sold by room type: its own price and counted inventory live
  // on each RoomType, so booking the listing as a single unit would take the
  // listing's headline rate and ignore how many rooms are actually left.
  if (listing.propertyType === "HOTEL" || listing._count.roomTypes > 0) {
    throw new BookingRequestError(400, "Choose a room type");
  }
  if (isSuspended(listing)) {
    throw new BookingRequestError(403, "This listing is currently unavailable.");
  }
  if (listing.hostId === guestId) {
    throw new BookingRequestError(403, "You can't book your own listing");
  }
  if (!hostAcceptsPaidBookings(listing.host)) {
    throw new BookingRequestError(409, HOST_NOT_PAYMENT_READY_MESSAGE);
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

  // Decided here, at booking time, from the stay's check-in date - and
  // snapshotted on the booking like every other price input.
  const lastMinuteDiscountPercent = lastMinuteDiscountFor(listing, checkIn);
  const pricing = computeBookingPricing({
    nights,
    pricePerNightCents: listing.pricePerNightCents,
    cleaningFeeCents: listing.cleaningFeeCents,
    weeklyDiscountPercent: listing.weeklyDiscountPercent,
    monthlyDiscountPercent: listing.monthlyDiscountPercent,
    lastMinuteDiscountPercent,
  });

  // Spent at creation, not at payment: if this PENDING booking is later
  // abandoned and expires unpaid (see PENDING_BOOKING_HOLD_MINUTES), the
  // credit and any promo redemption aren't currently refunded/released -
  // the same trade-off as a guest simply not completing checkout in time.
  const { promoCodeId, promoDiscountCents, creditAppliedCents } = await applyPromoAndCredit(tx, {
    promoCodeInput: promoCode,
    guestId,
    totalBeforeDiscountsCents: pricing.totalPriceCents,
    discountCapCents: maxFyStayDiscountCents(pricing),
  });

  // instantBook is read at the moment of booking, not re-checked later - a
  // host flipping the setting must never retroactively change a request
  // that's already awaiting (or already got) a decision.
  const requiresApproval = !listing.instantBook;

  const createdBooking = await tx.booking.create({
    data: {
      reference: generateBookingReference(),
      // The policy the guest is shown now is the one they get if they cancel.
      ...cancellationTermsSnapshot(listing),
      listingId,
      guestId,
      checkIn,
      checkOut,
      guests,
      nights,
      nightlyPriceCents: listing.pricePerNightCents,
      lengthOfStayDiscountCents: pricing.lengthOfStayDiscountCents,
      lengthOfStayDiscountLabel: pricing.lengthOfStayDiscountLabel,
      lastMinuteDiscountPercent,
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
 * The HOTEL room-type path. Runs under the same listing availability lock
 * as the single-unit path (see postHandler), so the counted-inventory read
 * below - this room type's overlapping bookings, its own blocks and the
 * listing-wide ones - can't be overtaken by a concurrent writer before the
 * insert. Only isRoomTypeRangeAvailable passing on that read allows the
 * insert below to happen at all.
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
      listing: {
        include: {
          host: { select: { name: true, email: true, stripeConnectChargesEnabled: true, stripeConnectPayoutsEnabled: true } },
          // A listing-wide block (an iCal import) closes every room type too.
          availabilityBlocks: {
            where: { roomTypeId: null },
            select: { startDate: true, endDate: true, roomTypeId: true },
          },
        },
      },
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
  if (!hostAcceptsPaidBookings(listing.host)) {
    throw new BookingRequestError(409, HOST_NOT_PAYMENT_READY_MESSAGE);
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
      blocksForRoomType(roomType.availabilityBlocks, roomType.listing.availabilityBlocks),
    )
  ) {
    throw new BookingRequestError(409, "Those dates are not available for this room type");
  }

  // The whole-reservation per-night total (one room's rate * how many
  // rooms) - see Booking.roomsBooked's own schema comment for why the
  // multiplication happens here rather than inside computeBookingPricing.
  const nightlyPriceCents = roomType.pricePerNightCents * roomsBooked;
  const lastMinuteDiscountPercent = lastMinuteDiscountFor(listing, checkIn);
  const pricing = computeBookingPricing({
    nights,
    pricePerNightCents: nightlyPriceCents,
    cleaningFeeCents: listing.cleaningFeeCents,
    weeklyDiscountPercent: listing.weeklyDiscountPercent,
    monthlyDiscountPercent: listing.monthlyDiscountPercent,
    lastMinuteDiscountPercent,
  });

  const { promoCodeId, promoDiscountCents, creditAppliedCents } = await applyPromoAndCredit(tx, {
    promoCodeInput: promoCode,
    guestId,
    totalBeforeDiscountsCents: pricing.totalPriceCents,
    discountCapCents: maxFyStayDiscountCents(pricing),
  });

  const requiresApproval = !listing.instantBook;

  const createdBooking = await tx.booking.create({
    data: {
      reference: generateBookingReference(),
      // The policy the guest is shown now is the one they get if they cancel.
      ...cancellationTermsSnapshot(listing),
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
      lastMinuteDiscountPercent,
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

/** A conditional credit/promo write lost a race with another booking; postHandler retries. */
class DiscountRaceError extends Error {}

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
