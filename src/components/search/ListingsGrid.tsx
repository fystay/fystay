import Link from "next/link";
import { SearchX, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { prisma } from "@/lib/prisma";
import { bookableHostWhere } from "@/lib/stripeConnect";
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
import { FYLDE_COAST_DESTINATIONS } from "@/lib/destinations";
import { todayStayDate } from "@/lib/stayDates";
import { Pagination } from "@/components/Pagination";

// The homepage's Explore filters that the filter panel doesn't cover, shown
// as chips beside the result count so a guest arriving from "See all
// long-stay discounts" can see why the list is narrowed - and undo it.
const PAGE_ONLY_FILTERS = [
  { param: "longStay", label: "Long-stay discounts" },
  { param: "topRated", label: "Top rated" },
];

/** The current results URL without one filter, and back to its first page. */
function withoutParam(searchParams: SearchParams, param: string): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (key === param || key === "page" || typeof value !== "string") continue;
    params.set(key, value);
  }
  const query = params.toString();
  return query ? `/search?${query}` : "/search";
}

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
        ...bookableHostWhere(),
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
  const datesReadable =
    !!parsedCheckIn &&
    !!parsedCheckOut &&
    !Number.isNaN(parsedCheckIn.getTime()) &&
    !Number.isNaN(parsedCheckOut.getTime());
  const datesInPast = datesReadable && parsedCheckIn! < todayStayDate();
  const datesUsable = datesReadable && parsedCheckOut! > parsedCheckIn! && !datesInPast;
  // Say exactly what's wrong with the dates and what to do, rather than
  // silently pricing (or filtering by) dates nobody can book.
  const dateProblem: string | null =
    !(checkInParam || checkOutParam) || datesUsable
      ? null
      : checkInParam && !checkOutParam
        ? "Add a check-out date to see prices for your stay. Showing all stays for now."
        : !checkInParam && checkOutParam
          ? "Add a check-in date to see prices for your stay. Showing all stays for now."
          : !datesReadable
            ? "We couldn't read those dates - please pick them again. Showing all stays for now."
            : datesInPast
              ? "Those dates have passed - pick new ones to see prices. Showing all stays for now."
              : "Check your dates - check-out needs to be after check-in. Showing all stays for now.";
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
        // bigger gap under the "Places to stay" heading right above it
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
      {dateProblem && (
        <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {dateProblem}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle pb-4">
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm font-medium text-stone-500">
            {city && <span className="text-foreground">{city} · </span>}
            {results.length} stay{results.length === 1 ? "" : "s"}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {PAGE_ONLY_FILTERS.filter(({ param }) => searchParams[param] === "1").map(({ param, label }) => (
              <Link
                key={param}
                href={withoutParam(searchParams, param)}
                aria-label={`Remove filter: ${label}`}
                className="focus-ring inline-flex h-9 items-center gap-1.5 rounded-full border border-brand-700 bg-brand-50 pl-3.5 pr-2.5 text-sm font-medium text-brand-800 transition-colors hover:bg-brand-100"
              >
                {label}
                <X className="h-3.5 w-3.5" aria-hidden />
              </Link>
            ))}
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
        <NoResults
          city={city}
          guestsNeeded={guestsNeeded}
          datesFiltered={Boolean(checkIn && checkOut) && listings.length > 0 && dateFiltered.length === 0}
          searchParams={searchParams}
        />
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
                checkIn={checkInParam || undefined}
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

/**
 * Why a search came back empty, and the one most useful thing to try - in
 * order: a place FYStay doesn't cover, more guests than any stay sleeps,
 * nothing free on those dates, or (otherwise) the filters.
 */
async function NoResults({
  city,
  guestsNeeded,
  datesFiltered,
  searchParams,
}: {
  city: string;
  guestsNeeded: number;
  datesFiltered: boolean;
  searchParams: SearchParams;
}) {
  const knownTown = !city || FYLDE_COAST_DESTINATIONS.some(
    (town) =>
      town.searchCity.toLowerCase().includes(city.toLowerCase()) ||
      city.toLowerCase().includes(town.searchCity.toLowerCase()),
  );
  const largest = knownTown
    ? (await prisma.listing.aggregate({ where: { published: true, suspendedAt: null, ...bookableHostWhere() }, _max: { maxGuests: true } }))
        ._max.maxGuests
    : null;

  let title = "No stays match your search";
  let hint: React.ReactNode = "Try removing a filter or widening your price range.";
  if (!knownTown) {
    title = `FYStay doesn't cover ${city} yet`;
    hint = (
      <>
        We&apos;re local to the Fylde Coast. Try{" "}
        {FYLDE_COAST_DESTINATIONS.map((town, i) => (
          <span key={town.slug}>
            {i > 0 && (i === FYLDE_COAST_DESTINATIONS.length - 1 ? " or " : ", ")}
            <Link href={`/search?city=${encodeURIComponent(town.searchCity)}`} className="font-medium text-brand-700 underline underline-offset-2">
              {town.name}
            </Link>
          </span>
        ))}
        .
      </>
    );
  } else if (largest !== null && guestsNeeded > largest) {
    title = `No stays sleep ${guestsNeeded} guests`;
    hint = `The largest stay on FYStay sleeps ${largest}. You could book two stays nearby instead.`;
  } else if (datesFiltered) {
    title = city ? `Nothing in ${city} is free on those dates` : "Nothing is free on those dates";
    hint = "Try moving your dates by a few days, or search nearby towns.";
  }

  const filterKeys = ["propertyType", "amenities", "minPrice", "maxPrice", "minBedrooms", "minBathrooms", "minRating", "longStay", "topRated", "page"];
  const hasFilters = Object.keys(searchParams).some((key) => filterKeys.includes(key) && key !== "page");
  // Clearing filters keeps where, when and who.
  const kept = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (!filterKeys.includes(key) && typeof value === "string") kept.set(key, value);
  }
  const clearedHref = kept.size > 0 ? `/search?${kept}` : "/search";

  return (
    <div className="mt-8 flex flex-col items-center gap-3 text-center">
      <SearchX className="h-8 w-8 text-stone-300" />
      <p className="font-medium text-foreground">{title}</p>
      <p className="max-w-md text-sm text-stone-500">{hint}</p>
      {hasFilters && knownTown && (
        <Link href={clearedHref} className="mt-1 text-sm font-medium text-brand-700 underline underline-offset-2">
          Clear all filters
        </Link>
      )}
    </div>
  );
}
