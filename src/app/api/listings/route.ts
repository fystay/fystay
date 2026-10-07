import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { bookableHostWhere } from "@/lib/stripeConnect";
import { auth } from "@/auth";
import {
  blockingBookingWhere,
  blockingRanges,
  blocksForRoomType,
  isRangeAvailable,
  isRoomTypeRangeAvailable,
} from "@/lib/availability";
import { httpUrlSchema } from "@/lib/validation";
import { geocodeListing } from "@/lib/geocoding";
import { paginateListings, parsePageParam } from "@/lib/listingSearch";
import { PRIVATE_LISTING_FIELDS } from "@/lib/listingPrivacy";
import { parseStayDate } from "@/lib/stayDates";
import { withApiErrorHandling } from "@/lib/apiError";
import { lastMinuteDealInput, resolveLastMinuteDeal } from "@/lib/dealValidation";

const LISTINGS_API_PAGE_SIZE = 24;

// One category of room within a HOTEL listing (see prisma/schema.prisma's
// RoomType model). Every non-hotel property type has zero of these and
// keeps using the flat price/capacity fields below directly.
const roomTypeInputSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(2000).nullable().optional(),
  pricePerNightCents: z.number().int().positive(),
  maxGuests: z.number().int().min(1).max(50),
  bedrooms: z.number().int().min(0).max(50),
  beds: z.number().int().min(1).max(50),
  bathrooms: z.number().int().min(0).max(50),
  photos: z.array(httpUrlSchema).min(1),
  totalRooms: z.number().int().min(1).max(500),
});

const createListingSchema = z
  .object({
    title: z.string().min(3).max(120),
    description: z.string().min(10).max(5000),
    propertyType: z
      .enum(["APARTMENT", "HOUSE", "HOTEL", "COTTAGE", "VILLA", "STUDIO", "OTHER"])
      .optional(),
    city: z.string().min(1).max(100),
    country: z.string().min(1).max(100),
    address: z.string().max(200).optional(),
    // Required for every non-HOTEL property type (enforced below, since a
    // HOTEL listing instead takes its price/capacity from roomTypes and
    // these are simply ignored if a client somehow still sends them).
    pricePerNightCents: z.number().int().positive().optional(),
    cleaningFeeCents: z.number().int().min(0).default(0),
    weeklyDiscountPercent: z.number().int().min(0).max(90).nullable().optional(),
    monthlyDiscountPercent: z.number().int().min(0).max(90).nullable().optional(),
    ...lastMinuteDealInput,
    maxGuests: z.number().int().min(1).max(50).optional(),
    bedrooms: z.number().int().min(0).max(50).optional(),
    beds: z.number().int().min(1).max(50).optional(),
    bathrooms: z.number().int().min(0).max(50).optional(),
    photos: z.array(httpUrlSchema).min(1),
    amenities: z.array(z.string()).default([]),
    cancellationPolicy: z.enum(["FLEXIBLE", "MODERATE", "STRICT", "CUSTOM"]).optional(),
    customCancellationCutoffDays: z.number().int().min(0).max(90).optional(),
    customCancellationRefundPercent: z.number().int().min(0).max(100).optional(),
    minNights: z.number().int().min(1).max(365).optional(),
    maxNights: z.number().int().min(1).max(365).nullable().optional(),
    checkInTime: z.string().max(50).nullable().optional(),
    checkOutTime: z.string().max(50).nullable().optional(),
    selfCheckIn: z.boolean().optional(),
    instantBook: z.boolean().optional(),
    securityDepositCents: z.number().int().min(0).optional(),
    checkInInstructions: z.string().max(2000).nullable().optional(),
    wifiNetwork: z.string().max(100).nullable().optional(),
    wifiPassword: z.string().max(100).nullable().optional(),
    smokingAllowed: z.boolean().optional(),
    partiesAllowed: z.boolean().optional(),
    quietHoursStart: z.string().max(50).nullable().optional(),
    quietHoursEnd: z.string().max(50).nullable().optional(),
    additionalRules: z.string().max(2000).nullable().optional(),
    roomTypes: z.array(roomTypeInputSchema).optional(),
  })
  .refine(
    (data) =>
      data.cancellationPolicy !== "CUSTOM" ||
      (data.customCancellationCutoffDays !== undefined &&
        data.customCancellationRefundPercent !== undefined),
    { message: "A custom cancellation policy needs a cutoff and a refund percentage" },
  )
  .refine(
    (data) =>
      data.maxNights === undefined || data.maxNights === null || !data.minNights ||
      data.maxNights >= data.minNights,
    { message: "Maximum stay can't be shorter than the minimum stay" },
  )
  .superRefine((data, ctx) => {
    if (data.propertyType === "HOTEL") {
      if (!data.roomTypes || data.roomTypes.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "A hotel listing needs at least one room type",
          path: ["roomTypes"],
        });
      }
      return;
    }
    // Every non-hotel property type keeps requiring its own flat
    // price/capacity fields, exactly as before roomTypes existed.
    const requiredFields = ["pricePerNightCents", "maxGuests", "bedrooms", "beds", "bathrooms"] as const;
    for (const field of requiredFields) {
      if (data[field] === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Required",
          path: [field],
        });
      }
    }
  });

async function getHandler(request: Request) {
  const { searchParams } = new URL(request.url);
  const city = searchParams.get("city")?.trim();
  const guests = searchParams.get("guests");
  const minPrice = searchParams.get("minPrice");
  const maxPrice = searchParams.get("maxPrice");
  const checkInParam = searchParams.get("checkIn");
  const checkOutParam = searchParams.get("checkOut");
  const page = parsePageParam(searchParams.get("page") ?? undefined);

  const listings = await prisma.listing.findMany({
    where: {
      published: true,
      // A suspended listing is pulled out of search the same way an
      // unpublished one always has been - see Listing.suspendedAt's own
      // schema comment. Its own host (or an admin) can still reach it
      // directly by id (see the listing detail page), just not find it here.
      suspendedAt: null,
      ...bookableHostWhere(),
      ...(city
        ? {
            OR: [
              { city: { contains: city, mode: "insensitive" } },
              { country: { contains: city, mode: "insensitive" } },
            ],
          }
        : {}),
      ...(guests ? { maxGuests: { gte: Number(guests) } } : {}),
      ...(minPrice ? { pricePerNightCents: { gte: Number(minPrice) } } : {}),
      ...(maxPrice ? { pricePerNightCents: { lte: Number(maxPrice) } } : {}),
    },
    // Public search: never return arrival details, feed tokens or addresses.
    omit: PRIVATE_LISTING_FIELDS,
    include: {
      bookings: {
        where: blockingBookingWhere(),
        select: { checkIn: true, checkOut: true },
      },
      availabilityBlocks: {
        select: { startDate: true, endDate: true, roomTypeId: true },
      },
      // Only meaningful for a HOTEL listing (see `filtered` below) - empty
      // for every other property type.
      roomTypes: {
        select: {
          totalRooms: true,
          maxGuests: true,
          bookings: {
            where: blockingBookingWhere(),
            select: { checkIn: true, checkOut: true, roomsBooked: true },
          },
          availabilityBlocks: { select: { startDate: true, endDate: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
    // Same reasoning as ListingsGrid.tsx's own copy of this cap: the date/
    // room-type availability filter below runs in memory after the fetch,
    // so real pagination can't be pushed down to the query without losing
    // correctness. This bounds the worst case instead.
    take: 500,
  });

  const checkIn = checkInParam ? parseStayDate(checkInParam) : null;
  const checkOut = checkOutParam ? parseStayDate(checkOutParam) : null;
  const guestsNeeded = guests ? Number(guests) : 0;

  // A hotel with one fully-booked room type and another still free is still
  // bookable - see ListingsGrid.tsx's own copy of this same logic for the
  // guest-facing search page (a separate query, kept in sync by hand). The
  // room type also has to actually sleep the requested party (maxGuests),
  // not just have a free room - see that same file's comment for why.
  const filtered =
    checkIn && checkOut
      ? listings.filter((listing) =>
          listing.propertyType === "HOTEL"
            ? listing.roomTypes.some(
                (roomType) =>
                  roomType.maxGuests >= guestsNeeded &&
                  isRoomTypeRangeAvailable(
                    checkIn,
                    checkOut,
                    1,
                    roomType.totalRooms,
                    roomType.bookings,
                    blocksForRoomType(roomType.availabilityBlocks, listing.availabilityBlocks),
                  ),
              )
            : isRangeAvailable(
                checkIn,
                checkOut,
                blockingRanges(listing.bookings, listing.availabilityBlocks),
              ),
        )
      : listings;

  const paginated = paginateListings(filtered, page, LISTINGS_API_PAGE_SIZE);
  return NextResponse.json({
    listings: paginated.items,
    page: paginated.page,
    totalPages: paginated.totalPages,
    totalCount: paginated.totalCount,
  });
}

async function postHandler(request: Request) {
  const session = await auth();
  if (!session?.user || session.user.role !== "HOST") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const parsed = createListingSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const deal = resolveLastMinuteDeal(parsed.data);
  if ("error" in deal) {
    return NextResponse.json({ error: deal.error }, { status: 400 });
  }

  const { roomTypes, pricePerNightCents, maxGuests, bedrooms, beds, bathrooms, ...rest } =
    parsed.data;
  const isHotel = rest.propertyType === "HOTEL";

  // For a HOTEL listing, roomTypes (validated non-empty above) are the
  // source of truth for price/capacity - Listing's own columns become a
  // denormalized "from £X / up to N guests" summary derived from them (see
  // recomputeListingAggregatesFromRoomTypes's own comment for why every
  // other surface needs this rather than becoming room-type-aware itself).
  // Every other property type is unchanged: its own flat fields, required
  // by the schema's superRefine above.
  const listing = await prisma.$transaction(async (tx) => {
    const created = await tx.listing.create({
      data: {
        ...rest,
        ...deal.fields,
        hostId: session.user.id,
        pricePerNightCents: isHotel
          ? Math.min(...roomTypes!.map((r) => r.pricePerNightCents))
          : pricePerNightCents!,
        maxGuests: isHotel ? Math.max(...roomTypes!.map((r) => r.maxGuests)) : maxGuests!,
        bedrooms: isHotel ? Math.max(...roomTypes!.map((r) => r.bedrooms)) : bedrooms!,
        beds: isHotel ? Math.max(...roomTypes!.map((r) => r.beds)) : beds!,
        bathrooms: isHotel ? Math.max(...roomTypes!.map((r) => r.bathrooms)) : bathrooms!,
      },
    });

    if (isHotel) {
      await tx.roomType.createMany({
        data: roomTypes!.map((rt) => ({ ...rt, listingId: created.id })),
      });
    }

    return created;
  });

  // The jitter that keeps two listings in the same town from landing on
  // the exact same pin is keyed on the listing's own id, which Prisma only
  // assigns on insert - so this can't be folded into the create() above.
  const coordinates = geocodeListing({ id: listing.id, city: listing.city });
  const withCoordinates = coordinates
    ? await prisma.listing.update({ where: { id: listing.id }, data: coordinates })
    : listing;

  return NextResponse.json({ listing: withCoordinates }, { status: 201 });
}

export const GET = withApiErrorHandling(getHandler);
export const POST = withApiErrorHandling(postHandler);
