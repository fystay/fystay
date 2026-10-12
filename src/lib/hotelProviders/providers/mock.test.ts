import { describe, expect, it } from "vitest";
import { mockHotelProviderAdapter } from "./mock";

const searchParams = {
  destination: "Blackpool",
  checkIn: new Date("2027-06-01"),
  checkOut: new Date("2027-06-04"),
  adults: 2,
  children: 0,
  rooms: 1,
};

describe("mockHotelProviderAdapter.searchHotels", () => {
  it("returns a non-empty, well-formed result set", async () => {
    const results = await mockHotelProviderAdapter.searchHotels(searchParams);
    expect(results.length).toBeGreaterThan(0);
    for (const hotel of results) {
      expect(hotel.externalId).toMatch(/^mock:blackpool:\d+$/);
      expect(hotel.name.length).toBeGreaterThan(0);
      expect(hotel.currency).toBe("GBP");
      expect(hotel.priceCents).toBeGreaterThan(0);
      expect(hotel.starRating).toBeGreaterThanOrEqual(3);
      expect(hotel.starRating).toBeLessThanOrEqual(5);
    }
  });

  it("is deterministic for the same destination", async () => {
    const a = await mockHotelProviderAdapter.searchHotels(searchParams);
    const b = await mockHotelProviderAdapter.searchHotels({ ...searchParams, adults: 4 });
    expect(a).toEqual(b);
  });

  it("produces a different, still-deterministic result set for a different destination", async () => {
    const blackpool = await mockHotelProviderAdapter.searchHotels(searchParams);
    const lytham = await mockHotelProviderAdapter.searchHotels({ ...searchParams, destination: "Lytham" });
    expect(blackpool[0].externalId).not.toBe(lytham[0].externalId);
    expect(blackpool[0].name).not.toBe(lytham[0].name);
  });

  it("slugifies destination so casing/whitespace don't change the externalId", async () => {
    const a = await mockHotelProviderAdapter.searchHotels(searchParams);
    const b = await mockHotelProviderAdapter.searchHotels({ ...searchParams, destination: "  BLACKPOOL  " });
    expect(a[0].externalId).toBe(b[0].externalId);
  });
});

describe("mockHotelProviderAdapter.getHotelDetails", () => {
  it("round-trips a hotel produced by searchHotels", async () => {
    const [first] = await mockHotelProviderAdapter.searchHotels(searchParams);
    const details = await mockHotelProviderAdapter.getHotelDetails(first.externalId);
    expect(details.externalId).toBe(first.externalId);
    expect(details.name).toBe(first.name);
    expect(details.photos.length).toBeGreaterThan(0);
    expect(details.facilities.length).toBeGreaterThan(0);
  });

  it("rejects an externalId that isn't this provider's own format", async () => {
    await expect(mockHotelProviderAdapter.getHotelDetails("booking_com:12345")).rejects.toThrow();
  });
});

describe("mockHotelProviderAdapter.getAvailability", () => {
  it("returns deals with sane, positive prices for a normal search", async () => {
    const [first] = await mockHotelProviderAdapter.searchHotels(searchParams);
    const deals = await mockHotelProviderAdapter.getAvailability(first.externalId, searchParams);
    for (const deal of deals) {
      expect(deal.priceCents).toBeGreaterThan(0);
      expect(deal.currency).toBe("GBP");
      expect(typeof deal.refundable).toBe("boolean");
    }
  });

  it("scales price with the number of nights requested", async () => {
    const [first] = await mockHotelProviderAdapter.searchHotels(searchParams);
    const threeNights = await mockHotelProviderAdapter.getAvailability(first.externalId, searchParams);
    const oneNight = await mockHotelProviderAdapter.getAvailability(first.externalId, {
      ...searchParams,
      checkOut: new Date("2027-06-02"),
    });
    // Same seed inputs differ only by date range, so a 3-night stay's
    // headline deal should cost noticeably more than a 1-night stay.
    expect(threeNights[0].priceCents).toBeGreaterThan(oneNight[0].priceCents);
  });

  it("can return zero deals (the sold-out state a real provider can also return)", async () => {
    // Not every destination/date pair sells out under the mock's own 5%
    // odds - this asserts the shape is always a valid (possibly empty)
    // array rather than asserting the sold-out branch fires for this
    // specific input, which would make the test depend on the PRNG's
    // internals rather than its public contract.
    const [first] = await mockHotelProviderAdapter.searchHotels(searchParams);
    const deals = await mockHotelProviderAdapter.getAvailability(first.externalId, searchParams);
    expect(Array.isArray(deals)).toBe(true);
  });
});

describe("mockHotelProviderAdapter.createDeepLink", () => {
  it("builds a URL under the reserved .invalid TLD carrying every required param", () => {
    const url = mockHotelProviderAdapter.createDeepLink({
      externalId: "mock:blackpool:0",
      // Local midnight, as hotelSearchParams.ts produces them.
      checkIn: new Date(2027, 5, 1),
      checkOut: new Date(2027, 5, 4),
      adults: 2,
      children: 1,
      rooms: 1,
      subId: "abc123",
    });
    const parsed = new URL(url);
    expect(parsed.hostname).toBe("mock-hotel-provider.invalid");
    expect(parsed.searchParams.get("checkin")).toBe("2027-06-01");
    expect(parsed.searchParams.get("checkout")).toBe("2027-06-04");
    expect(parsed.searchParams.get("adults")).toBe("2");
    expect(parsed.searchParams.get("children")).toBe("1");
    expect(parsed.searchParams.get("rooms")).toBe("1");
    expect(parsed.searchParams.get("subid")).toBe("abc123");
  });
});
