import type {
  AvailabilityParams,
  CreateDeepLinkParams,
  HotelDeal,
  HotelDetails,
  HotelProviderAdapter,
  HotelSearchParams,
  HotelSearchResult,
} from "@/lib/hotelProviders/types";
import { HotelProviderAdapterError } from "@/lib/hotelProviders/types";
import { formatDateParam } from "@/lib/hotelSearchParams";

/**
 * A fully offline, deterministic stand-in for a real hotel-affiliate
 * provider - lets hotel search, hotel details, availability/deals, and
 * deep-link generation all be built and tested end-to-end (Phases 5-7)
 * before Booking.com (or any other provider) is actually connected. Never
 * wired to production traffic: only ever selected by resolving a
 * HotelProvider row whose code is "mock", which a real deployment simply
 * never seeds as ACTIVE (see this file's own bottom comment).
 *
 * Deliberately stateless and pure - every method derives its result only
 * from its own arguments (a seeded PRNG keyed off the destination/index
 * encoded in externalId), never from any stored or mutable state. That
 * means calling getHotelDetails/getAvailability with an externalId this
 * adapter itself produced from searchHotels always regenerates the exact
 * same hotel, with no database or cache involved - ideal for both unit
 * tests and manually exercising the UI in dev.
 */

const MOCK_RESULT_COUNT = 6;
const NAME_PREFIXES = ["The Grand", "Seafront", "Harbourview", "The Royal", "Clifftop", "The Promenade"];
const NAME_SUFFIXES = ["Hotel", "Lodge", "Inn", "Suites", "House"];
const FACILITIES = [
  "Free WiFi",
  "Sea view",
  "Breakfast included",
  "Parking",
  "Swimming pool",
  "Pet friendly",
  "24-hour front desk",
  "Air conditioning",
];
const ROOM_NAMES = ["Standard Double", "Deluxe Room", "Family Suite", "Twin Room"];

/** Deterministic 32-bit hash of a string, seeding the PRNG below - same input always produces the same seed. */
function hashSeed(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** mulberry32 - a small, well-known deterministic PRNG. Not cryptographic; this is test fixture data, not a secret. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function slugifyDestination(destination: string): string {
  return destination
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "destination";
}

function encodeExternalId(destinationSlug: string, index: number): string {
  return `mock:${destinationSlug}:${index}`;
}

function decodeExternalId(externalId: string): { destinationSlug: string; index: number } {
  const parts = externalId.split(":");
  if (parts.length !== 3 || parts[0] !== "mock") {
    throw new HotelProviderAdapterError(`Not a mock-provider externalId: "${externalId}"`, {
      retryable: false,
    });
  }
  const index = Number(parts[2]);
  if (!Number.isInteger(index)) {
    throw new HotelProviderAdapterError(`Malformed mock-provider externalId: "${externalId}"`, {
      retryable: false,
    });
  }
  return { destinationSlug: parts[1], index };
}

function nightsBetween(checkIn: Date, checkOut: Date): number {
  const ms = checkOut.getTime() - checkIn.getTime();
  return Math.max(1, Math.round(ms / (1000 * 60 * 60 * 24)));
}

function buildHotel(destinationSlug: string, index: number): HotelSearchResult & HotelDetails {
  const rand = mulberry32(hashSeed(`${destinationSlug}:${index}`));
  const displayName = destinationSlug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const prefix = NAME_PREFIXES[index % NAME_PREFIXES.length];
  const suffix = NAME_SUFFIXES[(index + 1) % NAME_SUFFIXES.length];
  const name = `${prefix} ${suffix}, ${displayName}`;

  const starRating = 3 + Math.floor(rand() * 3); // 3-5
  const guestRating = Math.round((7 + rand() * 2.5) * 10) / 10; // 7.0-9.5
  const reviewCount = 40 + Math.floor(rand() * 900);
  const basePriceCents = 6500 + Math.floor(rand() * 12000); // £65-£185/night

  const facilityCount = 3 + Math.floor(rand() * 3);
  const facilities = [...FACILITIES].sort(() => rand() - 0.5).slice(0, facilityCount);

  return {
    externalId: encodeExternalId(destinationSlug, index),
    name,
    description:
      `A ${starRating}-star ${suffix.toLowerCase()} in ${displayName}, popular with guests for its ` +
      `${facilities[0]?.toLowerCase() ?? "location"}. (Mock provider test data - not a real property.)`,
    city: displayName,
    country: "United Kingdom",
    latitude: null,
    longitude: null,
    starRating,
    guestRating,
    reviewCount,
    primaryPhotoUrl: `https://picsum.photos/seed/${destinationSlug}-${index}/640/427`,
    photos: [0, 1, 2].map((n) => `https://picsum.photos/seed/${destinationSlug}-${index}-${n}/1024/683`),
    facilities,
    currency: "GBP",
    priceCents: basePriceCents,
  };
}

export const mockHotelProviderAdapter: HotelProviderAdapter = {
  code: "mock",
  name: "Mock provider (dev/test only)",

  supportsSearch: true,
  supportsDeepLink: true,
  supportsClickTracking: true,
  // False, honestly: there is no real provider on the other end to report
  // a booking back - a mock "conversion" would be indistinguishable from a
  // fabricated one, which is exactly what AffiliateConversion's own schema
  // comment says never to do.
  supportsConversionTracking: false,

  async searchHotels(params: HotelSearchParams): Promise<HotelSearchResult[]> {
    const slug = slugifyDestination(params.destination);
    return Array.from({ length: MOCK_RESULT_COUNT }, (_, i) => {
      const hotel = buildHotel(slug, i);
      return {
        externalId: hotel.externalId,
        name: hotel.name,
        city: hotel.city,
        country: hotel.country,
        latitude: hotel.latitude,
        longitude: hotel.longitude,
        starRating: hotel.starRating,
        guestRating: hotel.guestRating,
        reviewCount: hotel.reviewCount,
        primaryPhotoUrl: hotel.primaryPhotoUrl,
        facilities: hotel.facilities,
        currency: hotel.currency,
        priceCents: hotel.priceCents,
      };
    });
  },

  async getHotelDetails(externalId: string): Promise<HotelDetails> {
    const { destinationSlug, index } = decodeExternalId(externalId);
    const hotel = buildHotel(destinationSlug, index);
    return {
      externalId: hotel.externalId,
      name: hotel.name,
      description: hotel.description,
      city: hotel.city,
      country: hotel.country,
      latitude: hotel.latitude,
      longitude: hotel.longitude,
      starRating: hotel.starRating,
      guestRating: hotel.guestRating,
      reviewCount: hotel.reviewCount,
      photos: hotel.photos,
      facilities: hotel.facilities,
    };
  },

  async getAvailability(externalId: string, params: AvailabilityParams): Promise<HotelDeal[]> {
    const { destinationSlug, index } = decodeExternalId(externalId);
    const hotel = buildHotel(destinationSlug, index);
    const nights = nightsBetween(params.checkIn, params.checkOut);
    const rand = mulberry32(hashSeed(`${externalId}:${params.checkIn.toISOString()}:${params.checkOut.toISOString()}`));

    // A destination-and-date combination that deliberately comes back sold
    // out, so the "no deals available" state (Phase 5) has something real
    // to render against without needing a special test flag.
    if (rand() < 0.05) return [];

    const dealCount = params.rooms > 2 ? 1 : 1 + Math.floor(rand() * 2);
    return Array.from({ length: dealCount }, (_, i) => {
      const roomName = ROOM_NAMES[(index + i) % ROOM_NAMES.length];
      const perNight = Math.round(hotel.priceCents * (1 + i * 0.35) * (1 + rand() * 0.15));
      return {
        externalRoomId: `${externalId}:room:${i}`,
        name: roomName,
        description: `${roomName} for ${params.adults + params.children} guest${params.adults + params.children === 1 ? "" : "s"}, ${nights} night${nights === 1 ? "" : "s"}.`,
        maxGuests: 2 + i,
        currency: hotel.currency,
        priceCents: perNight * nights,
        refundable: rand() > 0.5,
      };
    });
  },

  createDeepLink(params: CreateDeepLinkParams): string {
    // ".invalid" is an IANA-reserved TLD guaranteed to never resolve (the
    // same convention this codebase's own safeRedirect.test.ts already
    // uses for a safe non-navigable test origin) - if this URL is ever hit
    // outside a test, that failure is loud and obvious rather than
    // quietly looking like a real destination.
    const url = new URL(`https://mock-hotel-provider.invalid/deeplink/${encodeURIComponent(params.externalId)}`);
    // The stay dates are local-midnight Dates (hotelSearchParams.ts), so
    // they're written from their local parts: toISOString() would give the
    // day before on a server running on UK summer time.
    url.searchParams.set("checkin", formatDateParam(params.checkIn));
    url.searchParams.set("checkout", formatDateParam(params.checkOut));
    url.searchParams.set("adults", String(params.adults));
    url.searchParams.set("children", String(params.children));
    url.searchParams.set("rooms", String(params.rooms));
    url.searchParams.set("subid", params.subId);
    return url.toString();
  },
};
