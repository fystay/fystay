import Link from "next/link";
import { CalendarDays, Search, SearchX, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { prisma } from "@/lib/prisma";
import { smartPricingMode } from "@/lib/smartPricingMode";
import { SMART_PRICED_FOR_GUESTS_WHERE } from "@/lib/stayQuote";
import { bookableHostWhere } from "@/lib/stripeConnect";
import {
  blockingBookingWhere,
  blockingRanges,
  blocksForRoomType,
  isRangeAvailable,
  isRoomTypeRangeAvailable,
  nightsBetween,
} from "@/lib/availability";
import { isPetFriendly, parseGuestParam, totalOccupants } from "@/lib/search";
import { isKnownTown } from "@/lib/searchTown";
import {
  locationWhere,
  matchesLocation,
  parseBrowseRequest,
  parseSearchRequest,
  searchArea,
  type SearchField,
} from "@/lib/searchRequest";
import { auth } from "@/auth";
import { ListingsCarousel } from "@/components/ListingsCarousel";
import { ListingCard } from "@/components/ListingCard";
import { buildStayQuery } from "@/lib/stayQuery";
import { FilterSheet } from "@/components/FilterSheet";
import { SortDropdown } from "@/components/SortDropdown";
import { ResultsViewToggle } from "@/components/ResultsViewToggle";
import { MapViewPlaceholder } from "@/components/MapViewPlaceholder";
import { ListingsMap } from "@/components/ListingsMap";
import { TOWN_COORDINATES } from "@/lib/geocoding";
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
import { PROPERTY_TYPES } from "@/lib/propertyType";
import { FYLDE_COAST_DESTINATIONS } from "@/lib/destinations";
import { Pagination } from "@/components/Pagination";
import { SpotlightTracker } from "@/components/SpotlightTracker";
import { liveSpotlightWhere } from "@/lib/listingPromotions";

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
// what a single page of hand-picked local stays needs today; raise
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
  // The results page runs only a complete, valid search: a place picked
  // from the suggestions, check-in (not past) and check-out (after it).
  // The homepage carousel is a browse list, not a search, so it skips this.
  const request = showResultsView ? parseSearchRequest(searchParams) : null;
  // No dates yet (from Stays, a hero slide or "View all"): list the stays to
  // browse, nightly prices only, and ask for dates rather than show nothing.
  const browse = request && !request.ok ? parseBrowseRequest(searchParams) : null;
  if (request && !request.ok && !browse) return <SearchPrompt errors={request.errors} />;
  const location = request?.ok ? request.location : (browse?.location ?? null);
  if (location?.kind === "town" && !(await isKnownTown(location.city))) {
    return <SearchPrompt errors={{ where: "Choose a place from the suggestions." }} />;
  }
  const city = location?.kind === "town" ? location.city : "";
  const area = location ? searchArea(location) : null;
  // The point distances on the cards and the nearest-first sort measure from.
  const landmark =
    area && location && location.kind !== "town"
      ? { name: location.kind === "landmark" ? location.name : location.label, ...area.center }
      : undefined;
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
        ...(location ? locationWhere(location) : {}),
      },
      include: {
        bookings: {
          where: blockingBookingWhere(),
          select: { checkIn: true, checkOut: true },
        },
        availabilityBlocks: {
          select: { startDate: true, endDate: true, roomTypeId: true },
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

  const checkIn = request?.ok ? request.checkIn : null;
  const checkOut = request?.ok ? request.checkOut : null;
  const checkInParam = request?.ok ? request.checkInParam : "";
  const nights = checkIn && checkOut ? nightsBetween(checkIn, checkOut) : undefined;
  // Carried onto each card's link so the listing's booking widget opens
  // with the dates and guests already searched for.
  const stayQuery = buildStayQuery(searchParams);

  // A hotel with one fully-booked room type and another still free is still
  // bookable - hiding it because *some* room type overlaps would be wrong,
  // unlike a non-hotel listing where any overlap really does close the
  // whole thing. The room type also has to actually sleep the searched
  // party (maxGuests), not just have a free room - a listing's own
  // aggregate maxGuests filter above only rules out a hotel where *every*
  // room type is too small, not one where the only room type that fits is
  // the one that's sold out.
  const inArea = location ? listings.filter((listing) => matchesLocation(location, listing)) : listings;
  const dateFiltered =
    checkIn && checkOut
      ? inArea.filter((listing) =>
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
      : inArea;

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

  const filters = parseListingFiltersFromParams(searchParams, PROPERTY_TYPES);
  // A landmark search with no explicit sort chosen yet defaults to nearest
  // first, since that's the entire point of searching a specific place
  // rather than a whole town - the SortDropdown mirrors this same default
  // so it never shows "Recommended" while the list is actually ordered by
  // distance.
  const sort =
    landmark && !searchParams.sort ? "distance_asc" : parseSortParam(searchParams.sort);
  const view = parseViewParam(searchParams.view);

  const sorted = sortListings(applyListingFilters(petFiltered, filters), sort, { near: landmark });
  // Paid Spotlight stays that match the search lead the default order,
  // labelled Promoted and counted for their hosts; a sort the guest picks
  // always wins.
  const promotionByListing = new Map(
    sort === "recommended" && sorted.length > 0
      ? (
          await prisma.listingPromotion
            .findMany({
              where: { ...liveSpotlightWhere(new Date()), listingId: { in: sorted.map((l) => l.id) } },
              orderBy: { startsAt: "asc" },
              distinct: ["listingId"],
              select: { id: true, listingId: true },
            })
            .catch(() => [])
        ).map((promotion) => [promotion.listingId, promotion.id] as const)
      : [],
  );
  const results = [
    ...sorted.filter((l) => promotionByListing.has(l.id)),
    ...sorted.filter((l) => !promotionByListing.has(l.id)),
  ];
  const page = parsePageParam(searchParams.page);
  const pageOfListings = paginateListings(results, page, LISTINGS_PAGE_SIZE);
  // Which of these hosts' stays are smart-priced for guests right now, so
  // their cards don't show a date total worked out from the listing's rates.
  const smartPricedIds =
    smartPricingMode() === "on" && pageOfListings.items.length > 0
      ? new Set(
          (
            await prisma.listing.findMany({
              where: { id: { in: pageOfListings.items.map((l) => l.id) }, ...SMART_PRICED_FOR_GUESTS_WHERE },
              select: { id: true },
            })
          ).map((l) => l.id),
        )
      : new Set<string>();
  const paginated = {
    ...pageOfListings,
    items: pageOfListings.items.map((listing) => ({ ...listing, smartPriced: smartPricedIds.has(listing.id) })),
  };

  const cityCounts = new Map<string, number>();
  for (const listing of results) {
    cityCounts.set(listing.city, (cityCounts.get(listing.city) ?? 0) + 1);
  }

  return (
    <div
      className={cn("flex flex-col gap-5", showResultsView && "animate-search-reveal-in")}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle pb-4">
        <div className="flex flex-wrap items-center gap-3">
          {/* The heading above already names the place. */}
          <p className="text-sm font-medium text-stone-500">
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
            <FilterSheet />
            <SortDropdown />
          </div>
        </div>
        <ResultsViewToggle />
      </div>

      {browse && results.length > 0 && (
        <p className="flex items-center gap-2.5 rounded-xl bg-brand-50 px-4 py-3 text-sm text-brand-800">
          <CalendarDays className="h-4 w-4 shrink-0" aria-hidden />
          Add your dates above to see which stays are free and your total price.
        </p>
      )}

      {results.length === 0 ? (
        <NoResults
          city={city}
          guestsNeeded={guestsNeeded}
          datesFiltered={inArea.length > 0 && dateFiltered.length === 0}
          searchParams={searchParams}
        />
      ) : view === "map" ? (
        (() => {
          // Only stays with a map location get a pin (see locateListing);
          // when none of the results has one, the honest placeholder - not
          // a broken-looking empty map - says so.
          const mappable = results.filter(
            (l): l is typeof l & { latitude: number; longitude: number } =>
              l.latitude !== null && l.longitude !== null,
          );
          // Opens on the place searched for: a picked place's point and
          // extent, a landmark, or the town's centre when FYStay knows it.
          const focus =
            location && location.kind !== "town"
              ? {
                  latitude: location.latitude,
                  longitude: location.longitude,
                  bounds: location.kind === "place" ? location.bounds : null,
                }
              : location?.kind === "town"
                ? (TOWN_COORDINATES[location.city.trim().toLowerCase()] ?? null)
                : null;
          return mappable.length > 0 ? (
            <ListingsMap
              focus={focus}
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
            {paginated.items.map((listing) => {
              const promotionId = promotionByListing.get(listing.id);
              const card = (
                <ListingCard
                  key={listing.id}
                  listing={listing}
                  isSaved={savedListingIds.has(listing.id)}
                  isLoggedIn={Boolean(session?.user)}
                  nights={nights}
                  checkIn={checkInParam || undefined}
                  nearLandmark={landmark}
                  stayQuery={stayQuery}
                  promoted={Boolean(promotionId)}
                />
              );
              return promotionId ? (
                <SpotlightTracker key={listing.id} promotionId={promotionId}>
                  {card}
                </SpotlightTracker>
              ) : (
                card
              );
            })}
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
  // A town FYStay covers: one with its own destination page, or anywhere
  // a live listing already is (Carnforth, say) - so a fully booked town is
  // never told "FYStay doesn't cover it".
  const knownTown =
    !city ||
    FYLDE_COAST_DESTINATIONS.some(
      (town) =>
        town.searchCity.toLowerCase().includes(city.toLowerCase()) ||
        city.toLowerCase().includes(town.searchCity.toLowerCase()),
    ) ||
    (await prisma.listing
      .count({ where: { published: true, suspendedAt: null, ...bookableHostWhere(), city: { contains: city, mode: "insensitive" } } })
      .catch(() => 0)) > 0;
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
        FYStay started on the Fylde Coast and adds towns as local hosts join. Try{" "}
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

const FIELD_LABEL: Record<SearchField, string> = { where: "Where", checkIn: "Check-in", checkOut: "Check-out" };

/** What the results page shows instead of results when the search isn't complete or valid. */
function SearchPrompt({ errors }: { errors: Partial<Record<SearchField, string>> }) {
  return (
    <div className="mt-8 flex flex-col items-center gap-3 text-center" role="alert">
      <Search className="h-8 w-8 text-stone-300" aria-hidden />
      <p className="font-medium text-foreground">Finish your search to see stays</p>
      <ul className="flex max-w-sm flex-col gap-1 text-sm text-stone-600" data-testid="search-validation">
        {(Object.keys(FIELD_LABEL) as SearchField[])
          .filter((field) => errors[field])
          .map((field) => (
            <li key={field}>
              <span className="font-medium text-foreground">{FIELD_LABEL[field]}:</span> {errors[field]}
            </li>
          ))}
      </ul>
    </div>
  );
}
