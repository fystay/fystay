import { beforeEach, describe, expect, it, vi } from "vitest";

const mockFindUnique = vi.fn();
const mockUpsert = vi.fn();
const mockFindMany = vi.fn();
const mockDeleteMany = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    hotelProviderCacheEntry: {
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
      upsert: (...args: unknown[]) => mockUpsert(...args),
      findMany: (...args: unknown[]) => mockFindMany(...args),
      deleteMany: (...args: unknown[]) => mockDeleteMany(...args),
    },
  },
}));

const scheduled: Array<() => Promise<void>> = [];
const mockAfter = vi.fn((cb: () => Promise<void>) => {
  scheduled.push(cb);
});
vi.mock("next/server", () => ({ after: (cb: () => Promise<void>) => mockAfter(cb) }));

const { withCachedAdapter, searchCacheKey, availabilityCacheKey, pruneExpiredHotelProviderCache, PRUNE_BATCH_LIMIT } =
  await import("./cache");
const { createFixtureAdapter } = await import("./testFixtures");

const searchParams = {
  destination: "Blackpool",
  checkIn: new Date("2026-11-10"),
  checkOut: new Date("2026-11-12"),
  adults: 2,
  children: 0,
  rooms: 1,
};

const availabilityParams = {
  checkIn: new Date("2026-11-10"),
  checkOut: new Date("2026-11-12"),
  adults: 2,
  children: 0,
  rooms: 1,
};

const TTL = { searchTtlMs: 60_000, availabilityTtlMs: 30_000 };

beforeEach(() => {
  mockFindUnique.mockReset().mockResolvedValue(null);
  mockUpsert.mockReset().mockResolvedValue({});
  mockFindMany.mockReset().mockResolvedValue([]);
  mockDeleteMany.mockReset().mockResolvedValue({ count: 0 });
  mockAfter.mockClear();
  scheduled.length = 0;
  vi.restoreAllMocks();
});

describe("cache key builders", () => {
  it("produces the same key for identical inputs", () => {
    expect(searchCacheKey("mock", searchParams)).toBe(searchCacheKey("mock", { ...searchParams }));
    expect(availabilityCacheKey("mock", "ext-1", availabilityParams)).toBe(
      availabilityCacheKey("mock", "ext-1", { ...availabilityParams }),
    );
  });

  it("changes when the provider differs - keys are provider-aware", () => {
    expect(searchCacheKey("mock", searchParams)).not.toBe(searchCacheKey("fixture", searchParams));
  });

  it("changes when destination, dates, or guest counts differ", () => {
    const base = searchCacheKey("mock", searchParams);
    expect(searchCacheKey("mock", { ...searchParams, destination: "Lytham" })).not.toBe(base);
    expect(searchCacheKey("mock", { ...searchParams, checkIn: new Date("2026-11-11") })).not.toBe(base);
    expect(searchCacheKey("mock", { ...searchParams, adults: 3 })).not.toBe(base);
    expect(searchCacheKey("mock", { ...searchParams, rooms: 2 })).not.toBe(base);
  });

  it("changes when the externalId differs, for availability", () => {
    expect(availabilityCacheKey("mock", "ext-1", availabilityParams)).not.toBe(
      availabilityCacheKey("mock", "ext-2", availabilityParams),
    );
  });

  it("has no notion of a user, session, or subId at all - two different 'guests' with the same search always produce the identical key", () => {
    // There is no such parameter to pass - this test documents that
    // guarantee structurally: searchCacheKey/availabilityCacheKey take only
    // provider code + provider-facing params, so nothing user-specific can
    // ever be threaded through, let alone leak into another guest's result.
    expect(searchCacheKey.length).toBe(2);
    expect(availabilityCacheKey.length).toBe(3);
  });
});

describe("withCachedAdapter: searchHotels", () => {
  it("calls the underlying adapter once and serves the second identical request from cache", async () => {
    const searchHotels = vi.fn().mockResolvedValue([{ externalId: "e1", name: "Hotel", city: "Blackpool", country: "UK", facilities: [], currency: "GBP", priceCents: 100 }]);
    const adapter = createFixtureAdapter({ searchHotels });
    const wrapped = withCachedAdapter(adapter, TTL);

    let storedPayload: unknown;
    mockUpsert.mockImplementation(async ({ create }) => {
      storedPayload = create.payload;
      return {};
    });

    const first = await wrapped.searchHotels(searchParams);
    expect(searchHotels).toHaveBeenCalledTimes(1);

    // Simulate the cache now holding what was just written.
    mockFindUnique.mockResolvedValue({ payload: storedPayload, expiresAt: new Date(Date.now() + 60_000) });

    const second = await wrapped.searchHotels(searchParams);
    expect(searchHotels).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
  });

  it("calls the adapter again for a materially different request (different destination)", async () => {
    const searchHotels = vi.fn().mockResolvedValue([]);
    const wrapped = withCachedAdapter(createFixtureAdapter({ searchHotels }), TTL);

    await wrapped.searchHotels(searchParams);
    await wrapped.searchHotels({ ...searchParams, destination: "Lytham" });

    expect(searchHotels).toHaveBeenCalledTimes(2);
  });

  it("refreshes from the provider once a cached entry has expired", async () => {
    const searchHotels = vi.fn().mockResolvedValue([]);
    const wrapped = withCachedAdapter(createFixtureAdapter({ searchHotels }), TTL);

    mockFindUnique.mockResolvedValue({ payload: [], expiresAt: new Date(Date.now() - 1000) });
    await wrapped.searchHotels(searchParams);

    expect(searchHotels).toHaveBeenCalledTimes(1);
  });

  it("never caches a failed provider call as a successful response", async () => {
    const searchHotels = vi.fn().mockRejectedValue(new Error("provider down"));
    const wrapped = withCachedAdapter(createFixtureAdapter({ searchHotels }), TTL);

    await expect(wrapped.searchHotels(searchParams)).rejects.toThrow("provider down");
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("falls through to the provider (does not throw) when the cache read itself fails", async () => {
    mockFindUnique.mockRejectedValue(new Error("db unreachable"));
    const searchHotels = vi.fn().mockResolvedValue([]);
    const wrapped = withCachedAdapter(createFixtureAdapter({ searchHotels }), TTL);

    const result = await wrapped.searchHotels(searchParams);

    expect(result).toEqual([]);
    expect(searchHotels).toHaveBeenCalledTimes(1);
  });

  it("still returns the provider's result (does not throw) when the cache write fails", async () => {
    mockUpsert.mockRejectedValue(new Error("db unreachable"));
    const searchHotels = vi.fn().mockResolvedValue([{ externalId: "e1", name: "Hotel", city: "Blackpool", country: "UK", facilities: [], currency: "GBP", priceCents: 100 }]);
    const wrapped = withCachedAdapter(createFixtureAdapter({ searchHotels }), TTL);

    const result = await wrapped.searchHotels(searchParams);

    expect(result).toHaveLength(1);
  });
});

describe("withCachedAdapter: getAvailability", () => {
  it("caches identical availability requests and skips the provider on the second call", async () => {
    const getAvailability = vi.fn().mockResolvedValue([{ name: "Room", currency: "GBP", priceCents: 200 }]);
    const wrapped = withCachedAdapter(createFixtureAdapter({ getAvailability }), TTL);

    let storedPayload: unknown;
    mockUpsert.mockImplementation(async ({ create }) => {
      storedPayload = create.payload;
      return {};
    });

    await wrapped.getAvailability("ext-1", availabilityParams);
    mockFindUnique.mockResolvedValue({ payload: storedPayload, expiresAt: new Date(Date.now() + 30_000) });
    await wrapped.getAvailability("ext-1", availabilityParams);

    expect(getAvailability).toHaveBeenCalledTimes(1);
  });

  it("never caches a provider failure as a successful (e.g. empty/sold-out) response", async () => {
    const getAvailability = vi.fn().mockRejectedValue(new Error("provider down"));
    const wrapped = withCachedAdapter(createFixtureAdapter({ getAvailability }), TTL);

    await expect(wrapped.getAvailability("ext-1", availabilityParams)).rejects.toThrow("provider down");
    expect(mockUpsert).not.toHaveBeenCalled();
  });
});

describe("withCachedAdapter: leaves untouched", () => {
  it("does not wrap getHotelDetails - always calls straight through, per search.ts's own freshness guarantee", async () => {
    const getHotelDetails = vi.fn().mockResolvedValue({ externalId: "e1", name: "Hotel", city: "Blackpool", country: "UK", photos: [], facilities: [] });
    const wrapped = withCachedAdapter(createFixtureAdapter({ getHotelDetails }), TTL);

    await wrapped.getHotelDetails("e1");
    await wrapped.getHotelDetails("e1");

    expect(getHotelDetails).toHaveBeenCalledTimes(2);
    expect(mockFindUnique).not.toHaveBeenCalled();
  });

  it("does not touch createDeepLink", () => {
    const wrapped = withCachedAdapter(createFixtureAdapter(), TTL);
    const url = wrapped.createDeepLink({
      externalId: "e1",
      checkIn: searchParams.checkIn,
      checkOut: searchParams.checkOut,
      adults: 2,
      children: 0,
      rooms: 1,
      subId: "hc_test",
    });
    expect(url).toContain("fixture-provider.invalid");
  });
});

describe("withCachedAdapter: signal pass-through", () => {
  it("passes the caller's AbortSignal to the underlying adapter on a cache miss", async () => {
    const searchHotels = vi.fn().mockResolvedValue([]);
    const getAvailability = vi.fn().mockResolvedValue([]);
    const wrapped = withCachedAdapter(createFixtureAdapter({ searchHotels, getAvailability }), TTL);
    const { signal } = new AbortController();

    await wrapped.searchHotels(searchParams, signal);
    await wrapped.getAvailability("ext-1", availabilityParams, signal);

    expect(searchHotels).toHaveBeenCalledWith(searchParams, signal);
    expect(getAvailability).toHaveBeenCalledWith("ext-1", availabilityParams, signal);
  });
});

describe("pruneExpiredHotelProviderCache", () => {
  const now = new Date("2026-11-01T12:00:00Z");

  it("deletes only entries that are expired at `now`, re-checking expiry in the delete itself", async () => {
    mockFindMany.mockResolvedValue([{ id: "a" }, { id: "b" }]);
    mockDeleteMany.mockResolvedValue({ count: 2 });

    const removed = await pruneExpiredHotelProviderCache(now);

    expect(removed).toBe(2);
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { expiresAt: { lte: now } }, take: PRUNE_BATCH_LIMIT }),
    );
    // The expiry re-check means a row refreshed between the two queries
    // (new expiresAt > now) is never deleted - active entries are safe.
    expect(mockDeleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["a", "b"] }, expiresAt: { lte: now } },
    });
  });

  it("is bounded: never asks for more than the batch limit, and honours a smaller limit", async () => {
    await pruneExpiredHotelProviderCache(now, 5);
    expect(mockFindMany).toHaveBeenCalledWith(expect.objectContaining({ take: 5 }));
    expect(PRUNE_BATCH_LIMIT).toBeLessThanOrEqual(500);
  });

  it("does nothing (no delete at all) when nothing has expired", async () => {
    mockFindMany.mockResolvedValue([]);
    expect(await pruneExpiredHotelProviderCache(now)).toBe(0);
    expect(mockDeleteMany).not.toHaveBeenCalled();
  });
});

describe("withCachedAdapter: opportunistic cleanup trigger", () => {
  it("schedules cleanup via after() (post-response) on a cache write when the dice roll hits", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const wrapped = withCachedAdapter(createFixtureAdapter({ searchHotels: vi.fn().mockResolvedValue([]) }), TTL);

    await wrapped.searchHotels(searchParams);

    expect(mockAfter).toHaveBeenCalledTimes(1);
    // Nothing ran inline - the delete only happens when the scheduled callback runs.
    expect(mockFindMany).not.toHaveBeenCalled();
    await scheduled[0]();
    expect(mockFindMany).toHaveBeenCalledTimes(1);
  });

  it("does not schedule cleanup most of the time", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.99);
    const wrapped = withCachedAdapter(createFixtureAdapter({ searchHotels: vi.fn().mockResolvedValue([]) }), TTL);
    await wrapped.searchHotels(searchParams);
    expect(mockAfter).not.toHaveBeenCalled();
  });

  it("never schedules cleanup on a cache hit or when the provider call fails", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    mockFindUnique.mockResolvedValue({ payload: [], expiresAt: new Date(Date.now() + 60_000) });
    const hit = withCachedAdapter(createFixtureAdapter({ searchHotels: vi.fn() }), TTL);
    await hit.searchHotels(searchParams);

    mockFindUnique.mockResolvedValue(null);
    const failing = withCachedAdapter(createFixtureAdapter({ searchHotels: vi.fn().mockRejectedValue(new Error("down")) }), TTL);
    await expect(failing.searchHotels(searchParams)).rejects.toThrow("down");

    expect(mockAfter).not.toHaveBeenCalled();
  });

  it("swallows a cleanup failure - the scheduled pass logs and never throws", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    mockFindMany.mockRejectedValue(new Error("db unreachable"));
    const wrapped = withCachedAdapter(createFixtureAdapter({ searchHotels: vi.fn().mockResolvedValue([]) }), TTL);

    const results = await wrapped.searchHotels(searchParams);
    await expect(scheduled[0]()).resolves.toBeUndefined();

    expect(results).toEqual([]);
    expect(errorLog).toHaveBeenCalled();
  });

  it("still returns the result when there is no request scope for after() (e.g. scripts)", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    mockAfter.mockImplementationOnce(() => {
      throw new Error("after() was called outside a request scope");
    });
    const wrapped = withCachedAdapter(createFixtureAdapter({ searchHotels: vi.fn().mockResolvedValue([]) }), TTL);
    await expect(wrapped.searchHotels(searchParams)).resolves.toEqual([]);
  });
});
