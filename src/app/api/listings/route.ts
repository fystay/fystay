import { NextResponse } from "next/server";
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
import { geocodeListing } from "@/lib/geocoding";
import { paginateListings, parsePageParam } from "@/lib/listingSearch";
import { PRIVATE_LISTING_FIELDS } from "@/lib/listingPrivacy";
import { locationWhere, matchesLocation, parseSearchRequest } from "@/lib/searchRequest";
import { isKnownTown } from "@/lib/searchTown";
import { withApiErrorHandling } from "@/lib/apiError";
import { publicationBlockers } from "@/lib/listingReview";
import { payoutReadinessRequired } from "@/lib/stripeConnect";
import { resolveLastMinuteDeal } from "@/lib/dealValidation";
import { createListingSchema } from "@/lib/listingInput";
import { weekendRateError } from "@/lib/pricing";

const LISTINGS_API_PAGE_SIZE = 24;

const WHOLE_NUMBER = /^\d{1,7}$/;
const INCOMPLETE = "Choose where, check-in and check-out to search.";

async function getHandler(request: Request) {
  const { searchParams } = new URL(request.url);
  // The same rules as the /search page: where (picked from the
  // suggestions), check-in and check-out are all required and validated.
  const search = parseSearchRequest(searchParams);
  if (!search.ok) {
    return NextResponse.json({ error: INCOMPLETE, fields: search.errors }, { status: 400 });
  }
  const { location, checkIn, checkOut } = search;
  if (location.kind === "town" && !(await isKnownTown(location.city))) {
    return NextResponse.json({ error: INCOMPLETE, fields: { where: "Choose a place from the suggestions." } }, { status: 400 });
  }
  const optional = (key: string) => {
    const value = searchParams.get(key);
    if (value === null || value === "") return undefined;
    return WHOLE_NUMBER.test(value) ? Number(value) : NaN;
  };
  const guests = optional("guests");
  const minPrice = optional("minPrice");
  const maxPrice = optional("maxPrice");
  if ([guests, minPrice, maxPrice].some((n) => Number.isNaN(n)) || guests === 0) {
    return NextResponse.json({ error: "guests, minPrice and maxPrice must be whole numbers (guests at least 1)." }, { status: 400 });
  }
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
      ...locationWhere(location),
      ...(guests !== undefined ? { maxGuests: { gte: guests } } : {}),
      ...(minPrice !== undefined || maxPrice !== undefined
        ? { pricePerNightCents: { ...(minPrice !== undefined && { gte: minPrice }), ...(maxPrice !== undefined && { lte: maxPrice }) } }
        : {}),
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

  const guestsNeeded = guests ?? 0;

  // A hotel with one fully-booked room type and another still free is still
  // bookable - see ListingsGrid.tsx's own copy of this same logic for the
  // guest-facing search page (a separate query, kept in sync by hand). The
  // room type also has to actually sleep the requested party (maxGuests),
  // not just have a free room - see that same file's comment for why.
  const filtered = listings
    .filter((listing) => matchesLocation(location, listing))
    .filter((listing) =>
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
    );

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
  const weekendError = weekendRateError({
    pricePerNightCents: parsed.data.pricePerNightCents ?? 0,
    weekendPricePerNightCents: parsed.data.weekendPricePerNightCents ?? null,
    propertyType: parsed.data.propertyType,
  });
  if (weekendError) {
    return NextResponse.json({ error: weekendError }, { status: 400 });
  }

  const { roomTypes, pricePerNightCents, maxGuests, bedrooms, beds, bathrooms, ...rest } =
    parsed.data;
  const isHotel = rest.propertyType === "HOTEL";

  // A new listing goes live straight away only if it passes the same
  // publication checks as every other listing (src/lib/listingReview.ts);
  // otherwise it's saved hidden and the host is told what's left.
  const host = await prisma.user.findUniqueOrThrow({
    where: { id: session.user.id },
    select: {
      name: true,
      emailVerifiedAt: true,
      suspendedAt: true,
      deletedAt: true,
      stripeConnectChargesEnabled: true,
      stripeConnectPayoutsEnabled: true,
    },
  });
  const blockers = publicationBlockers({
    listing: {
      title: rest.title,
      description: rest.description,
      city: rest.city,
      photos: rest.photos,
      pricePerNightCents: isHotel ? 1 : (pricePerNightCents ?? 0),
      propertyType: rest.propertyType ?? "OTHER",
      suspendedAt: null,
      suspendedReason: null,
      preparedById: null,
      reviewStatus: null,
      hostInvitationId: null,
    },
    host,
    payoutsRequired: payoutReadinessRequired(),
  });

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
        published: blockers.length === 0,
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

  return NextResponse.json(
    {
      listing: withCoordinates,
      ...(blockers.length > 0 && {
        notice: `Saved, but hidden from guests for now. ${blockers.map((b) => b.message).join(" ")} Then switch it to Live.`,
      }),
    },
    { status: 201 },
  );
}

export const GET = withApiErrorHandling(getHandler);
export const POST = withApiErrorHandling(postHandler);
