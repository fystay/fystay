import { z } from "zod";
import { logHotelProviderEvent } from "@/lib/hotelProviders/providerLog";
import {
  HotelProviderInvalidResponseError,
  type HotelDeal,
  type HotelDetails,
  type HotelProviderAdapter,
  type HotelSearchResult,
  type ProviderResponseIssue,
} from "@/lib/hotelProviders/types";

/**
 * The provider response validation boundary. Every adapter's output is
 * checked here against FYStay's own domain contract (types.ts) before
 * anything else touches it - before the resilience layer returns it, before
 * cache.ts stores it, and before search.ts writes it into AffiliateHotel.
 *
 * It validates the *mapped* domain types, not any provider's raw wire
 * format, so it is provider-agnostic: a future adapter's only job is mapping
 * its provider's response into HotelSearchResult / HotelDetails / HotelDeal,
 * and it gets this boundary for free. (An adapter may additionally validate
 * its own raw payload internally - that part is provider-specific.)
 *
 * Wired in once, innermost, in registry.ts:
 *   withCachedAdapter(withResilientAdapter(withValidatedAdapter(adapter)))
 * so a rejection is an ordinary non-retryable HotelProviderAdapterError to
 * the resilience layer (retrying a malformed payload won't fix it) and to
 * every caller (the guest sees the generic "unavailable" message).
 *
 * Policy:
 *   - Search results and deals are checked per item. An invalid item (or,
 *     for search, a repeat of an earlier externalId) is dropped and the drop
 *     is logged. The whole response is rejected only when it isn't an array,
 *     exceeds its size limit, or had items but none survived - so "no rooms"
 *     (an empty list) stays distinguishable from "provider unavailable".
 *   - Hotel details are all-or-nothing, and must be for the hotel asked for.
 *   - Unknown keys are stripped, so extra provider fields never reach the
 *     cache or the database.
 *   - Issues record paths and zod issue codes only, never received values.
 */

export const MAX_SEARCH_RESULTS = 200;
export const MAX_DEALS = 100;
/** Postgres int4 - AffiliateHotel.lastKnownPriceCents and reviewCount are Int columns. */
const MAX_INT4 = 2_147_483_647;
const MAX_ISSUES = 10;

const NO_CONTROL_CHARS = /^[^\u0000-\u001f\u007f]*$/;
const NOT_BLANK = /\S/;

function text(max: number) {
  return z.string().min(1).max(max).regex(NOT_BLANK);
}

const externalIdSchema = z.string().min(1).max(256).regex(NO_CONTROL_CHARS).regex(NOT_BLANK);

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

const httpsUrlSchema = z.string().max(2048).refine(isHttpsUrl);
const facilitiesSchema = z.array(text(100)).max(100);
const currencySchema = z.string().regex(/^[A-Z]{3}$/);
const priceCentsSchema = z.number().int().min(1).max(MAX_INT4);

const locationAndRatings = {
  latitude: z.number().min(-90).max(90).nullish(),
  longitude: z.number().min(-180).max(180).nullish(),
  starRating: z.number().min(0).max(5).nullish(),
  guestRating: z.number().min(0).max(10).nullish(),
  reviewCount: z.number().int().min(0).max(MAX_INT4).nullish(),
};

const searchResultSchema = z.object({
  externalId: externalIdSchema,
  name: text(300),
  city: text(200),
  country: text(200),
  ...locationAndRatings,
  primaryPhotoUrl: httpsUrlSchema.nullish(),
  facilities: facilitiesSchema,
  currency: currencySchema,
  priceCents: priceCentsSchema,
});

const hotelDetailsSchema = z.object({
  externalId: externalIdSchema,
  name: text(300),
  description: z.string().max(10_000).nullish(),
  city: text(200),
  country: text(200),
  ...locationAndRatings,
  photos: z.array(httpsUrlSchema).max(100),
  facilities: facilitiesSchema,
});

const dealSchema = z.object({
  externalRoomId: externalIdSchema.nullish(),
  name: text(300),
  description: z.string().max(10_000).nullish(),
  maxGuests: z.number().int().min(1).max(100).nullish(),
  currency: currencySchema,
  priceCents: priceCentsSchema,
  refundable: z.boolean().nullish(),
});

function formatPath(prefix: (string | number)[], path: readonly PropertyKey[]): string {
  return [...prefix, ...path]
    .map((segment, i) => (typeof segment === "number" ? `[${segment}]` : `${i === 0 ? "" : "."}${String(segment)}`))
    .join("");
}

function issuesFrom(error: z.ZodError, prefix: (string | number)[] = []): ProviderResponseIssue[] {
  return error.issues.map((issue) => ({ path: formatPath(prefix, issue.path), code: issue.code }));
}

type ItemOperation = "search" | "availability";

function validateItems<T>(
  operation: ItemOperation,
  providerCode: string,
  input: unknown,
  schema: z.ZodType<T>,
  maxItems: number,
  keyOf?: (item: T) => string,
): T[] {
  if (!Array.isArray(input)) {
    throw new HotelProviderInvalidResponseError(operation, [{ path: "", code: "invalid_type" }]);
  }
  if (input.length > maxItems) {
    throw new HotelProviderInvalidResponseError(operation, [{ path: "", code: "too_big" }]);
  }

  const kept: T[] = [];
  const seenKeys = new Set<string>();
  const issues: ProviderResponseIssue[] = [];
  const addIssues = (more: ProviderResponseIssue[]) => {
    for (const issue of more) if (issues.length < MAX_ISSUES) issues.push(issue);
  };

  input.forEach((raw, index) => {
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      addIssues(issuesFrom(parsed.error, [index]));
      return;
    }
    if (keyOf) {
      const key = keyOf(parsed.data);
      if (seenKeys.has(key)) {
        addIssues([{ path: `[${index}].externalId`, code: "duplicate" }]);
        return;
      }
      seenKeys.add(key);
    }
    kept.push(parsed.data);
  });

  if (input.length > 0 && kept.length === 0) {
    throw new HotelProviderInvalidResponseError(operation, issues);
  }
  const dropped = input.length - kept.length;
  if (dropped > 0) {
    logHotelProviderEvent("warn", "hotel_provider.response_items_dropped", {
      operation,
      providerCode,
      received: input.length,
      kept: kept.length,
      dropped,
      issues,
    });
  }
  return kept;
}

export function validateSearchResults(input: unknown, providerCode: string): HotelSearchResult[] {
  return validateItems("search", providerCode, input, searchResultSchema, MAX_SEARCH_RESULTS, (r) => r.externalId);
}

export function validateDeals(input: unknown, providerCode: string): HotelDeal[] {
  return validateItems("availability", providerCode, input, dealSchema, MAX_DEALS);
}

export function validateHotelDetails(input: unknown, requestedExternalId: string): HotelDetails {
  const parsed = hotelDetailsSchema.safeParse(input);
  if (!parsed.success) {
    throw new HotelProviderInvalidResponseError("details", issuesFrom(parsed.error).slice(0, MAX_ISSUES));
  }
  if (parsed.data.externalId !== requestedExternalId) {
    throw new HotelProviderInvalidResponseError("details", [{ path: "externalId", code: "mismatch" }]);
  }
  return parsed.data;
}

/**
 * Wraps the three network-facing methods with the checks above; leaves
 * `code`, `name`, the capability flags and createDeepLink (whose output the
 * redirect route already checks against the provider's host allowlist)
 * untouched. Called only from registry.ts.
 */
export function withValidatedAdapter(adapter: HotelProviderAdapter): HotelProviderAdapter {
  return {
    ...adapter,
    searchHotels: async (params, signal) =>
      validateSearchResults(await adapter.searchHotels(params, signal), adapter.code),
    getHotelDetails: async (externalId, signal) =>
      validateHotelDetails(await adapter.getHotelDetails(externalId, signal), externalId),
    getAvailability: async (externalId, params, signal) =>
      validateDeals(await adapter.getAvailability(externalId, params, signal), adapter.code),
  };
}
