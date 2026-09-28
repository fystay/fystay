import { createHash } from "node:crypto";
import { after } from "next/server";
import { prisma } from "@/lib/prisma";
import type { CacheTtlConfig } from "@/lib/hotelProviders/config";
import type {
  AvailabilityParams,
  HotelDeal,
  HotelProviderAdapter,
  HotelSearchParams,
  HotelSearchResult,
} from "@/lib/hotelProviders/types";

export type { CacheTtlConfig } from "@/lib/hotelProviders/config";

/**
 * A small, provider-agnostic, DB-backed cache in front of the two provider
 * calls actually worth caching: searchHotels and getAvailability (never
 * getHotelDetails - see search.ts's own top comment on why the hotel detail
 * page always re-fetches live, and never createDeepLink, a synchronous pure
 * function with nothing to cache).
 *
 * Backed by Postgres (HotelProviderCacheEntry), not an in-memory Map, for
 * exactly the reason rateLimit.ts's own top comment already documents for
 * this codebase: FYStay runs as short-lived Vercel serverless functions,
 * each with its own process memory, so an in-process cache would reset on
 * every cold start and wouldn't agree across concurrent instances.
 *
 * Cache keys are built only from HotelSearchParams/AvailabilityParams -
 * neither type has (or should ever have) a userId, sessionId, or subId
 * field, so there is structurally nothing user- or attribution-specific for
 * this cache to leak between guests.
 *
 * TTLs (config.ts): search 5 min, availability 60s by default. Availability
 * is deliberately short because price/inventory is time-sensitive.
 */

/** Chance that a cache write also schedules a cleanup pass - same approach as RateLimitHit's pruning. */
const PRUNE_PROBABILITY = 0.05;
/** Hard upper bound on rows deleted by one cleanup pass. */
export const PRUNE_BATCH_LIMIT = 200;

function hashParts(parts: unknown[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 40);
}

/** Deterministic, provider-scoped key covering every input that materially affects a search result. */
export function searchCacheKey(providerCode: string, params: HotelSearchParams): string {
  return `search:${providerCode}:${hashParts([
    params.destination.trim().toLowerCase(),
    params.destinationLat ?? null,
    params.destinationLng ?? null,
    params.checkIn.toISOString(),
    params.checkOut.toISOString(),
    params.adults,
    params.children,
    params.rooms,
  ])}`;
}

/** Deterministic, provider-and-hotel-scoped key covering every input that materially affects an availability result. */
export function availabilityCacheKey(providerCode: string, externalId: string, params: AvailabilityParams): string {
  return `availability:${providerCode}:${externalId}:${hashParts([
    params.checkIn.toISOString(),
    params.checkOut.toISOString(),
    params.adults,
    params.children,
    params.rooms,
  ])}`;
}

/**
 * Reads a cache entry, treating any read failure or an expired row exactly
 * like a cache miss - a cache outage degrades to calling the provider.
 */
async function getCached<T>(cacheKey: string, now: Date): Promise<T | null> {
  try {
    const row = await prisma.hotelProviderCacheEntry.findUnique({ where: { cacheKey } });
    if (!row || row.expiresAt <= now) return null;
    return row.payload as T;
  } catch (err) {
    console.error(err);
    return null;
  }
}

/**
 * Deletes at most `limit` expired entries. Two small indexed queries, never
 * an unbounded DELETE. The delete re-checks `expiresAt <= now`, so a row
 * that was refreshed (upserted with a new expiry) between the two queries
 * is left alone - an entry that is still valid is never deleted. Returns
 * how many rows were removed.
 */
export async function pruneExpiredHotelProviderCache(
  now: Date = new Date(),
  limit: number = PRUNE_BATCH_LIMIT,
): Promise<number> {
  const expired = await prisma.hotelProviderCacheEntry.findMany({
    where: { expiresAt: { lte: now } },
    select: { id: true },
    orderBy: { expiresAt: "asc" },
    take: limit,
  });
  if (expired.length === 0) return 0;
  const result = await prisma.hotelProviderCacheEntry.deleteMany({
    where: { id: { in: expired.map((row) => row.id) }, expiresAt: { lte: now } },
  });
  return result.count;
}

/**
 * On ~5% of cache writes (each write is a cache miss, so it adds at most one
 * row), schedules one bounded cleanup pass via Next's after(), which runs
 * once the response has been sent - the guest never waits on it. Each pass
 * removes up to PRUNE_BATCH_LIMIT rows, so expected cleanup capacity (~10
 * rows per miss) far exceeds growth (1 row per miss) and expired rows can't
 * accumulate. Outside a request scope (scripts, tests) after() throws and
 * the pass is simply skipped; any cleanup failure is logged, never thrown.
 */
function maybeSchedulePrune(): void {
  if (Math.random() >= PRUNE_PROBABILITY) return;
  try {
    after(async () => {
      try {
        await pruneExpiredHotelProviderCache();
      } catch (err) {
        console.error(err);
      }
    });
  } catch {
    // Not inside a request - nothing to schedule against.
  }
}

/**
 * Writes a cache entry. Only ever called after a provider call has already
 * succeeded, so a failed provider call can never be cached as if it were a
 * successful one. A write failure is logged and swallowed.
 */
async function setCached(cacheKey: string, providerCode: string, payload: unknown, ttlMs: number, now: Date): Promise<void> {
  try {
    const expiresAt = new Date(now.getTime() + ttlMs);
    await prisma.hotelProviderCacheEntry.upsert({
      where: { cacheKey },
      create: { cacheKey, providerCode, payload: payload as never, expiresAt },
      update: { payload: payload as never, expiresAt },
    });
  } catch (err) {
    console.error(err);
    return;
  }
  maybeSchedulePrune();
}

/**
 * Wraps searchHotels and getAvailability with the cache above; leaves
 * getHotelDetails and createDeepLink untouched. Wired in once, in
 * registry.ts, outside withResilientAdapter - a cache hit skips the
 * timeout/retry machinery entirely, since there's no provider call.
 */
export function withCachedAdapter(adapter: HotelProviderAdapter, ttl: CacheTtlConfig): HotelProviderAdapter {
  return {
    ...adapter,
    async searchHotels(params: HotelSearchParams, signal?: AbortSignal): Promise<HotelSearchResult[]> {
      const now = new Date();
      const key = searchCacheKey(adapter.code, params);
      const cached = await getCached<HotelSearchResult[]>(key, now);
      if (cached) return cached;
      const results = await adapter.searchHotels(params, signal);
      await setCached(key, adapter.code, results, ttl.searchTtlMs, now);
      return results;
    },
    async getAvailability(externalId: string, params: AvailabilityParams, signal?: AbortSignal): Promise<HotelDeal[]> {
      const now = new Date();
      const key = availabilityCacheKey(adapter.code, externalId, params);
      const cached = await getCached<HotelDeal[]>(key, now);
      if (cached) return cached;
      const deals = await adapter.getAvailability(externalId, params, signal);
      await setCached(key, adapter.code, deals, ttl.availabilityTtlMs, now);
      return deals;
    },
  };
}
