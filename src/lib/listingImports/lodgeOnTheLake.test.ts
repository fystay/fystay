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
  LODGE_ON_THE_LAKE_OWNER_TERMS,
  buildLodgeOnTheLakeListing,
} from "./lodgeOnTheLake";
import { cancellationTermsSnapshot } from "@/lib/cancellationPolicy";
import { computeBookingPricing, stayRates, weekendRateError } from "@/lib/pricing";

const URLS = LODGE_ON_THE_LAKE_PHOTOS.map((p) => `https://example.supabase.co/storage/v1/object/public/listing-photos/h/${p.file}`);


describe("Lodge on the Lake listing", () => {
  it("passes the same validation as a host's own create-listing form", () => {
    expect(createListingSchema.safeParse(buildLodgeOnTheLakeListing(URLS)).success).toBe(true);
  });

  it("carries the confirmed facts and is always request-to-book", () => {
    const listing = buildLodgeOnTheLakeListing(URLS);
    expect(listing).toMatchObject({ maxGuests: 6, bedrooms: 3, beds: 4, bathrooms: 2, city: "Carnforth", instantBook: false });
    expect(listing.photos).toEqual(URLS);
  });

  it("carries the owner's own terms, not schema defaults", () => {
    const listing = buildLodgeOnTheLakeListing(URLS);
    expect(listing).toMatchObject({
      pricePerNightCents: 25_500,
      weekendPricePerNightCents: 27_500,
      minNights: 2,
      cancellationPolicy: "NON_REFUNDABLE",
      smokingAllowed: false,
      partiesAllowed: false,
      cleaningFeeCents: 0,
      checkInTime: null,
    });
    expect(weekendRateError({ ...LODGE_ON_THE_LAKE_OWNER_TERMS, propertyType: listing.propertyType })).toBeNull();
    expect(cancellationTermsSnapshot(LODGE_ON_THE_LAKE_OWNER_TERMS).cancellationPolicy).toBe("NON_REFUNDABLE");
  });

  it("prices a Thursday-to-Sunday stay at £255 + 2 x £275, plus FYStay's 10% fee", () => {
    const pricing = computeBookingPricing({
      nights: 3,
      ...stayRates(LODGE_ON_THE_LAKE_OWNER_TERMS, new Date("2026-11-05T00:00:00Z"), new Date("2026-11-08T00:00:00Z")),
    });
    expect(pricing.nightlySubtotalCents).toBe(80_500);
    expect(pricing.totalPriceCents).toBe(88_550);
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
