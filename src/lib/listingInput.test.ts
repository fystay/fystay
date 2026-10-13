import { describe, expect, it } from "vitest";
import { createListingSchema } from "./listingInput";

const listing = (overrides: Record<string, unknown> = {}) => ({
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
  ...overrides,
});

const errorOf = (overrides: Record<string, unknown>) => {
  const parsed = createListingSchema.safeParse(listing(overrides));
  return parsed.success ? null : parsed.error.issues[0]?.message;
};

describe("createListingSchema times", () => {
  it("accepts picker times, overnight quiet hours and no times at all", () => {
    expect(errorOf({ checkInTime: "15:00", checkOutTime: "11:00", quietHoursStart: "22:00", quietHoursEnd: "07:00" })).toBeNull();
    expect(errorOf({ checkInTime: null, quietHoursStart: null, quietHoursEnd: null })).toBeNull();
    expect(errorOf({})).toBeNull();
  });

  it("refuses free text on a new listing", () => {
    expect(errorOf({ checkInTime: "After 3pm" })).toMatch(/must be a time like 15:00/);
  });

  it("refuses quiet hours that start and end at the same time, or have only one end", () => {
    expect(errorOf({ quietHoursStart: "22:00", quietHoursEnd: "22:00" })).toMatch(/same time/);
    expect(errorOf({ quietHoursStart: "22:00" })).toMatch(/both/);
  });
});
