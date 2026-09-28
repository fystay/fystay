/**
 * The provider-agnostic contract every hotel affiliate integration
 * implements (see src/lib/hotelProviders/providers/*.ts) - the search
 * route, hotel detail page, and click/deep-link route (once built in
 * Phases 5-7) only ever call through this interface via the registry
 * (src/lib/hotelProviders/registry.ts), never a specific provider's SDK or
 * endpoint shapes directly. Adding Expedia or HBX/Hotelbeds later is one
 * new file implementing HotelProviderAdapter plus one line in the
 * registry - never a change to the frontend, the database schema, or any
 * other provider's file.
 *
 * Same PmsAdapter precedent as src/lib/pms/types.ts, but for a
 * fundamentally different direction: PMS pulls a host's own inventory
 * into FYStay. This searches a third party's inventory that FYStay never
 * stores as its own and never takes payment for - every method here is
 * read-only against the provider, plus one pure string-building method
 * (createDeepLink) that never calls out anywhere.
 *
 * Deliberately no trackClick() method: recording a click is FYStay's own
 * database write (an AffiliateClick row), not something any provider's
 * API does on FYStay's behalf. Putting it on this interface would model a
 * capability providers don't actually expose.
 */
export interface HotelProviderAdapter {
  /** Matches HotelProvider.code in the database (e.g. "booking_com") - what the registry looks this adapter up by. */
  readonly code: string;
  readonly name: string;

  readonly supportsSearch: boolean;
  readonly supportsDeepLink: boolean;
  /** Whether createDeepLink can embed FYStay's own subId in the URL at all - some affiliate programs only support a single, account-wide tracking id, not a per-click one. */
  readonly supportsClickTracking: boolean;
  /** Whether this provider is known to report bookings/commission back (a postback URL, a reporting API) - see AffiliateConversion's own schema comment on why this stays false until that access is actually confirmed. */
  readonly supportsConversionTracking: boolean;

  /*
   * The optional `signal` on the three network-facing methods is aborted by
   * resilience.ts when an attempt times out or the overall call budget runs
   * out. An adapter that makes network calls should pass it to fetch() so
   * the underlying request is actually cancelled; one that does no I/O
   * (mock) can ignore it.
   */
  searchHotels(params: HotelSearchParams, signal?: AbortSignal): Promise<HotelSearchResult[]>;

  getHotelDetails(externalId: string, signal?: AbortSignal): Promise<HotelDetails>;

  /**
   * Re-checks live deals/rooms for one hotel against exact dates - always
   * called before a guest is shown a price to commit to (Phase 6's hotel
   * detail page), never trusted from a stale search result alone. Returns
   * an empty array, not an error, when the provider has nothing available
   * for these dates - "no rooms" and "provider unavailable" are different
   * outcomes the caller needs to tell apart (see HotelProviderAdapterError
   * for the latter).
   */
  getAvailability(externalId: string, params: AvailabilityParams, signal?: AbortSignal): Promise<HotelDeal[]>;

  /**
   * Builds the exact outbound URL for one click - pure string
   * construction from data this app already holds (externalId, search
   * params, FYStay's own subId), never a network call. Server-side only:
   * see this app's click route (Phase 7) for why the caller, not this
   * method, is what closes off the open-redirect risk.
   */
  createDeepLink(params: CreateDeepLinkParams): string;
}

export type HotelSearchParams = {
  destination: string;
  destinationLat?: number | null;
  destinationLng?: number | null;
  checkIn: Date;
  checkOut: Date;
  adults: number;
  children: number;
  rooms: number;
};

export type AvailabilityParams = {
  checkIn: Date;
  checkOut: Date;
  adults: number;
  children: number;
  rooms: number;
};

/**
 * One row of a search result. priceCents/currency here are the price the
 * provider quoted for these exact search dates at search time - always a
 * "last known" figure by the time it reaches a guest (network latency,
 * caching, a provider's own price changing), never presented as
 * guaranteed until getAvailability re-confirms it. Mirrors, but is
 * intentionally not the same type as, AffiliateHotel (the cached DB row) -
 * this is what a provider handed back just now; AffiliateHotel is what
 * FYStay chose to persist from it.
 */
export type HotelSearchResult = {
  externalId: string;
  name: string;
  city: string;
  country: string;
  latitude?: number | null;
  longitude?: number | null;
  starRating?: number | null;
  guestRating?: number | null;
  reviewCount?: number | null;
  primaryPhotoUrl?: string | null;
  /** A few headline amenities, for the search-result card's own facility tags - the full list lives on HotelDetails, fetched only once a guest opens the hotel's own page. */
  facilities: string[];
  currency: string;
  priceCents: number;
};

export type HotelDetails = {
  externalId: string;
  name: string;
  description?: string | null;
  city: string;
  country: string;
  latitude?: number | null;
  longitude?: number | null;
  starRating?: number | null;
  guestRating?: number | null;
  reviewCount?: number | null;
  photos: string[];
  facilities: string[];
};

export type HotelDeal = {
  externalRoomId?: string | null;
  name: string;
  description?: string | null;
  maxGuests?: number | null;
  currency: string;
  priceCents: number;
  refundable?: boolean | null;
};

export type CreateDeepLinkParams = {
  externalId: string;
  checkIn: Date;
  checkOut: Date;
  adults: number;
  children: number;
  rooms: number;
  /** FYStay's own tracking sub-id (AffiliateClick.subId), generated by the caller before this is called - see this file's own top comment. */
  subId: string;
};

/**
 * Thrown by an adapter for a real call failure - distinguishes a
 * transient/retryable problem (a timeout, a provider 5xx) from one that
 * won't resolve on retry (bad/missing credentials, a provider rejecting
 * the request outright), the same split as PmsAdapterError. Every stub
 * method on an unimplemented provider (see providers/notConfigured.ts)
 * throws this with retryable: false.
 */
export class HotelProviderAdapterError extends Error {
  readonly retryable: boolean;
  readonly statusCode?: number;

  constructor(message: string, options: { retryable: boolean; statusCode?: number; cause?: unknown }) {
    super(message, { cause: options.cause });
    this.name = "HotelProviderAdapterError";
    this.retryable = options.retryable;
    this.statusCode = options.statusCode;
  }
}

/**
 * Thrown by src/lib/hotelProviders/resilience.ts when an adapter call
 * doesn't resolve within its configured timeout - a subclass of
 * HotelProviderAdapterError (not a separate error type) specifically so
 * every existing `catch` site written against that base class (search.ts,
 * getHotelForBooking, getHotelAvailability) keeps working unchanged: a
 * timeout is still, correctly, an "unavailable" outcome to them. It exists
 * as its own class only so a test (or future caller) that specifically
 * needs to tell "the provider timed out" apart from "the provider answered
 * with an error" can do so with `instanceof HotelProviderTimeoutError`.
 * Always retryable: a timeout is transient by definition, never a
 * configuration/validation problem.
 */
export class HotelProviderTimeoutError extends HotelProviderAdapterError {
  constructor(timeoutMs: number) {
    super(`Provider call timed out after ${timeoutMs}ms`, { retryable: true });
    this.name = "HotelProviderTimeoutError";
  }
}

/** Where and what kind of validation failure - never the offending value itself. */
export type ProviderResponseIssue = { path: string; code: string };

/**
 * Thrown by src/lib/hotelProviders/validation.ts when an adapter hands back
 * data that breaks this file's contract (wrong shape, out-of-range values,
 * too many items, every item invalid, or details for a different hotel).
 * Non-retryable - a malformed payload is deterministic, retrying won't fix
 * it - and a HotelProviderAdapterError, so every existing caller already
 * maps it to its generic guest-facing "unavailable" message. The message is
 * fixed; `issues` carries only paths and zod issue codes, never the values
 * the provider sent, so it is safe to log.
 */
export class HotelProviderInvalidResponseError extends HotelProviderAdapterError {
  readonly operation: "search" | "details" | "availability";
  readonly issues: readonly ProviderResponseIssue[];

  constructor(operation: "search" | "details" | "availability", issues: readonly ProviderResponseIssue[]) {
    super(`Provider returned a malformed ${operation} response`, { retryable: false });
    this.name = "HotelProviderInvalidResponseError";
    this.operation = operation;
    this.issues = issues;
  }
}

export type ProviderNotOperationalReason =
  | "not_registered"
  | "not_active"
  | "fixture_in_production"
  | "not_live_listed"
  | "invalid_configuration";

/**
 * Thrown by every method of the locked adapter registry.ts returns for a
 * provider that fails the activation rule (see evaluateProviderActivation).
 * Non-retryable, and a HotelProviderAdapterError so every existing caller
 * already maps it to its generic guest-facing "unavailable" message. The
 * message names only the provider code and reason; any underlying detail
 * (e.g. an invalid env var) travels in `cause` for server-side logs only.
 */
export class HotelProviderNotOperationalError extends HotelProviderAdapterError {
  readonly providerCode: string;
  readonly reason: ProviderNotOperationalReason;

  constructor(providerCode: string, reason: ProviderNotOperationalReason, cause?: unknown) {
    super(`Hotel provider "${providerCode}" is not operational (${reason})`, { retryable: false, cause });
    this.name = "HotelProviderNotOperationalError";
    this.providerCode = providerCode;
    this.reason = reason;
  }
}
