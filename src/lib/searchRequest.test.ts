import { describe, expect, it } from "vitest";
import { locationWhere, matchesLocation, parseBounds, parseSearchRequest, searchArea, type SearchLocation } from "./searchRequest";

const NOW = new Date("2026-10-12T10:00:00Z");
const ok = { checkIn: "2026-10-20", checkOut: "2026-10-23" };
const place = { place: "ChIJ_place_blackpool", placeLabel: "Blackpool", lat: "53.8175", lng: "-3.0357" };
const parse = (params: Record<string, string>) => parseSearchRequest(params, NOW);

describe("parseSearchRequest", () => {
  it("accepts a picked Google place with valid dates, keeping its details", () => {
    const result = parse({ ...place, bbox: "53.77,-3.06,53.87,-2.98", ...ok });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.location).toEqual({
      kind: "place",
      placeId: "ChIJ_place_blackpool",
      label: "Blackpool",
      latitude: 53.8175,
      longitude: -3.0357,
      bounds: { south: 53.77, west: -3.06, north: 53.87, east: -2.98 },
    });
    expect(result.checkIn.toISOString()).toBe("2026-10-20T00:00:00.000Z");
  });

  it("accepts a town and a curated landmark by name", () => {
    expect(parse({ city: "Blackpool", ...ok }).ok).toBe(true);
    const landmark = parse({ near: "Blackpool Tower", city: "Blackpool", ...ok });
    expect(landmark.ok && landmark.location.kind).toBe("landmark");
  });

  it("is an empty prompt when nothing is given, and names each missing field", () => {
    const empty = parse({});
    expect(empty).toMatchObject({ ok: false, empty: true });
    expect(!empty.ok && Object.keys(empty.errors).sort()).toEqual(["checkIn", "checkOut", "where"]);
    const noWhere = parse({ ...ok });
    expect(noWhere).toMatchObject({ ok: false, empty: false, errors: { where: expect.any(String) } });
    expect(parse({ city: "Blackpool", checkOut: "2026-10-23" })).toMatchObject({ ok: false, errors: { checkIn: "Add a check-in date." } });
    expect(parse({ city: "Blackpool", checkIn: "2026-10-20" })).toMatchObject({ ok: false, errors: { checkOut: "Add a check-out date." } });
  });

  it("rejects past check-in and check-out on or before check-in", () => {
    expect(parse({ city: "Blackpool", checkIn: "2026-10-11", checkOut: "2026-10-14" })).toMatchObject({ errors: { checkIn: "Check-in can't be in the past." } });
    expect(parse({ city: "Blackpool", checkIn: "2026-10-12", checkOut: "2026-10-13" }).ok).toBe(true); // today is fine
    expect(parse({ city: "Blackpool", checkIn: "2026-10-20", checkOut: "2026-10-20" })).toMatchObject({ errors: { checkOut: "Check-out must be after check-in." } });
    expect(parse({ city: "Blackpool", checkIn: "2026-10-20", checkOut: "2026-10-18" })).toMatchObject({ errors: { checkOut: "Check-out must be after check-in." } });
    expect(parse({ city: "Blackpool", checkIn: "2026-02-31", checkOut: "2026-10-18" })).toMatchObject({ errors: { checkIn: "Check-in isn't a valid date." } });
    expect(parse({ city: "Blackpool", checkIn: "2026-10-20", checkOut: "2028-10-20" })).toMatchObject({ errors: { checkOut: expect.stringContaining("365") } });
  });

  it("rejects malformed, out-of-range or missing coordinates for a place", () => {
    for (const bad of [
      { lat: "", lng: "-3.03" },
      { lat: "abc", lng: "-3.03" },
      { lat: "91", lng: "-3.03" },
      { lat: "53.8", lng: "-181" },
      { lat: "1e2", lng: "-3.03" },
      { lat: "Infinity", lng: "-3.03" },
      { lat: "53.8", lng: "0x10" },
    ]) {
      expect(parse({ ...place, ...bad, ...ok }), JSON.stringify(bad)).toMatchObject({ ok: false, errors: { where: expect.stringContaining("isn't valid") } });
    }
    expect(parse({ ...place, place: "../../etc", ...ok }).ok).toBe(false);
    expect(parse({ ...place, placeLabel: "", ...ok }).ok).toBe(false);
  });

  it("rejects a malformed, inverted or out-of-range bounding box, or one not containing the point", () => {
    for (const bbox of ["53.8,-3.1,53.9", "a,b,c,d", "53.9,-3.1,53.8,-3.0", "53.8,-3.0,53.9,-3.1", "53.8,-3.1,95,-3.0", "50,-3.1,51,-3.0"]) {
      expect(parse({ ...place, bbox, ...ok }).ok, bbox).toBe(false);
    }
  });

  it("rejects an unknown landmark name and an over-long town", () => {
    expect(parse({ near: "Somewhere made up", ...ok }).ok).toBe(false);
    expect(parse({ city: "x".repeat(101), ...ok }).ok).toBe(false);
  });
});

describe("parseBounds", () => {
  it("reads south,west,north,east", () => {
    expect(parseBounds("53.7, -3.1, 53.9, -2.9")).toEqual({ south: 53.7, west: -3.1, north: 53.9, east: -2.9 });
  });

  it("accepts Google's full-precision viewport corners (picking Manchester failed with 15 decimal places)", () => {
    expect(parseBounds("53.340099894221245,-2.319930911325602,53.54458610034016,-2.146828085398713")).toEqual({
      south: 53.340099894221245,
      west: -2.319930911325602,
      north: 53.54458610034016,
      east: -2.146828085398713,
    });
  });
});

describe("a picked Google place at full precision", () => {
  it("is a valid search", () => {
    const result = parseSearchRequest(
      {
        place: "ChIJ2_UmUkxNekgRqmv-BDgUvtk",
        placeLabel: "Manchester, UK",
        lat: "53.48075930000001",
        lng: "-2.2426305",
        bbox: "53.340099894221245,-2.319930911325602,53.54458610034016,-2.146828085398713",
        checkIn: "2099-10-15",
        checkOut: "2099-10-17",
      },
      new Date("2099-10-01T12:00:00Z"),
    );
    expect(result.ok).toBe(true);
  });
});

describe("geospatial area", () => {
  const blackpool: SearchLocation = {
    kind: "place",
    placeId: "ChIJ_place_blackpool",
    label: "Blackpool",
    latitude: 53.8175,
    longitude: -3.0357,
    bounds: { south: 53.75, west: -3.07, north: 53.88, east: -2.98 },
  };
  const postcode: SearchLocation = { ...blackpool, label: "FY1 1AA", bounds: { south: 53.817, west: -3.036, north: 53.818, east: -3.035 } };
  const at = (latitude: number, longitude: number, city = "Blackpool") => ({ latitude, longitude, city });

  it("includes stays inside the place's viewport or within 5 miles of its point, and nothing else", () => {
    expect(matchesLocation(blackpool, at(53.86, -3.0))).toBe(true); // inside viewport
    expect(matchesLocation(blackpool, at(53.8175, -3.1))).toBe(true); // outside the viewport, ~2.6 miles away
    expect(matchesLocation(blackpool, at(53.735, -3.03))).toBe(false); // outside the viewport, ~5.7 miles away
    expect(matchesLocation(blackpool, at(53.48, -2.24, "Manchester"))).toBe(false);
    // A postcode's own viewport is tiny; the 5-mile radius applies.
    expect(matchesLocation(postcode, at(53.85, -3.05))).toBe(true);
    expect(matchesLocation(postcode, at(53.93, -3.03, "Fleetwood"))).toBe(false); // ~8 miles
  });

  it("queries a box that contains the whole area, for the latitude/longitude index", () => {
    const area = searchArea(blackpool)!;
    expect(area.box.south).toBeLessThanOrEqual(53.75);
    expect(area.box.north).toBeGreaterThanOrEqual(53.88);
    const where = locationWhere(blackpool) as { OR: object[] };
    expect(where.OR[0]).toEqual({ latitude: { gte: area.box.south, lte: area.box.north }, longitude: { gte: area.box.west, lte: area.box.east } });
    // Not-yet-geocoded stays count only when they're in the named town.
    expect(where.OR[1]).toEqual({ latitude: null, city: { equals: "Blackpool", mode: "insensitive" } });
  });

  it("matches a town by name, with no area", () => {
    expect(searchArea({ kind: "town", city: "Lytham" })).toBeNull();
    expect(locationWhere({ kind: "town", city: "Lytham" })).toMatchObject({ OR: [{ city: { contains: "Lytham" } }, { country: { contains: "Lytham" } }] });
  });
});
