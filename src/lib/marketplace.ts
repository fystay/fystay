import { matchesAmenityCategories } from "@/lib/amenityCategories";

/**
 * The homepage's browse row of stays (Explore the Fylde Coast) and its
 * filters (e.g. Families, Blackpool). Every filter here is derived from
 * real listing data with a minimum-count threshold, so it only appears once
 * the catalog actually supports it, rather than ever padding the page with
 * a near-empty or fabricated option.
 */

export const MIN_LISTINGS_PER_SECTION = 2;
export const MAX_CITY_SECTIONS = 2;
/** The homepage's browse row of stays (Explore the Fylde Coast): how many stays each filter shows, and how many town filters it offers. */
export const POPULAR_STAYS_LIMIT = 12;
export const MAX_POPULAR_TOWN_FILTERS = 6;
const RECENT_WINDOW_DAYS = 30;
/** Bedrooms that make a stay family-sized - the same bar as /search?minBedrooms=2. */
export const FAMILY_MIN_BEDROOMS = 2;
/** "Top rated" needs a high average from more than one or two stays, so a single 5-star review can't earn it. */
export const TOP_RATED_MIN_AVERAGE = 4.5;
export const TOP_RATED_MIN_REVIEWS = 3;

export type MarketplaceListing = {
  id: string;
  city: string;
  amenities: string[];
  createdAt: Date;
};

export type MarketplaceSection<T> = {
  key: string;
  title: string;
  subtitle: string;
  listings: T[];
};

/**
 * A stay the host has marked with a sea view - the same test as the search
 * page's "Sea view" filter (amenityCategories.ts), so the homepage's Sea
 * views and its "See all" results always agree. "Beach access" alone isn't
 * a sea view.
 */
export function isSeaView(amenities: string[]): boolean {
  return matchesAmenityCategories(amenities, ["sea_view"]);
}

/** Groups listings by city, keeping only cities with enough listings to read as a real category. */
export function groupByCity<T extends MarketplaceListing>(
  listings: T[],
  { minPerSection = MIN_LISTINGS_PER_SECTION, maxSections = MAX_CITY_SECTIONS } = {},
): MarketplaceSection<T>[] {
  const byCity = new Map<string, T[]>();
  for (const listing of listings) {
    const existing = byCity.get(listing.city);
    if (existing) {
      existing.push(listing);
    } else {
      byCity.set(listing.city, [listing]);
    }
  }

  return Array.from(byCity.entries())
    .filter(([, cityListings]) => cityListings.length >= minPerSection)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, maxSections)
    .map(([city, cityListings]) => ({
      key: `city-${city}`,
      title: `Popular in ${city}`,
      subtitle: `${cityListings.length} local stay${cityListings.length === 1 ? "" : "s"} to explore`,
      listings: cityListings,
    }));
}

/**
 * Only meaningful once the catalog has grown beyond "everything is recent" —
 * with a small or brand-new set of listings this intentionally returns null
 * rather than duplicating the same listings the main search results already
 * show in the same newest-first order.
 */
export function recentlyAddedSection<T extends MarketplaceListing>(
  listings: T[],
  {
    minPerSection = MIN_LISTINGS_PER_SECTION,
    windowDays = RECENT_WINDOW_DAYS,
    now = new Date(),
  } = {},
): MarketplaceSection<T> | null {
  const cutoff = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000);
  const recent = listings
    .filter((listing) => listing.createdAt >= cutoff)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  if (recent.length < minPerSection || recent.length >= listings.length) return null;

  return {
    key: "recently-added",
    title: "Recently added",
    subtitle: "New stays just listed on the Fylde Coast",
    listings: recent,
  };
}


/**
 * Most popular first, for the homepage's browse row of stays: stays guests
 * have rated come ahead of unrated ones, best average rating first (more
 * reviews breaking a tie, since 4.8 from twenty stays says more than 5.0
 * from one), then the newest. Returns a new array.
 */
export function rankByPopularity<T extends MarketplaceListing & { reviews: { rating: number }[] }>(listings: T[]): T[] {
  const average = (reviews: { rating: number }[]) =>
    reviews.length === 0 ? 0 : reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length;
  return [...listings].sort(
    (a, b) =>
      Number(b.reviews.length > 0) - Number(a.reviews.length > 0) ||
      average(b.reviews) - average(a.reviews) ||
      b.reviews.length - a.reviews.length ||
      b.createdAt.getTime() - a.createdAt.getTime(),
  );
}

export function isFamilySized(listing: { bedrooms: number }): boolean {
  return listing.bedrooms >= FAMILY_MIN_BEDROOMS;
}

/** A host-set weekly or monthly discount - what the card's "x% off weekly/monthly" badge shows. */
export function hasLongStayDiscount(listing: {
  weeklyDiscountPercent: number | null;
  monthlyDiscountPercent: number | null;
}): boolean {
  return (listing.weeklyDiscountPercent ?? 0) > 0 || (listing.monthlyDiscountPercent ?? 0) > 0;
}

export function isTopRated(reviews: { rating: number }[]): boolean {
  if (reviews.length < TOP_RATED_MIN_REVIEWS) return false;
  return reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length >= TOP_RATED_MIN_AVERAGE;
}

/** A town's name as it appears in a URL, e.g. "St Annes" -> "st-annes". */
export function townSlug(city: string): string {
  return city
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export type ExploreListing = MarketplaceListing & {
  bedrooms: number;
  weeklyDiscountPercent: number | null;
  monthlyDiscountPercent: number | null;
  reviews: { rating: number }[];
};

export type ExploreFilter = {
  /** Also the homepage's ?stays= value, so the selection survives going Back. */
  key: string;
  label: string;
  /** "kind" filters (All, Top rated, Families...) come first, then "town" ones. */
  group: "kind" | "town";
  /** The same filter on the full results page, and the link's wording. */
  href: string;
  seeAllLabel: string;
  listingIds: string[];
};

/**
 * The row's filters, from listings already in popularity order (see
 * rankByPopularity): All, then the kind of stay, then the busiest towns.
 * Each kind or town filter appears only once at least
 * MIN_LISTINGS_PER_SECTION stays genuinely match it, and links to /search
 * with the matching filter applied, so "See all" shows the same stays and
 * more.
 */
export function buildExploreFilters<T extends ExploreListing>(ranked: T[]): ExploreFilter[] {
  const top = (subset: T[]) => subset.slice(0, POPULAR_STAYS_LIMIT).map((listing) => listing.id);
  const kind = (
    key: string,
    label: string,
    matches: T[],
    href: string,
    seeAllLabel: string,
  ): ExploreFilter[] =>
    matches.length >= MIN_LISTINGS_PER_SECTION
      ? [{ key, label, group: "kind", href, seeAllLabel, listingIds: top(matches) }]
      : [];

  return [
    { key: "all", label: "All", group: "kind", href: "/search", seeAllLabel: "See all stays", listingIds: top(ranked) },
    ...kind(
      "top-rated",
      "Top rated",
      ranked.filter((listing) => isTopRated(listing.reviews)),
      "/search?topRated=1",
      "See all top-rated stays",
    ),
    ...kind(
      "families",
      "Families",
      ranked.filter(isFamilySized),
      `/search?minBedrooms=${FAMILY_MIN_BEDROOMS}`,
      "See all family stays",
    ),
    ...kind(
      "long-stay",
      "Long-stay discounts",
      ranked.filter(hasLongStayDiscount),
      "/search?longStay=1",
      "See all long-stay discounts",
    ),
    ...kind(
      "sea-views",
      "Sea views",
      ranked.filter((listing) => isSeaView(listing.amenities)),
      "/search?amenities=sea_view",
      "See all sea-view stays",
    ),
    ...groupByCity(ranked, { maxSections: MAX_POPULAR_TOWN_FILTERS }).map((town): ExploreFilter => {
      const city = town.listings[0].city;
      return {
        key: townSlug(city),
        label: city,
        group: "town",
        href: `/search?city=${encodeURIComponent(city)}`,
        seeAllLabel: `See all ${city} stays`,
        listingIds: top(town.listings),
      };
    }),
  ];
}
