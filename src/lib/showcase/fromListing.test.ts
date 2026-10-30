import { describe, expect, it } from "vitest";
import { showcaseFromListing, taglineFrom } from "./fromListing";

describe("taglineFrom", () => {
  it("takes the first sentence", () => {
    expect(taglineFrom("A bright flat by the sea. Sleeps four, with a balcony.")).toBe("A bright flat by the sea.");
  });
  it("shortens a very long first sentence on a word", () => {
    const tagline = taglineFrom(`${"A lovely home with a great deal to recommend it ".repeat(6)}.`, 80);
    expect(tagline.length).toBeLessThanOrEqual(81);
    expect(tagline.endsWith("…")).toBe(true);
  });
  it("is empty for no description", () => {
    expect(taglineFrom("  ")).toBe("");
  });
});

describe("showcaseFromListing", () => {
  const listing = {
    id: "l1",
    title: "Seaside flat",
    description: "A bright flat by the sea. Sleeps four.",
    city: "Blackpool",
    country: "England",
    propertyType: "APARTMENT" as const,
    photos: ["/a.jpg", "/b.jpg", "/c.jpg", "/d.jpg", "/e.jpg", "/f.jpg", "/g.jpg", "/h.jpg"],
    pricePerNightCents: 12000,
    weekendPricePerNightCents: 14000,
    minNights: 2,
    maxGuests: 4,
    bedrooms: 2,
    beds: 3,
    bathrooms: 1,
  };

  it("makes the first photo the hero, a few the phone carousel, and all of them the gallery", () => {
    const content = showcaseFromListing(listing);
    expect(content.hero.src).toBe("/a.jpg");
    expect(content.carousel).toHaveLength(6);
    expect(content.gallery).toHaveLength(8);
    expect(content.hero.alt).toBe("Seaside flat - photo 1");
  });

  it("carries the price, the weekend price, the facts and the tagline", () => {
    const content = showcaseFromListing(listing);
    expect(content.price).toMatchObject({ fromCents: 12000, weekendCents: 14000, minNights: 2 });
    expect(content.facts.map((fact) => `${fact.label} ${fact.value}`)).toEqual(["Sleeps 4", "Bedrooms 2", "Bathrooms 1", "Beds 3"]);
    expect(content.headline.before).toBe("A bright flat by the sea.");
    expect(content.place).toContain("Blackpool");
  });
});
