import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { heldRepeatBookingWhere } from "@/lib/heldBooking";
import {
  blockingBookingWhere,
  blockingRanges,
  blocksForRoomType,
  isRangeAvailable,
  isRoomTypeRangeAvailable,
  nightsBetween,
} from "@/lib/availability";
import { computeBookingPricing, maxFyStayDiscountCents, stayRates } from "@/lib/pricing";
import { lastMinuteDiscountFor } from "@/lib/deals";
import { computePromoDiscount, normalizePromoCode, validatePromoCode } from "@/lib/promoCode";
import { checkRateLimit, clientIp, rateLimitedResponse } from "@/lib/rateLimit";
import { parseStayDate, todayStayDate } from "@/lib/stayDates";
import { withApiErrorHandling } from "@/lib/apiError";

const querySchema = z.object({
  checkIn: z.string().min(1),
  checkOut: z.string().min(1),
  guests: z.coerce.number().int().min(1),
  roomTypeId: z.string().min(1).optional(),
  roomsBooked: z.coerce.number().int().min(1).max(20).optional(),
  promoCode: z.string().min(1).max(40).optional(),
});

/**
 * A read-only preview of what a promo code would do to this total - never
 * increments PromoCode.redemptionCount (that only happens at real booking
 * creation, see the bookings route), so typing a code in and never
 * finishing checkout costs it nothing.
 */
async function previewPromoDiscount(
  promoCodeInput: string,
  pricing: { totalPriceCents: number; serviceFeeCents: number; taxCents: number },
): Promise<{ valid: true; discountCents: number } | { valid: false; error: string }> {
  const promoCode = await prisma.promoCode.findUnique({
    where: { code: normalizePromoCode(promoCodeInput) },
  });
  if (!promoCode) return { valid: false, error: "Invalid promo code" };
  const validation = validatePromoCode(promoCode);
  if (!validation.valid) return { valid: false, error: validation.error };
  return {
    valid: true,
    // Capped the same way as the real booking (see maxFyStayDiscountCents).
    discountCents: Math.min(
      computePromoDiscount(promoCode.discountType, promoCode.discountValue, pricing.totalPriceCents),
      maxFyStayDiscountCents(pricing),
    ),
  };
}

/**
 * A read-only preview: tells the widget whether a date range/guest count
 * could be booked right now, and what it would cost, without creating (or
 * holding) a reservation. The actual booking creation endpoint re-validates
 * everything itself, since availability can change between this check and
 * that request.
 */
async function getHandler(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const parsed = querySchema.safeParse({
    checkIn: searchParams.get("checkIn"),
    checkOut: searchParams.get("checkOut"),
    guests: searchParams.get("guests"),
    roomTypeId: searchParams.get("roomTypeId") ?? undefined,
    roomsBooked: searchParams.get("roomsBooked") ?? undefined,
    promoCode: searchParams.get("promoCode") ?? undefined,
  });

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  // This is a public, unauthenticated, read-only endpoint that also tells
  // the caller whether an arbitrary ?promoCode= is valid and, if so, its
  // exact discount - without it, nothing stops a script from working
  // through codes to find ones that redeem. Ordinary date-availability
  // checks (no promoCode) aren't limited here; only guessing attempts are.
  if (parsed.data.promoCode) {
    const rateLimit = await checkRateLimit({
      key: `promo-preview:${clientIp(request)}`,
      limit: 20,
      windowMs: 15 * 60 * 1000,
    });
    if (!rateLimit.allowed) return rateLimitedResponse(rateLimit);
  }

  const checkIn = parseStayDate(parsed.data.checkIn);
  const checkOut = parseStayDate(parsed.data.checkOut);
  if (!checkIn || !checkOut) {
    return NextResponse.json({ error: "Invalid dates" }, { status: 400 });
  }
  if (checkOut <= checkIn) {
    return NextResponse.json(
      { available: false, error: "Check-out date must be after check-in date" },
      { status: 200 },
    );
  }
  const today = todayStayDate();
  if (checkIn < today) {
    return NextResponse.json(
      { available: false, error: "Check-in date must be in the future" },
      { status: 200 },
    );
  }

  if (parsed.data.roomTypeId) {
    const roomsBooked = parsed.data.roomsBooked ?? 1;
    const roomType = await prisma.roomType.findUnique({
      where: { id: parsed.data.roomTypeId },
      include: {
        listing: {
          select: {
            id: true,
            published: true,
            cleaningFeeCents: true,
            weeklyDiscountPercent: true,
            monthlyDiscountPercent: true,
            lastMinuteDiscountPercent: true,
            lastMinuteWindowDays: true,
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
        availabilityBlocks: { select: { startDate: true, endDate: true } },
      },
    });

    if (!roomType || roomType.listing.id !== id || !roomType.listing.published) {
      return NextResponse.json({ error: "Room type not found" }, { status: 404 });
    }
    if (parsed.data.guests > roomType.maxGuests * roomsBooked) {
      return NextResponse.json(
        {
          available: false,
          error: `This room type sleeps up to ${roomType.maxGuests} guests per room`,
        },
        { status: 200 },
      );
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
      return NextResponse.json(
        { available: false, error: "Those dates are not available for this room type" },
        { status: 200 },
      );
    }

    const nights = nightsBetween(checkIn, checkOut);
    const pricing = computeBookingPricing({
      nights,
      pricePerNightCents: roomType.pricePerNightCents * roomsBooked,
      cleaningFeeCents: roomType.listing.cleaningFeeCents,
      weeklyDiscountPercent: roomType.listing.weeklyDiscountPercent,
      monthlyDiscountPercent: roomType.listing.monthlyDiscountPercent,
      lastMinuteDiscountPercent: lastMinuteDiscountFor(roomType.listing, checkIn),
    });
    const promo = parsed.data.promoCode
      ? await previewPromoDiscount(parsed.data.promoCode, pricing)
      : undefined;

    return NextResponse.json({ available: true, nights, pricing, promo });
  }

  const listing = await prisma.listing.findUnique({
    where: { id },
    include: {
      bookings: { where: blockingBookingWhere(), select: { id: true, checkIn: true, checkOut: true } },
      availabilityBlocks: { select: { startDate: true, endDate: true } },
    },
  });

  // The signed-in guest's own held booking for exactly this stay doesn't
  // count against them - re-checking after Back from checkout should say
  // "available" and let them carry on with that same booking (POST
  // /api/bookings hands it back), not report their own hold as taken.
  const session = await auth();
  const ownHeld = session?.user
    ? await prisma.booking.findFirst({
        where: heldRepeatBookingWhere({
          guestId: session.user.id,
          listingId: id,
          checkIn,
          checkOut,
          guests: parsed.data.guests,
        }),
        select: { id: true },
      })
    : null;
  const blockingBookings = ownHeld
    ? (listing?.bookings ?? []).filter((booking) => booking.id !== ownHeld.id)
    : (listing?.bookings ?? []);

  if (!listing || !listing.published) {
    return NextResponse.json({ error: "Listing not found" }, { status: 404 });
  }
  if (parsed.data.guests > listing.maxGuests) {
    return NextResponse.json(
      { available: false, error: `This listing sleeps up to ${listing.maxGuests} guests` },
      { status: 200 },
    );
  }
  if (!isRangeAvailable(checkIn, checkOut, blockingRanges(blockingBookings, listing.availabilityBlocks))) {
    return NextResponse.json(
      { available: false, error: "Those dates are not available" },
      { status: 200 },
    );
  }

  const nights = nightsBetween(checkIn, checkOut);
  const pricing = computeBookingPricing({
    nights,
    ...stayRates(listing, checkIn, checkOut),
    cleaningFeeCents: listing.cleaningFeeCents,
    weeklyDiscountPercent: listing.weeklyDiscountPercent,
    monthlyDiscountPercent: listing.monthlyDiscountPercent,
    lastMinuteDiscountPercent: lastMinuteDiscountFor(listing, checkIn),
  });
  const promo = parsed.data.promoCode
    ? await previewPromoDiscount(parsed.data.promoCode, pricing)
    : undefined;

  return NextResponse.json({ available: true, nights, pricing, promo });
}

export const GET = withApiErrorHandling(getHandler);
