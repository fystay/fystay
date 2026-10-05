import { describe, expect, it } from "vitest";
import {
  beachStaysSection,
  groupByCity,
  isBeachStay,
  rankByPopularity,
  recentlyAddedSection,
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

describe("isBeachStay", () => {
  it("matches sea/ocean/beach amenities case-insensitively", () => {
    expect(isBeachStay(["Wifi", "Sea view"])).toBe(true);
    expect(isBeachStay(["OCEAN VIEW"])).toBe(true);
    expect(isBeachStay(["Beach access"])).toBe(true);
  });

  it("returns false when nothing matches", () => {
    expect(isBeachStay(["Wifi", "Kitchen"])).toBe(false);
    expect(isBeachStay([])).toBe(false);
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

describe("beachStaysSection", () => {
  it("returns null when fewer than the minimum qualify", () => {
    const listings = [listing({ id: "1", amenities: ["Sea view"] })];
    expect(beachStaysSection(listings)).toBeNull();
  });

  it("returns a section once enough listings qualify", () => {
    const listings = [
      listing({ id: "1", amenities: ["Sea view"] }),
      listing({ id: "2", amenities: ["Ocean view"] }),
      listing({ id: "3", amenities: ["Wifi"] }),
    ];
    const section = beachStaysSection(listings);
    expect(section?.listings.map((l) => l.id)).toEqual(["1", "2"]);
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
