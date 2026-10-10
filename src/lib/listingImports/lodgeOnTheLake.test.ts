import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createListingSchema } from "@/lib/listingInput";
import { hasBedroomCountMismatch } from "@/lib/listingDataQuality";
import { AMENITY_CATEGORIES } from "@/lib/amenityCategories";
import {
  LODGE_ON_THE_LAKE_AMENITIES,
  LODGE_ON_THE_LAKE_DESCRIPTION,
  LODGE_ON_THE_LAKE_PHOTOS,
  buildLodgeOnTheLakeListing,
  parseOwnerTerms,
  type OwnerTerms,
} from "./lodgeOnTheLake";

const TERMS: OwnerTerms = {
  pricePerNightCents: 15_000,
  minNights: 2,
  cancellationPolicy: "MODERATE",
  smokingAllowed: false,
  partiesAllowed: false,
};
const URLS = LODGE_ON_THE_LAKE_PHOTOS.map((p) => `https://example.supabase.co/storage/v1/object/public/listing-photos/h/${p.file}`);

const REQUIRED_ARGS = [
  "--nightly-price", "150",
  "--min-nights", "2",
  "--cancellation-policy", "moderate",
  "--smoking-allowed", "no",
  "--parties-allowed", "no",
];

describe("Lodge on the Lake listing", () => {
  it("passes the same validation as a host's own create-listing form", () => {
    expect(createListingSchema.safeParse(buildLodgeOnTheLakeListing(TERMS, URLS)).success).toBe(true);
  });

  it("carries the confirmed facts and is always request-to-book", () => {
    const listing = buildLodgeOnTheLakeListing(TERMS, URLS);
    expect(listing).toMatchObject({ maxGuests: 6, bedrooms: 3, beds: 4, bathrooms: 2, city: "Carnforth", instantBook: false });
    expect(listing.photos).toEqual(URLS);
  });

  it("takes every business term from the owner, never a default", () => {
    const listing = buildLodgeOnTheLakeListing({ ...TERMS, smokingAllowed: true, cancellationPolicy: "STRICT", minNights: 3 }, URLS);
    expect(listing).toMatchObject({ smokingAllowed: true, cancellationPolicy: "STRICT", minNights: 3, pricePerNightCents: 15_000 });
    expect(listing.cleaningFeeCents).toBe(0);
    expect(listing.checkInTime).toBeNull();
  });

  it("doesn't let the description contradict the bedroom count", () => {
    expect(hasBedroomCountMismatch(LODGE_ON_THE_LAKE_DESCRIPTION, 3)).toBe(false);
  });

  it("makes no claim the owner hasn't confirmed", () => {
    const text = `${LODGE_ON_THE_LAKE_DESCRIPTION} ${LODGE_ON_THE_LAKE_AMENITIES.join(" ")}`.toLowerCase();
    for (const claim of ["waterfront", "hot tub", "pet", "accessible", "wheelchair", "ev charg", "review", "rated", "superhost", "free fishing"]) {
      expect(text).not.toContain(claim);
    }
    // Near the Lake District, never inside its national park.
    expect(text).not.toMatch(/in(side)? the lake district national park/);
    expect(LODGE_ON_THE_LAKE_DESCRIPTION).toContain("not inside either national park");
  });

  it("keeps the village's paid facilities out of the amenity filters", () => {
    const matched = AMENITY_CATEGORIES.filter((c) => c.test(LODGE_ON_THE_LAKE_AMENITIES)).map((c) => c.key);
    expect(matched).toEqual(expect.arrayContaining(["wifi", "parking", "kitchen"]));
    expect(LODGE_ON_THE_LAKE_AMENITIES.join(" ")).not.toMatch(/pool|gym|spa\b/i);
  });

  it("ships every gallery photo, each with descriptive alt text", () => {
    const dir = path.join(__dirname, "../../../scripts/listings/lodge-on-the-lake/photos");
    for (const photo of LODGE_ON_THE_LAKE_PHOTOS) {
      expect(existsSync(path.join(dir, photo.file)), photo.file).toBe(true);
      expect(photo.alt.length).toBeGreaterThan(20);
    }
    expect(LODGE_ON_THE_LAKE_PHOTOS[0].file).toBe("01-lodge-across-water.jpg");
  });
});

describe("parseOwnerTerms", () => {
  it("reads the owner's terms", () => {
    expect(parseOwnerTerms([...REQUIRED_ARGS, "--cleaning-fee", "59.50", "--check-in", "From 4pm"])).toEqual({
      terms: {
        pricePerNightCents: 15_000,
        cleaningFeeCents: 5_950,
        minNights: 2,
        cancellationPolicy: "MODERATE",
        smokingAllowed: false,
        partiesAllowed: false,
        checkInTime: "From 4pm",
        checkOutTime: undefined,
      },
    });
  });

  it("refuses to run without the owner's terms, naming each one", () => {
    const result = parseOwnerTerms([]);
    expect("errors" in result && result.errors).toEqual([
      expect.stringContaining("--nightly-price"),
      expect.stringContaining("--min-nights"),
      expect.stringContaining("--cancellation-policy"),
      expect.stringContaining("--smoking-allowed"),
      expect.stringContaining("--parties-allowed"),
    ]);
  });

  it("rejects malformed values rather than guessing", () => {
    for (const [name, value] of [["--nightly-price", "£150"], ["--min-nights", "0"], ["--cancellation-policy", "custom"], ["--smoking-allowed", "maybe"]]) {
      const args = [...REQUIRED_ARGS];
      args[args.indexOf(name) + 1] = value;
      expect("errors" in parseOwnerTerms(args), `${name} ${value}`).toBe(true);
    }
  });
});
