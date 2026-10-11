import { averageRating } from "@/lib/reviews";
import { matchesAmenityCategories } from "@/lib/amenityCategories";
import { distanceMiles } from "@/lib/geo";
import { hasLongStayDiscount, isTopRated } from "@/lib/marketplace";
import type { PropertyType } from "@/lib/propertyType";

export type SearchableListing = {
  id: string;
  pricePerNightCents: number;
  propertyType: PropertyType;
  bedrooms: number;
  bathrooms: number;
  amenities: string[];
  reviews: { rating: number }[];
  weeklyDiscountPercent?: number | null;
  monthlyDiscountPercent?: number | null;
  latitude?: number | null;
  longitude?: number | null;
};

export type ListingFilters = {
  propertyTypes?: PropertyType[];
  minPriceCents?: number;
  maxPriceCents?: number;
  minBedrooms?: number;
  minBathrooms?: number;
  amenityCategories?: string[];
  minRating?: number;
  /** Only stays with a weekly or monthly discount (?longStay=1). */
  longStayDiscount?: boolean;
  /** Only stays rated 4.5+ from 3+ reviews (?topRated=1) - the homepage's Top rated. */
  topRated?: boolean;
};

/**
 * The single place every "does this listing match the filters" decision is
 * made. Each criterion is independent (AND'd together) and a filter that
 * isn't set never excludes anything, so passing an empty ListingFilters is
 * always a no-op - callers don't need to special-case "no filters active".
 */
export function applyListingFilters<T extends SearchableListing>(
  listings: T[],
  filters: ListingFilters,
): T[] {
  return listings.filter((listing) => {
    if (filters.propertyTypes?.length && !filters.propertyTypes.includes(listing.propertyType)) {
      return false;
    }
    if (filters.minPriceCents !== undefined && listing.pricePerNightCents < filters.minPriceCents) {
      return false;
    }
    if (filters.maxPriceCents !== undefined && listing.pricePerNightCents > filters.maxPriceCents) {
      return false;
    }
    if (filters.minBedrooms !== undefined && listing.bedrooms < filters.minBedrooms) {
      return false;
    }
    if (filters.minBathrooms !== undefined && listing.bathrooms < filters.minBathrooms) {
      return false;
    }
    if (
      filters.amenityCategories?.length &&
      !matchesAmenityCategories(listing.amenities, filters.amenityCategories)
    ) {
      return false;
    }
    if (filters.minRating !== undefined) {
      const rating = averageRating(listing.reviews);
      // No reviews at all can't be claimed to meet a rating bar.
      if (rating === null || rating < filters.minRating) return false;
    }
    if (
      filters.longStayDiscount &&
      !hasLongStayDiscount({
        weeklyDiscountPercent: listing.weeklyDiscountPercent ?? null,
        monthlyDiscountPercent: listing.monthlyDiscountPercent ?? null,
      })
    ) {
      return false;
    }
    if (filters.topRated && !isTopRated(listing.reviews)) return false;
    return true;
  });
}

export type SortKey =
  | "recommended"
  | "price_asc"
  | "price_desc"
  | "rating_desc"
  | "reviews_desc"
  | "distance_asc";

export const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "recommended", label: "Recommended" },
  { key: "price_asc", label: "Price: low to high" },
  { key: "price_desc", label: "Price: high to low" },
  { key: "rating_desc", label: "Highest rated" },
  { key: "reviews_desc", label: "Most reviewed" },
  { key: "distance_asc", label: "Distance: nearest first" },
];

/**
 * "Recommended" trusts the order listings already arrive in (newest first,
 * from the database query) rather than reshuffling - every other option
 * does a stable sort over that same order, so ties keep breaking the same
 * predictable way.
 *
 * `near`, when given, is the point "distance_asc" measures from - a named
 * place a guest searched for (see landmarks.ts), not just the town it's
 * in. Without a `near` point, "distance_asc" has nothing to measure from
 * and is a deliberate no-op rather than a crash: a stale/typed-in
 * ?sort=distance_asc with no ?near= should just fall back to the existing
 * order, not error.
 */
export function sortListings<T extends SearchableListing>(
  listings: T[],
  sort: SortKey,
  { near }: { near?: { latitude: number; longitude: number } } = {},
): T[] {
  if (sort === "recommended") return listings;
  if (sort === "distance_asc" && !near) return listings;

  const withMeta = listings.map((listing) => ({
    listing,
    rating: averageRating(listing.reviews),
    reviewCount: listing.reviews.length,
  }));

  switch (sort) {
    case "price_asc":
      withMeta.sort((a, b) => a.listing.pricePerNightCents - b.listing.pricePerNightCents);
      break;
    case "price_desc":
      withMeta.sort((a, b) => b.listing.pricePerNightCents - a.listing.pricePerNightCents);
      break;
    case "rating_desc":
      // Unrated listings sink to the bottom rather than being treated as 0.
      withMeta.sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1));
      break;
    case "reviews_desc":
      withMeta.sort((a, b) => b.reviewCount - a.reviewCount);
      break;
    case "distance_asc": {
      // A listing with no coordinates yet can't be placed relative to
      // `near`, so it sinks to the bottom rather than being treated as 0
      // miles away - the same "unknown isn't zero" rule rating_desc uses.
      const distanceOf = (listing: T) =>
        listing.latitude != null && listing.longitude != null
          ? distanceMiles(near!, { latitude: listing.latitude, longitude: listing.longitude })
          : Infinity;
      withMeta.sort((a, b) => distanceOf(a.listing) - distanceOf(b.listing));
      break;
    }
  }

  return withMeta.map((entry) => entry.listing);
}

function parseCsvParam(value: string | string[] | undefined): string[] {
  const raw = typeof value === "string" ? value : "";
  return raw
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

/** Parses the whole filter set from URL search params in one place, so the page and any test can agree on the exact param names. */
export function parseListingFiltersFromParams(
  searchParams: Record<string, string | string[] | undefined>,
  knownPropertyTypes: readonly string[],
): ListingFilters {
  const propertyTypes = parseCsvParam(searchParams.propertyType).filter((t) =>
    knownPropertyTypes.includes(t),
  ) as PropertyType[];
  const amenityCategories = parseCsvParam(searchParams.amenities);

  const minPrice = typeof searchParams.minPrice === "string" ? Number(searchParams.minPrice) : NaN;
  const maxPrice = typeof searchParams.maxPrice === "string" ? Number(searchParams.maxPrice) : NaN;
  const minBedroomsRaw =
    typeof searchParams.minBedrooms === "string" ? Number(searchParams.minBedrooms) : NaN;
  const minBathroomsRaw =
    typeof searchParams.minBathrooms === "string" ? Number(searchParams.minBathrooms) : NaN;
  const minRatingRaw =
    typeof searchParams.minRating === "string" ? Number(searchParams.minRating) : NaN;

  return {
    propertyTypes: propertyTypes.length > 0 ? propertyTypes : undefined,
    minPriceCents: Number.isFinite(minPrice) && minPrice > 0 ? Math.round(minPrice * 100) : undefined,
    maxPriceCents: Number.isFinite(maxPrice) && maxPrice > 0 ? Math.round(maxPrice * 100) : undefined,
    minBedrooms: Number.isInteger(minBedroomsRaw) && minBedroomsRaw > 0 ? minBedroomsRaw : undefined,
    minBathrooms: Number.isInteger(minBathroomsRaw) && minBathroomsRaw > 0 ? minBathroomsRaw : undefined,
    amenityCategories: amenityCategories.length > 0 ? amenityCategories : undefined,
    minRating: Number.isFinite(minRatingRaw) && minRatingRaw > 0 ? minRatingRaw : undefined,
    longStayDiscount: searchParams.longStay === "1" || undefined,
    topRated: searchParams.topRated === "1" || undefined,
  };
}

export function parseSortParam(value: string | string[] | undefined): SortKey {
  const key = typeof value === "string" ? value : "";
  return SORT_OPTIONS.some((option) => option.key === key) ? (key as SortKey) : "recommended";
}

export function parseViewParam(value: string | string[] | undefined): "list" | "map" {
  return value === "map" ? "map" : "list";
}

/** How many results one page of the /search results grid shows. */
export const LISTINGS_PAGE_SIZE = 24;

// Pagination itself isn't listing-specific (see src/lib/pagination.ts,
// which a guest's trips list and a host's own listings also use) -
// re-exported under their original names here so this module's existing
// callers (ListingsGrid.tsx, api/listings/route.ts) don't need to change
// their imports.
export { paginate as paginateListings, parsePageParam, type PaginatedResult as PaginatedListings } from "@/lib/pagination";
