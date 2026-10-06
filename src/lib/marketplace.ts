/**
 * Browse-by-category sections shown below the main search results on the
 * homepage (e.g. "Popular in Blackpool", "Beach stays"). Every section here
 * is derived from real listing data with a minimum-count threshold, so a
 * category only appears once the catalog actually supports it, rather than
 * ever padding the page with a near-empty or fabricated row.
 */

export const MIN_LISTINGS_PER_SECTION = 2;
export const MAX_CITY_SECTIONS = 2;
/** The homepage's browse row of stays (Explore the Fylde Coast): how many stays each filter shows, and how many town filters it offers. */
export const POPULAR_STAYS_LIMIT = 12;
export const MAX_POPULAR_TOWN_FILTERS = 6;
const RECENT_WINDOW_DAYS = 30;

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

/** A freeform-amenities heuristic, matching the same pattern as isPetFriendly. */
export function isBeachStay(amenities: string[]): boolean {
  return amenities.some((amenity) => /sea|ocean|beach/i.test(amenity));
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

export function beachStaysSection<T extends MarketplaceListing>(
  listings: T[],
  minPerSection = MIN_LISTINGS_PER_SECTION,
): MarketplaceSection<T> | null {
  const beachListings = listings.filter((listing) => isBeachStay(listing.amenities));
  if (beachListings.length < minPerSection) return null;
  return {
    key: "beach-stays",
    title: "Beach stays",
    subtitle: "Places with sea views, right on the coast",
    listings: beachListings,
  };
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
