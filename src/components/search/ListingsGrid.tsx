import { SearchX } from "lucide-react";
import { cn } from "@/lib/cn";
import { prisma } from "@/lib/prisma";
import {
  blockingBookingWhere,
  blockingRanges,
  isRangeAvailable,
  isRoomTypeRangeAvailable,
  nightsBetween,
} from "@/lib/availability";
import { isPetFriendly, parseGuestParam, totalOccupants } from "@/lib/search";
import { findLandmarkByName } from "@/lib/landmarks";
import { auth } from "@/auth";
import { ListingsCarousel } from "@/components/ListingsCarousel";
import { ListingCard } from "@/components/ListingCard";
import { buildStayQuery } from "@/lib/stayQuery";
import { FilterSheet } from "@/components/FilterSheet";
import { SortDropdown } from "@/components/SortDropdown";
import { ResultsViewToggle } from "@/components/ResultsViewToggle";
import { MapViewPlaceholder } from "@/components/MapViewPlaceholder";
import { ListingsMap } from "@/components/ListingsMap";
import {
  applyListingFilters,
  LISTINGS_PAGE_SIZE,
  paginateListings,
  parseListingFiltersFromParams,
  parsePageParam,
  parseSortParam,
  parseViewParam,
  sortListings,
} from "@/lib/listingSearch";
import { availableAmenityCategories } from "@/lib/amenityCategories";
import { PROPERTY_TYPES } from "@/lib/propertyType";
import { Pagination } from "@/components/Pagination";

// Every candidate that could plausibly match a search, fetched once and
// then filtered/sorted in memory (see the rest of this file) - Postgres
// itself can't apply the date-availability, pet, and room-type checks
// below, so there's no way to push pagination down to the query without
// losing correctness. This cap is the safety net against that unbounded
// fetch growing without limit as the number of listings scales well past
// what a single page of hand-picked Fylde Coast stays needs today; raise
// it (or replace this whole approach with a real search index) long
// before the platform's real listing count gets anywhere near it.
const MAX_CANDIDATE_LISTINGS = 500;
// The homepage's "Popular stays" carousel isn't paginated - it's a taster,
// not the results page - so it just shows the first handful.
const HOMEPAGE_CAROUSEL_SIZE = 12;

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * Shared between the homepage's "Popular stays" browse carousel
 * (showResultsView: false) and the dedicated /search results page
 * (showResultsView: true), so both stay backed by the same real query
 * instead of two parallel implementations drifting apart.
 */
export async function ListingsGrid({
  searchParams,
  showResultsView,
}: {
  searchParams: SearchParams;
  showResultsView: boolean;
}) {
  const city = typeof searchParams.city === "string" ? searchParams.city : "";
  // A specific named place within that city (e.g. "Blackpool Pleasure
  // Beach"), selected from the destination autocomplete's landmark
  // suggestions - undefined for any value that isn't one of the app's own
  // curated places, so an arbitrary/stale ?near= in the URL never trusts
  // unverified coordinates.
  const nearParam = typeof searchParams.near === "string" ? searchParams.near : "";
  const landmark = nearParam ? findLandmarkByName(nearParam) : undefined;
  const checkInParam = typeof searchParams.checkIn === "string" ? searchParams.checkIn : "";
  const checkOutParam = typeof searchParams.checkOut === "string" ? searchParams.checkOut : "";
  const adults = parseGuestParam(searchParams.adults, 1);
  const children = parseGuestParam(searchParams.children, 0);
  const pets = parseGuestParam(searchParams.pets, 0);
  const guestsNeeded = totalOccupants({ adults, children });

  const [session, listings] = await Promise.all([
    auth(),
    prisma.listing.findMany({
      where: {
        published: true,
        // See src/app/api/listings/route.ts's own copy of this same guard -
        // a suspended listing is excluded from search exactly like an
        // unpublished one.
        suspendedAt: null,
        maxGuests: { gte: guestsNeeded },
        ...(city
          ? {
              OR: [
                { city: { contains: city, mode: "insensitive" } },
                { country: { contains: city, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      include: {
        bookings: {
          where: blockingBookingWhere(),
          select: { checkIn: true, checkOut: true },
        },
        availabilityBlocks: {
          select: { startDate: true, endDate: true },
        },
        reviews: { where: { status: "PUBLISHED" }, select: { rating: true } },
        // Only meaningful for a HOTEL listing (see the dateFiltered check
        // below) - empty for every other property type.
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
      take: MAX_CANDIDATE_LISTINGS,
    }),
  ]);

  const savedListingIds = session?.user
    ? new Set(
        (
          await prisma.savedListing.findMany({
            where: { userId: session.user.id },
            select: { listingId: true },
          })
        ).map((s) => s.listingId),
      )
    : new Set<string>();

  // A hand-edited or stale URL can carry dates that aren't a usable range
  // (unparseable, or check-out not after check-in) - those are ignored,
  // with a note saying so, rather than filtering results by a broken range.
  const parsedCheckIn = checkInParam ? new Date(checkInParam) : null;
  const parsedCheckOut = checkOutParam ? new Date(checkOutParam) : null;
  const datesUsable =
    !!parsedCheckIn &&
    !!parsedCheckOut &&
    !Number.isNaN(parsedCheckIn.getTime()) &&
    !Number.isNaN(parsedCheckOut.getTime()) &&
    parsedCheckOut > parsedCheckIn;
  const invalidDates = Boolean(checkInParam || checkOutParam) && !datesUsable;
  const checkIn = datesUsable ? parsedCheckIn : null;
  const checkOut = datesUsable ? parsedCheckOut : null;
  const nights = checkIn && checkOut ? nightsBetween(checkIn, checkOut) : undefined;
  // Carried onto each card's link so the listing's booking widget opens
  // with the dates and guests already searched for.
  const stayQuery = buildStayQuery(
    datesUsable ? searchParams : { ...searchParams, checkIn: undefined, checkOut: undefined },
  );

  // A hotel with one fully-booked room type and another still free is still
  // bookable - hiding it because *some* room type overlaps would be wrong,
  // unlike a non-hotel listing where any overlap really does close the
  // whole thing. The room type also has to actually sleep the searched
  // party (maxGuests), not just have a free room - a listing's own
  // aggregate maxGuests filter above only rules out a hotel where *every*
  // room type is too small, not one where the only room type that fits is
  // the one that's sold out.
  const dateFiltered =
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
                    roomType.availabilityBlocks,
                  ),
              )
            : isRangeAvailable(
                checkIn,
                checkOut,
                blockingRanges(listing.bookings, listing.availabilityBlocks),
              ),
        )
      : listings;

  const petFiltered = pets > 0
    ? dateFiltered.filter((listing) => isPetFriendly(listing.amenities))
    : dateFiltered;

  if (!showResultsView) {
    if (petFiltered.length === 0) {
      return (
        // mt-8, matching the /search page's own zero-results state just
        // below (same component, showResultsView: true branch) - this one
        // used to be mt-16 for no evident reason, which read as a much
        // bigger gap under the "Hand-picked stays" heading right above it
        // than the identical empty state gets anywhere else in the app.
        <div className="mt-8 flex flex-col items-center gap-3 text-center">
          <SearchX className="h-8 w-8 text-stone-300" />
          <p className="font-medium text-foreground">No stays match your search</p>
          <p className="max-w-sm text-sm text-stone-500">
            Try different dates, a different destination, or fewer guests.
          </p>
        </div>
      );
    }

    return (
      <ListingsCarousel
        listings={petFiltered.slice(0, HOMEPAGE_CAROUSEL_SIZE)}
        savedListingIds={savedListingIds}
        isLoggedIn={Boolean(session?.user)}
        size="large"
      />
    );
  }

  const availablePropertyTypes = PROPERTY_TYPES.filter((type) =>
    petFiltered.some((listing) => listing.propertyType === type),
  );
  const amenityCategories = availableAmenityCategories(petFiltered).map(({ key, label }) => ({
    key,
    label,
  }));

  const filters = parseListingFiltersFromParams(searchParams, PROPERTY_TYPES);
  // A landmark search with no explicit sort chosen yet defaults to nearest
  // first, since that's the entire point of searching a specific place
  // rather than a whole town - the SortDropdown mirrors this same default
  // so it never shows "Recommended" while the list is actually ordered by
  // distance.
  const sort =
    landmark && !searchParams.sort ? "distance_asc" : parseSortParam(searchParams.sort);
  const view = parseViewParam(searchParams.view);

  const results = sortListings(applyListingFilters(petFiltered, filters), sort, { near: landmark });
  const page = parsePageParam(searchParams.page);
  const paginated = paginateListings(results, page, LISTINGS_PAGE_SIZE);

  const cityCounts = new Map<string, number>();
  for (const listing of results) {
    cityCounts.set(listing.city, (cityCounts.get(listing.city) ?? 0) + 1);
  }

  return (
    <div
      className={cn("flex flex-col gap-5", showResultsView && "animate-search-reveal-in")}
    >
      {invalidDates && (
        <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Check your dates - check-out needs to be after check-in. Showing all stays for now.
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle pb-4">
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm font-medium text-stone-500">
            {results.length} stay{results.length === 1 ? "" : "s"}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <FilterSheet
              availablePropertyTypes={availablePropertyTypes}
              availableAmenityCategories={amenityCategories}
            />
            <SortDropdown />
          </div>
        </div>
        <ResultsViewToggle />
      </div>

      {results.length === 0 ? (
        <div className="mt-8 flex flex-col items-center gap-3 text-center">
          <SearchX className="h-8 w-8 text-stone-300" />
          <p className="font-medium text-foreground">No stays match your search</p>
          <p className="max-w-sm text-sm text-stone-500">
            Try different dates, a wider price range, or fewer filters.
          </p>
        </div>
      ) : view === "map" ? (
        (() => {
          // Every current town geocodes (see src/lib/geocoding.ts), so this
          // is only ever empty for a result set entirely outside FYStay's
          // actual coverage - the honest placeholder, not a broken-looking
          // empty map, is the right fallback for that.
          const mappable = results.filter(
            (l): l is typeof l & { latitude: number; longitude: number } =>
              l.latitude !== null && l.longitude !== null,
          );
          return mappable.length > 0 ? (
            <ListingsMap
              listings={mappable.map((l) => ({
                id: l.id,
                title: l.title,
                city: l.city,
                photo: l.photos[0] ?? null,
                pricePerNightCents: l.pricePerNightCents,
                latitude: l.latitude,
                longitude: l.longitude,
              }))}
            />
          ) : (
            <MapViewPlaceholder cityCounts={cityCounts} />
          );
        })()
      ) : (
        // Single column below sm: two half-width cards on a phone left
        // titles clipped and photos too small to judge a place by. One
        // full-width card per row is the same shape guests already get in
        // the homepage carousel. Tablet/desktop breakpoints (sm/lg) are
        // unchanged from before.
        <>
          <div className="grid grid-cols-1 gap-y-8 sm:grid-cols-3 sm:gap-x-6 sm:gap-y-10 lg:grid-cols-4">
            {paginated.items.map((listing) => (
              <ListingCard
                key={listing.id}
                listing={listing}
                isSaved={savedListingIds.has(listing.id)}
                isLoggedIn={Boolean(session?.user)}
                nights={nights}
                nearLandmark={landmark}
                stayQuery={stayQuery}
              />
            ))}
          </div>
          <Pagination page={paginated.page} totalPages={paginated.totalPages} />
        </>
      )}
    </div>
  );
}
