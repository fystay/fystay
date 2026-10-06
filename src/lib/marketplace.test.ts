import { describe, expect, it } from "vitest";
import {
  buildExploreFilters,
  groupByCity,
  hasLongStayDiscount,
  isSeaView,
  isFamilySized,
  isTopRated,
  rankByPopularity,
  recentlyAddedSection,
  townSlug,
  type ExploreListing,
  type MarketplaceListing,
} from "./marketplace";

function listing(overrides: Partial<MarketplaceListing> & { id: string }): MarketplaceListing {
  return {
    city: "Blackpool",
    amenities: [],
    createdAt: new Date("2026-01-01"),
    ...overrides,
  };
}

describe("isSeaView", () => {
  it("matches a sea or ocean view, however the host wrote it", () => {
    expect(isSeaView(["Wifi", "Sea view"])).toBe(true);
    expect(isSeaView(["OCEAN VIEW"])).toBe(true);
    expect(isSeaView(["Sea-view balcony"])).toBe(true);
  });

  it("doesn't count beach access or the word 'sea' alone as a view", () => {
    expect(isSeaView(["Beach access"])).toBe(false);
    expect(isSeaView(["Near the sea"])).toBe(false);
    expect(isSeaView([])).toBe(false);
  });
});

describe("groupByCity", () => {
  it("only includes cities that meet the minimum listing count", () => {
    const listings = [
      listing({ id: "1", city: "Blackpool" }),
      listing({ id: "2", city: "Blackpool" }),
      listing({ id: "3", city: "Fleetwood" }), // only 1 — excluded
    ];

    const sections = groupByCity(listings);

    expect(sections).toHaveLength(1);
    expect(sections[0].title).toBe("Popular in Blackpool");
    expect(sections[0].listings.map((l) => l.id)).toEqual(["1", "2"]);
  });

  it("returns no sections when no city meets the threshold", () => {
    const listings = [
      listing({ id: "1", city: "Blackpool" }),
      listing({ id: "2", city: "Fleetwood" }),
      listing({ id: "3", city: "Lytham" }),
    ];

    expect(groupByCity(listings)).toEqual([]);
  });

  it("caps the number of sections and prioritizes larger cities", () => {
    const listings = [
      ...Array.from({ length: 2 }, (_, i) => listing({ id: `a${i}`, city: "A" })),
      ...Array.from({ length: 4 }, (_, i) => listing({ id: `b${i}`, city: "B" })),
      ...Array.from({ length: 3 }, (_, i) => listing({ id: `c${i}`, city: "C" })),
    ];

    const sections = groupByCity(listings, { maxSections: 2 });

    expect(sections.map((s) => s.title)).toEqual(["Popular in B", "Popular in C"]);
  });
});

describe("recentlyAddedSection", () => {
  const now = new Date("2026-06-15");

  it("returns null when the whole catalog is recent (would duplicate the main feed)", () => {
    const listings = [
      listing({ id: "1", createdAt: new Date("2026-06-01") }),
      listing({ id: "2", createdAt: new Date("2026-06-10") }),
    ];
    expect(recentlyAddedSection(listings, { now })).toBeNull();
  });

  it("returns null when too few listings fall in the recency window", () => {
    const listings = [
      listing({ id: "1", createdAt: new Date("2026-06-10") }), // recent
      listing({ id: "2", createdAt: new Date("2025-01-01") }), // old
      listing({ id: "3", createdAt: new Date("2024-01-01") }), // old
    ];
    expect(recentlyAddedSection(listings, { now })).toBeNull();
  });

  it("returns the recent subset, newest first, once the catalog has grown beyond it", () => {
    const listings = [
      listing({ id: "old-1", createdAt: new Date("2024-01-01") }),
      listing({ id: "old-2", createdAt: new Date("2024-06-01") }),
      listing({ id: "new-1", createdAt: new Date("2026-06-01") }),
      listing({ id: "new-2", createdAt: new Date("2026-06-10") }),
    ];
    const section = recentlyAddedSection(listings, { now });
    expect(section?.listings.map((l) => l.id)).toEqual(["new-2", "new-1"]);
  });
});


describe("rankByPopularity", () => {
  const rated = (id: string, ratings: number[], createdAt = "2026-01-01") => ({
    ...listing({ id, createdAt: new Date(createdAt) }),
    reviews: ratings.map((rating) => ({ rating })),
  });

  it("puts rated stays first, best average first, more reviews breaking a tie, then newest", () => {
    const ranked = rankByPopularity([
      rated("unrated-old", [], "2026-01-01"),
      rated("four", [4, 4]),
      rated("five-once", [5]),
      rated("unrated-new", [], "2026-03-01"),
      rated("five-twice", [5, 5]),
    ]);
    expect(ranked.map((l) => l.id)).toEqual(["five-twice", "five-once", "four", "unrated-new", "unrated-old"]);
  });

  it("doesn't reorder the array it was given", () => {
    const input = [rated("a", []), rated("b", [5])];
    rankByPopularity(input);
    expect(input.map((l) => l.id)).toEqual(["a", "b"]);
  });
});

describe("isFamilySized", () => {
  it("needs two or more bedrooms", () => {
    expect(isFamilySized({ bedrooms: 1 })).toBe(false);
    expect(isFamilySized({ bedrooms: 2 })).toBe(true);
    expect(isFamilySized({ bedrooms: 4 })).toBe(true);
  });
});

describe("hasLongStayDiscount", () => {
  it("is true for a weekly or a monthly discount", () => {
    expect(hasLongStayDiscount({ weeklyDiscountPercent: 10, monthlyDiscountPercent: null })).toBe(true);
    expect(hasLongStayDiscount({ weeklyDiscountPercent: null, monthlyDiscountPercent: 20 })).toBe(true);
  });

  it("is false with no discount, or a zero one", () => {
    expect(hasLongStayDiscount({ weeklyDiscountPercent: null, monthlyDiscountPercent: null })).toBe(false);
    expect(hasLongStayDiscount({ weeklyDiscountPercent: 0, monthlyDiscountPercent: 0 })).toBe(false);
  });
});

describe("isTopRated", () => {
  const ratings = (...values: number[]) => values.map((rating) => ({ rating }));

  it("needs at least three reviews, so one or two 5-star reviews aren't enough", () => {
    expect(isTopRated([])).toBe(false);
    expect(isTopRated(ratings(5))).toBe(false);
    expect(isTopRated(ratings(5, 5))).toBe(false);
    expect(isTopRated(ratings(5, 5, 5))).toBe(true);
  });

  it("needs an average of 4.5 or more", () => {
    expect(isTopRated(ratings(5, 4, 5, 4))).toBe(true);
    expect(isTopRated(ratings(5, 4, 4, 4))).toBe(false);
  });
});

describe("townSlug", () => {
  it("makes a town name URL-safe", () => {
    expect(townSlug("Blackpool")).toBe("blackpool");
    expect(townSlug("St Annes")).toBe("st-annes");
    expect(townSlug("Poulton-le-Fylde")).toBe("poulton-le-fylde");
  });
});

describe("buildExploreFilters", () => {
  function stay(id: string, overrides: Partial<ExploreListing> = {}): ExploreListing {
    return {
      id,
      city: "Blackpool",
      amenities: [],
      createdAt: new Date("2026-01-01"),
      bedrooms: 1,
      weeklyDiscountPercent: null,
      monthlyDiscountPercent: null,
      reviews: [],
      ...overrides,
    };
  }

  it("offers only filters real stays back, each linking to the same filter on the results page", () => {
    const filters = buildExploreFilters([
      stay("1", { bedrooms: 3, amenities: ["Sea view"] }),
      stay("2", { bedrooms: 2, weeklyDiscountPercent: 10 }),
      stay("3", { city: "St Annes", amenities: ["Sea view"] }),
      stay("4", { city: "St Annes" }),
      stay("5", { city: "Lytham" }),
    ]);

    expect(filters.map((filter) => [filter.key, filter.group, filter.href])).toEqual([
      ["all", "kind", "/search"],
      ["families", "kind", "/search?minBedrooms=2"],
      ["sea-views", "kind", "/search?amenities=sea_view"],
      ["blackpool", "town", "/search?city=Blackpool"],
      ["st-annes", "town", "/search?city=St%20Annes"],
    ]);
    expect(filters.find((filter) => filter.key === "families")?.listingIds).toEqual(["1", "2"]);
    expect(filters.find((filter) => filter.key === "st-annes")?.seeAllLabel).toBe("See all St Annes stays");
  });

  it("adds Top rated and Long-stay discounts once two stays qualify", () => {
    const fiveStars = [{ rating: 5 }, { rating: 5 }, { rating: 5 }];
    const filters = buildExploreFilters([
      stay("1", { reviews: fiveStars, monthlyDiscountPercent: 20 }),
      stay("2", { reviews: fiveStars, weeklyDiscountPercent: 5 }),
    ]);
    expect(filters.map((filter) => filter.label)).toEqual(["All", "Top rated", "Long-stay discounts", "Blackpool"]);
    expect(filters.find((filter) => filter.key === "long-stay")?.href).toBe("/search?longStay=1");
    expect(filters.find((filter) => filter.key === "top-rated")?.href).toBe("/search?topRated=1");
  });
});
