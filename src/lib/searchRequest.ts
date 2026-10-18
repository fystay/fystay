import { distanceMiles } from "@/lib/geo";
import { findLandmarkByName } from "@/lib/landmarks";
import { parseStayDate, todayStayDate } from "@/lib/stayDates";

/**
 * The main accommodation search needs three things - where, check-in and
 * check-out - and this is the one place that decides whether a request
 * has them. The /search page and GET /api/listings both run it, so a
 * direct API call can't skip what the search bar enforces.
 *
 * "Where" is always something picked from the search box's suggestions:
 *   - a FYStay town (?city=), checked against real listing towns by the caller;
 *   - a curated landmark (?near=), looked up by name, never coordinates from the URL;
 *   - a Google place (?place=&lat=&lng=[&bbox=]), with coordinates the box
 *     fetched from Google when it was picked.
 */

export type Bounds = { south: number; west: number; north: number; east: number };

export type SearchLocation =
  | { kind: "town"; city: string }
  | { kind: "landmark"; name: string; town: string; latitude: number; longitude: number }
  | { kind: "place"; placeId: string; label: string; latitude: number; longitude: number; bounds: Bounds | null };

export type SearchField = "where" | "checkIn" | "checkOut";

export type SearchRequest =
  | { ok: true; location: SearchLocation; checkIn: Date; checkOut: Date; checkInParam: string; checkOutParam: string }
  | { ok: false; errors: Partial<Record<SearchField, string>>; /** Nothing at all was entered - a prompt, not an error. */ empty: boolean };

type Params = Record<string, string | string[] | undefined> | URLSearchParams;

function read(params: Params, key: string): string {
  const value = params instanceof URLSearchParams ? params.get(key) : params[key];
  return typeof value === "string" ? value.trim() : "";
}

// Plain decimal numbers only: "1e3", "0x10", "Infinity" and "" are malformed.
// Up to 17 decimal places - as many as a JavaScript number can print, and
// Google's viewport corners often have 15 (a 12-place limit rejected every
// picked town with a viewport, e.g. Manchester).
const DECIMAL = /^-?\d{1,3}(\.\d{1,17})?$/;
const PLACE_ID = /^[A-Za-z0-9_-]{10,300}$/;
// Longest stay the search accepts, matching what the date picker allows.
const MAX_NIGHTS = 365;
// How far ahead a search may start.
const MAX_DAYS_AHEAD = 2 * 365;
const DAY_MS = 86_400_000;

export function parseLatitude(value: string): number | null {
  if (!DECIMAL.test(value)) return null;
  const n = Number(value);
  return n >= -90 && n <= 90 ? n : null;
}

export function parseLongitude(value: string): number | null {
  if (!DECIMAL.test(value)) return null;
  const n = Number(value);
  return n >= -180 && n <= 180 ? n : null;
}

/** "south,west,north,east". Rejects anything malformed, out of range or inverted. */
export function parseBounds(value: string): Bounds | null {
  const parts = value.split(",").map((p) => p.trim());
  if (parts.length !== 4) return null;
  const [south, north] = [parseLatitude(parts[0]), parseLatitude(parts[2])];
  const [west, east] = [parseLongitude(parts[1]), parseLongitude(parts[3])];
  if (south === null || north === null || west === null || east === null) return null;
  if (south >= north || west >= east) return null;
  return { south, west, north, east };
}

function parseLocation(params: Params): { location: SearchLocation | null; error?: string; given: boolean } {
  const placeId = read(params, "place");
  const near = read(params, "near");
  const city = read(params, "city");
  const given = Boolean(placeId || near || city || read(params, "lat") || read(params, "lng"));
  const pick = "Choose a place from the suggestions.";

  if (placeId) {
    const latitude = parseLatitude(read(params, "lat"));
    const longitude = parseLongitude(read(params, "lng"));
    const bboxParam = read(params, "bbox");
    const bounds = bboxParam ? parseBounds(bboxParam) : null;
    const label = read(params, "placeLabel").slice(0, 120);
    if (!PLACE_ID.test(placeId) || latitude === null || longitude === null || (bboxParam && !bounds) || !label) {
      return { location: null, error: "That location isn't valid. " + pick, given };
    }
    if (bounds && !inBounds(bounds, latitude, longitude)) {
      return { location: null, error: "That location isn't valid. " + pick, given };
    }
    return { location: { kind: "place", placeId, label, latitude, longitude, bounds }, given };
  }
  if (near) {
    const landmark = findLandmarkByName(near);
    if (!landmark) return { location: null, error: pick, given };
    return {
      location: { kind: "landmark", name: landmark.name, town: landmark.town, latitude: landmark.latitude, longitude: landmark.longitude },
      given,
    };
  }
  if (city) {
    if (city.length > 100) return { location: null, error: pick, given };
    return { location: { kind: "town", city }, given };
  }
  return { location: null, error: given ? pick : "Choose where you're going.", given };
}

/** No dates given yet - a next step rather than a mistake (see the results page's prompt). */
export const MISSING_CHECK_IN = "Add a check-in date.";
export const MISSING_CHECK_OUT = "Add a check-out date.";

export function parseSearchRequest(params: Params, now: Date = new Date()): SearchRequest {
  const errors: Partial<Record<SearchField, string>> = {};
  const { location, error: whereError, given: whereGiven } = parseLocation(params);
  if (whereError) errors.where = whereError;

  const checkInParam = read(params, "checkIn");
  const checkOutParam = read(params, "checkOut");
  const today = todayStayDate(now);
  const checkIn = checkInParam ? parseStayDate(checkInParam) : null;
  const checkOut = checkOutParam ? parseStayDate(checkOutParam) : null;

  if (!checkInParam) errors.checkIn = MISSING_CHECK_IN;
  else if (!checkIn) errors.checkIn = "Check-in isn't a valid date.";
  else if (checkIn < today) errors.checkIn = "Check-in can't be in the past.";
  else if (checkIn.getTime() - today.getTime() > MAX_DAYS_AHEAD * DAY_MS) errors.checkIn = "Check-in is too far ahead.";

  if (!checkOutParam) errors.checkOut = MISSING_CHECK_OUT;
  else if (!checkOut) errors.checkOut = "Check-out isn't a valid date.";
  else if (checkIn && checkOut <= checkIn) errors.checkOut = "Check-out must be after check-in.";
  else if (checkIn && checkOut.getTime() - checkIn.getTime() > MAX_NIGHTS * DAY_MS) errors.checkOut = `Stays can be up to ${MAX_NIGHTS} nights.`;

  if (location && checkIn && checkOut && Object.keys(errors).length === 0) {
    return { ok: true, location, checkIn, checkOut, checkInParam, checkOutParam };
  }
  return { ok: false, errors, empty: !whereGiven && !checkInParam && !checkOutParam };
}

// --- Where results may be ------------------------------------------------

/** Around a picked place or landmark. A place also covers its own Google viewport (a whole town), but an address or postcode's viewport is only a few streets. */
export const PLACE_RADIUS_MILES = 5;
const MILES_PER_DEGREE_LAT = 69.0;

function inBounds(b: Bounds, latitude: number, longitude: number): boolean {
  return latitude >= b.south && latitude <= b.north && longitude >= b.west && longitude <= b.east;
}

function radiusBox(latitude: number, longitude: number, miles: number): Bounds {
  const dLat = miles / MILES_PER_DEGREE_LAT;
  const dLng = miles / (MILES_PER_DEGREE_LAT * Math.max(Math.cos((latitude * Math.PI) / 180), 0.01));
  return { south: latitude - dLat, north: latitude + dLat, west: longitude - dLng, east: longitude + dLng };
}

export type SearchArea = {
  /** A box containing every match, for an indexed latitude/longitude range query. */
  box: Bounds;
  /** The exact test: inside the picked place's own area, or within the radius of its point. */
  contains: (point: { latitude: number; longitude: number }) => boolean;
  center: { latitude: number; longitude: number };
};

/** The area a coordinate-based location covers, or null for a town (matched by name). */
export function searchArea(location: SearchLocation): SearchArea | null {
  if (location.kind === "town") return null;
  const center = { latitude: location.latitude, longitude: location.longitude };
  const radius = PLACE_RADIUS_MILES;
  const circle = radiusBox(center.latitude, center.longitude, radius);
  const bounds = location.kind === "place" ? location.bounds : null;
  const box = bounds
    ? {
        south: Math.min(bounds.south, circle.south),
        west: Math.min(bounds.west, circle.west),
        north: Math.max(bounds.north, circle.north),
        east: Math.max(bounds.east, circle.east),
      }
    : circle;
  return {
    box,
    center,
    contains: (point) =>
      (bounds !== null && inBounds(bounds, point.latitude, point.longitude)) || distanceMiles(center, point) <= radius,
  };
}

/** Prisma `where` for the location: the town by name, or the area's box (indexed). */
export function locationWhere(location: SearchLocation) {
  if (location.kind === "town") {
    return {
      OR: [
        { city: { contains: location.city, mode: "insensitive" as const } },
        { country: { contains: location.city, mode: "insensitive" as const } },
      ],
    };
  }
  const { box } = searchArea(location)!;
  // A listing not yet geocoded can't be placed on the map; it still counts
  // when it's in the town the place or landmark names.
  const town = location.kind === "landmark" ? location.town : location.label;
  return {
    OR: [
      { latitude: { gte: box.south, lte: box.north }, longitude: { gte: box.west, lte: box.east } },
      { latitude: null, city: { equals: town, mode: "insensitive" as const } },
    ],
  };
}

/** The exact location test after the box query (the box is a superset of the area). */
export function matchesLocation(
  location: SearchLocation,
  listing: { latitude: number | null; longitude: number | null; city: string },
): boolean {
  const area = searchArea(location);
  if (!area) return true; // the town query was already exact
  if (listing.latitude === null || listing.longitude === null) return true; // matched by town name in the query
  return area.contains({ latitude: listing.latitude, longitude: listing.longitude });
}
