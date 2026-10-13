import { describe, expect, it } from "vitest";
import { computeBookingPricing } from "./pricing";
import { createListingSchema } from "./listingInput";
import {
  countOptions,
  discountExample,
  LISTING_COUNT_RANGES,
  nightOptions,
  stayLengthError,
} from "./listingFormOptions";

describe("countOptions", () => {
  it("covers the server's whole range", () => {
    const guests = countOptions(LISTING_COUNT_RANGES.maxGuests);
    expect(guests[0]).toBe(1);
    expect(guests.at(-1)).toBe(50);
    expect(countOptions(LISTING_COUNT_RANGES.bedrooms)[0]).toBe(0);
  });

  it("keeps a saved value outside the range rather than hiding it", () => {
    expect(countOptions(LISTING_COUNT_RANGES.maxGuests, "60").at(-1)).toBe(60);
    expect(countOptions(LISTING_COUNT_RANGES.beds, 0)[0]).toBe(0);
  });

  it("doesn't duplicate a value already offered, or add a blank", () => {
    expect(countOptions(LISTING_COUNT_RANGES.beds, "4")).toHaveLength(50);
    expect(countOptions(LISTING_COUNT_RANGES.beds, "")).toHaveLength(50);
  });
});

describe("nightOptions", () => {
  it("offers every night up to two weeks, then common stay lengths up to a year", () => {
    const options = nightOptions();
    expect(options.slice(0, 14)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
    expect(options).toContain(28);
    expect(options.at(-1)).toBe(365);
  });

  it("adds a saved value that isn't a standard step, in order", () => {
    const options = nightOptions("17");
    expect(options).toContain(17);
    expect(options.indexOf(17)).toBe(options.indexOf(14) + 1);
  });
});

describe("stayLengthError", () => {
  it("allows no maximum, or a maximum at least the minimum", () => {
    expect(stayLengthError("3", "")).toBeNull();
    expect(stayLengthError("3", "3")).toBeNull();
    expect(stayLengthError("3", "14")).toBeNull();
  });

  it("refuses a maximum below the minimum, like the server", () => {
    expect(stayLengthError("7", "3")).toMatch(/can't be shorter/);
    const parsed = createListingSchema.safeParse({
      title: "Sea view flat",
      description: "A bright flat by the sea with a balcony.",
      city: "Blackpool",
      country: "England",
      pricePerNightCents: 10_000,
      maxGuests: 2,
      bedrooms: 1,
      beds: 1,
      bathrooms: 1,
      photos: ["https://example.test/1.jpg"],
      minNights: 7,
      maxNights: 3,
    });
    expect(parsed.success).toBe(false);
  });
});

describe("discountExample", () => {
  const base = {
    pricePerNightCents: 10_000,
    weekendPricePerNightCents: null,
    weeklyDiscountPercent: 10,
    monthlyDiscountPercent: 25,
  };

  it("prices a week with the weekly discount, exactly as the booking engine does", () => {
    const example = discountExample({ ...base, nights: 7 });
    expect(example).toMatchObject({ beforeCents: 70_000, totalCents: 63_000, appliedName: "Weekly discount", appliedPercent: 10 });
    expect(example.totalCents).toBe(
      computeBookingPricing({ nights: 7, pricePerNightCents: 10_000, weeklyDiscountPercent: 10, monthlyDiscountPercent: 25 })
        .totalPriceCents,
    );
  });

  it("gives 28 nights the monthly discount instead of the weekly one", () => {
    expect(discountExample({ ...base, nights: 28 })).toMatchObject({ totalCents: 210_000, appliedName: "Monthly discount" });
  });

  it("falls back to the weekly discount at 28 nights when no monthly one is set", () => {
    expect(discountExample({ ...base, monthlyDiscountPercent: null, nights: 28 })).toMatchObject({
      appliedName: "Weekly discount",
      appliedPercent: 10,
    });
  });

  it("uses the last-minute deal only when it's bigger - never both", () => {
    expect(discountExample({ ...base, nights: 7, lastMinuteDiscountPercent: 20 })).toMatchObject({
      appliedName: "Last-minute deal",
      totalCents: 56_000,
    });
    expect(discountExample({ ...base, nights: 7, lastMinuteDiscountPercent: 5 })).toMatchObject({
      appliedName: "Weekly discount",
      totalCents: 63_000,
    });
  });

  it("includes the weekend rate for two nights of every week", () => {
    const example = discountExample({ ...base, weekendPricePerNightCents: 15_000, nights: 7 });
    expect(example.weekendNights).toBe(2);
    expect(example.beforeCents).toBe(5 * 10_000 + 2 * 15_000);
  });

  it("shows no discount below seven nights", () => {
    expect(discountExample({ ...base, nights: 3 })).toMatchObject({ appliedName: null, totalCents: 30_000 });
  });
});
