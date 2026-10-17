import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ findMany: vi.fn(), count: vi.fn() }));

vi.mock("@/lib/prisma", () => ({
  prisma: { listing: { findMany: (...a: unknown[]) => mocks.findMany(...a), count: (...a: unknown[]) => mocks.count(...a) } },
}));
vi.mock("@/auth", () => ({ auth: async () => null }));
vi.mock("@/lib/stripeConnect", () => ({ bookableHostWhere: () => ({}) }));

import { GET } from "./route";

const future = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const dates = `checkIn=${future(10)}&checkOut=${future(13)}`;
const get = (query: string) => GET(new Request(`http://x/api/listings?${query}`));

function stay(id: string, latitude: number | null, longitude: number | null, city = "Blackpool") {
  return {
    id, city, latitude, longitude, propertyType: "APARTMENT", maxGuests: 4, pricePerNightCents: 8000,
    bookings: [], availabilityBlocks: [], roomTypes: [], reviews: [],
  };
}

beforeEach(() => {
  mocks.findMany.mockReset().mockResolvedValue([]);
  mocks.count.mockReset().mockResolvedValue(0);
});

describe("GET /api/listings validation", () => {
  it("refuses a search with no where, no dates, or a typed (unpicked) town, without querying listings", async () => {
    for (const query of ["", dates, "city=Blackpool", `city=Blackpool&checkIn=${future(10)}`, `city=Nowhereville&${dates}`]) {
      const res = await get(query);
      expect(res.status, query).toBe(400);
      expect((await res.json()).fields).toBeTruthy();
    }
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it("refuses past or inverted dates and malformed coordinates", async () => {
    const place = "place=ChIJ_place_blackpool&placeLabel=Blackpool";
    for (const query of [
      `city=Blackpool&checkIn=2020-01-01&checkOut=2020-01-03`,
      `city=Blackpool&checkIn=${future(10)}&checkOut=${future(10)}`,
      `${place}&lat=999&lng=-3&${dates}`,
      `${place}&lat=53.8&lng=-3.0&bbox=54,-3.1,53,-2.9&${dates}`,
      `${place}&lat=53.8&lng=-3.0&bbox=nope&${dates}`,
      `${place}&lng=-3.0&${dates}`,
    ]) {
      expect((await get(query)).status, query).toBe(400);
    }
  });

  it("refuses malformed guests and prices instead of erroring", async () => {
    mocks.count.mockResolvedValue(1);
    for (const extra of ["guests=abc", "guests=0", "minPrice=-5", "maxPrice=1e9"]) {
      expect((await get(`city=Blackpool&${dates}&${extra}`)).status, extra).toBe(400);
    }
  });
});

describe("GET /api/listings geospatial search", () => {
  it("returns only stays inside the picked place's area, combined with guests and price", async () => {
    mocks.findMany.mockResolvedValue([stay("in", 53.82, -3.04), stay("far", 53.48, -2.24, "Manchester"), stay("no-coords", null, null)]);
    const res = await get(`place=ChIJ_place_blackpool&placeLabel=Blackpool&lat=53.8175&lng=-3.0357&${dates}&guests=3&maxPrice=9000`);
    expect(res.status).toBe(200);
    expect((await res.json()).listings.map((l: { id: string }) => l.id)).toEqual(["in", "no-coords"]);
    const where = mocks.findMany.mock.calls[0][0].where;
    expect(where.maxGuests).toEqual({ gte: 3 });
    expect(where.pricePerNightCents).toEqual({ lte: 9000 });
    expect(where.OR[0].latitude.gte).toBeLessThan(53.8175);
    expect(where.OR[1]).toEqual({ latitude: null, city: { equals: "Blackpool", mode: "insensitive" } });
  });

  it("accepts a known town", async () => {
    const res = await get(`city=Blackpool&${dates}`);
    expect(res.status).toBe(200);
  });
});
