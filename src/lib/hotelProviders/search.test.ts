import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { HotelProviderAdapterError, HotelProviderNotOperationalError, HotelProviderTimeoutError } from "./types";

const mockHotelProviderFindMany = vi.fn();
const mockHotelProviderFindUnique = vi.fn();
const mockAffiliateSearchFindFirst = vi.fn();
const mockAffiliateSearchCreate = vi.fn();
const mockAffiliateHotelFindMany = vi.fn();
const mockAffiliateHotelFindUnique = vi.fn();
const mockTransaction = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    hotelProvider: {
      findMany: (...args: unknown[]) => mockHotelProviderFindMany(...args),
      findUnique: (...args: unknown[]) => mockHotelProviderFindUnique(...args),
    },
    affiliateSearch: {
      findFirst: (...args: unknown[]) => mockAffiliateSearchFindFirst(...args),
      create: (...args: unknown[]) => mockAffiliateSearchCreate(...args),
    },
    affiliateHotel: {
      findMany: (...args: unknown[]) => mockAffiliateHotelFindMany(...args),
      findUnique: (...args: unknown[]) => mockAffiliateHotelFindUnique(...args),
      // Not mocked with its own vi.fn(): $transaction itself is mocked below,
      // so these Prisma call *expressions* just need to build a promise-like
      // value each without ever actually executing against a database.
      create: (args: unknown) => Promise.resolve(args),
      update: (args: unknown) => Promise.resolve(args),
    },
    $transaction: (...args: unknown[]) => mockTransaction(...args),
  },
}));

vi.mock("@/auth", () => ({ auth: vi.fn().mockResolvedValue(null) }));

vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({ get: () => undefined }),
  headers: vi.fn().mockResolvedValue({ get: () => null }),
}));

// The registry is mocked so these tests isolate search.ts's own handling;
// the activation rule itself is covered by registry.test.ts. The mock is
// keyed by provider.code, matching the real getOperationalHotelProviderAdapter.
const mockGetHotelProviderAdapter = vi.fn();
const mockEvaluateProviderActivation = vi.fn();
vi.mock("@/lib/hotelProviders/registry", () => ({
  getOperationalHotelProviderAdapter: (provider: { code: string }) => mockGetHotelProviderAdapter(provider.code),
  evaluateProviderActivation: (...args: unknown[]) => mockEvaluateProviderActivation(...args),
}));

const { searchHotels, getHotelForBooking, getHotelAvailability, loadHotelDetailPageData } = await import("./search");

const stayWindowParams = {
  destination: "Blackpool",
  checkIn: new Date("2026-11-10"),
  checkOut: new Date("2026-11-12"),
  adults: 2,
  children: 0,
  rooms: 1,
};

function fakeAdapter(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    code: "mock",
    name: "Mock provider",
    supportsSearch: true,
    supportsDeepLink: true,
    supportsClickTracking: true,
    supportsConversionTracking: false,
    searchHotels: vi.fn(),
    getHotelDetails: vi.fn(),
    getAvailability: vi.fn(),
    createDeepLink: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  mockHotelProviderFindMany.mockReset();
  mockAffiliateSearchFindFirst.mockReset().mockResolvedValue(null);
  mockAffiliateSearchCreate.mockReset().mockResolvedValue({});
  mockAffiliateHotelFindMany.mockReset().mockResolvedValue([]);
  mockAffiliateHotelFindUnique.mockReset();
  mockTransaction.mockReset().mockResolvedValue([]);
  mockGetHotelProviderAdapter.mockReset();
  mockEvaluateProviderActivation.mockReset().mockReturnValue({ operational: true });
  mockHotelProviderFindUnique.mockReset().mockResolvedValue({ code: "mock", status: "ACTIVE" });
});

describe("searchHotels", () => {
  it("returns unavailable, with no adapter/DB calls at all, when there are zero ACTIVE providers", async () => {
    mockHotelProviderFindMany.mockResolvedValue([]);

    const outcome = await searchHotels(stayWindowParams);

    expect(outcome).toEqual({
      status: "unavailable",
      message: "Hotel search isn't available right now. Please try again later.",
    });
    expect(mockGetHotelProviderAdapter).not.toHaveBeenCalled();
  });

  it("returns unavailable when every ACTIVE provider throws HotelProviderAdapterError, and records a failed search event for each", async () => {
    mockHotelProviderFindMany.mockResolvedValue([{ id: "p1", code: "mock", name: "Mock" }]);
    const adapter = fakeAdapter({
      searchHotels: vi.fn().mockRejectedValue(new HotelProviderAdapterError("down", { retryable: true })),
    });
    mockGetHotelProviderAdapter.mockReturnValue(adapter);

    const outcome = await searchHotels(stayWindowParams);

    expect(outcome).toEqual({
      status: "unavailable",
      message: "We couldn't reach our hotel search partner. Please try again shortly.",
    });
    expect(mockAffiliateSearchCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ resultCount: null }) }),
    );
  });

  it("treats a HotelProviderTimeoutError exactly like any other HotelProviderAdapterError - reports 'unavailable' rather than crashing the guest-facing search", async () => {
    mockHotelProviderFindMany.mockResolvedValue([{ id: "p1", code: "mock", name: "Mock" }]);
    const adapter = fakeAdapter({
      searchHotels: vi.fn().mockRejectedValue(new HotelProviderTimeoutError(8000)),
    });
    mockGetHotelProviderAdapter.mockReturnValue(adapter);

    const outcome = await searchHotels(stayWindowParams);

    expect(outcome).toEqual({
      status: "unavailable",
      message: "We couldn't reach our hotel search partner. Please try again shortly.",
    });
  });

  it("re-throws an unexpected (non-adapter) error rather than swallowing it as 'unavailable'", async () => {
    mockHotelProviderFindMany.mockResolvedValue([{ id: "p1", code: "mock", name: "Mock" }]);
    const bug = new TypeError("something the adapter contract never promised");
    const adapter = fakeAdapter({ searchHotels: vi.fn().mockRejectedValue(bug) });
    mockGetHotelProviderAdapter.mockReturnValue(adapter);

    await expect(searchHotels(stayWindowParams)).rejects.toThrow(bug);
  });

  it("still returns ok with the successful provider's results when one of several providers fails", async () => {
    mockHotelProviderFindMany.mockResolvedValue([
      { id: "p1", code: "mock", name: "Mock" },
      { id: "p2", code: "mock2", name: "Mock2" },
    ]);
    const failing = fakeAdapter({
      code: "mock2",
      searchHotels: vi.fn().mockRejectedValue(new HotelProviderAdapterError("down", { retryable: true })),
    });
    const workingResult = {
      externalId: "ext-1",
      name: "The Grand Lodge",
      city: "Blackpool",
      country: "UK",
      facilities: [],
      currency: "GBP",
      priceCents: 10000,
    };
    const working = fakeAdapter({ searchHotels: vi.fn().mockResolvedValue([workingResult]) });
    mockGetHotelProviderAdapter.mockImplementation((code: string) => (code === "mock2" ? failing : working));
    mockAffiliateHotelFindMany.mockResolvedValue([]);
    mockTransaction.mockResolvedValue([{ id: "row-1", externalId: "ext-1", slug: "the-grand-lodge" }]);
    // upsertAffiliateHotels reads slugs from the `existing` findMany result for
    // already-known hotels, and from its own generated slug for new ones - for
    // a never-before-seen hotel like this fixture, the slug comes from the
    // create branch, not the transaction's return value (see search.ts).
    mockAffiliateHotelFindMany
      .mockResolvedValueOnce([]) // existing-by-externalId lookup
      .mockResolvedValueOnce([]); // taken-slugs lookup

    const outcome = await searchHotels(stayWindowParams);

    expect(outcome.status).toBe("ok");
    if (outcome.status === "ok") {
      expect(outcome.results).toHaveLength(1);
      expect(outcome.results[0].name).toBe("The Grand Lodge");
    }
  });
});

describe("getHotelForBooking", () => {
  it("returns not_found when no AffiliateHotel row matches the slug", async () => {
    mockAffiliateHotelFindUnique.mockResolvedValue(null);
    expect(await getHotelForBooking("nope")).toEqual({ status: "not_found" });
  });

  it("returns not_found when the row exists but is inactive", async () => {
    mockAffiliateHotelFindUnique.mockResolvedValue({
      slug: "x",
      active: false,
      externalId: "ext",
      provider: { code: "mock", name: "Mock" },
    });
    expect(await getHotelForBooking("x")).toEqual({ status: "not_found" });
  });

  it("returns unavailable when the adapter throws HotelProviderAdapterError", async () => {
    mockAffiliateHotelFindUnique.mockResolvedValue({
      slug: "x",
      active: true,
      externalId: "ext",
      provider: { code: "mock", name: "Mock" },
    });
    mockGetHotelProviderAdapter.mockReturnValue(
      fakeAdapter({
        getHotelDetails: vi.fn().mockRejectedValue(new HotelProviderAdapterError("down", { retryable: true })),
      }),
    );
    expect(await getHotelForBooking("x")).toEqual({
      status: "unavailable",
      message: "This hotel's details aren't available right now. Please try again shortly.",
    });
  });

  it("re-throws an unexpected error from getHotelDetails rather than reporting 'unavailable'", async () => {
    mockAffiliateHotelFindUnique.mockResolvedValue({
      slug: "x",
      active: true,
      externalId: "ext",
      provider: { code: "mock", name: "Mock" },
    });
    const bug = new Error("unexpected bug");
    mockGetHotelProviderAdapter.mockReturnValue(fakeAdapter({ getHotelDetails: vi.fn().mockRejectedValue(bug) }));
    await expect(getHotelForBooking("x")).rejects.toThrow(bug);
  });
});

describe("getHotelAvailability", () => {
  const availabilityParams = { checkIn: stayWindowParams.checkIn, checkOut: stayWindowParams.checkOut, adults: 2, children: 0, rooms: 1 };

  it("returns unavailable when the adapter throws HotelProviderAdapterError", async () => {
    mockGetHotelProviderAdapter.mockReturnValue(
      fakeAdapter({
        getAvailability: vi.fn().mockRejectedValue(new HotelProviderAdapterError("down", { retryable: false })),
      }),
    );
    expect(await getHotelAvailability("mock", "ext", availabilityParams)).toEqual({
      status: "unavailable",
      message: "We couldn't check live availability for this hotel. Please try again shortly.",
    });
  });

  it("re-throws an unexpected error rather than reporting 'unavailable'", async () => {
    const bug = new Error("unexpected bug");
    mockGetHotelProviderAdapter.mockReturnValue(fakeAdapter({ getAvailability: vi.fn().mockRejectedValue(bug) }));
    await expect(getHotelAvailability("mock", "ext", availabilityParams)).rejects.toThrow(bug);
  });

  it("returns ok with the adapter's deals on success, including a genuinely empty (sold out) list", async () => {
    mockGetHotelProviderAdapter.mockReturnValue(fakeAdapter({ getAvailability: vi.fn().mockResolvedValue([]) }));
    expect(await getHotelAvailability("mock", "ext", availabilityParams)).toEqual({ status: "ok", deals: [] });
  });
});

describe("provider activation gate (search.ts side)", () => {
  it("never queries an ACTIVE provider that fails the activation rule, and reports search unavailable when none pass", async () => {
    mockHotelProviderFindMany.mockResolvedValue([{ id: "p1", code: "booking_com", name: "Booking.com", status: "ACTIVE" }]);
    mockEvaluateProviderActivation.mockReturnValue({ operational: false, reason: "not_live_listed" });

    const outcome = await searchHotels(stayWindowParams);

    expect(outcome).toEqual({
      status: "unavailable",
      message: "Hotel search isn't available right now. Please try again later.",
    });
    expect(mockGetHotelProviderAdapter).not.toHaveBeenCalled();
    expect(mockAffiliateSearchCreate).not.toHaveBeenCalled();
  });

  it("queries only the operational providers when some ACTIVE ones fail the rule", async () => {
    mockHotelProviderFindMany.mockResolvedValue([
      { id: "p1", code: "mock", name: "Mock", status: "ACTIVE" },
      { id: "p2", code: "booking_com", name: "Booking.com", status: "ACTIVE" },
    ]);
    mockEvaluateProviderActivation.mockImplementation((p: { code: string }) =>
      p.code === "mock" ? { operational: true } : { operational: false, reason: "not_live_listed" },
    );
    mockGetHotelProviderAdapter.mockReturnValue(fakeAdapter({ searchHotels: vi.fn().mockResolvedValue([]) }));

    await searchHotels(stayWindowParams);

    expect(mockGetHotelProviderAdapter).toHaveBeenCalledTimes(1);
    expect(mockGetHotelProviderAdapter).toHaveBeenCalledWith("mock");
  });

  it("getHotelForBooking reports unavailable (not a crash) when the provider is locked by the gate", async () => {
    mockAffiliateHotelFindUnique.mockResolvedValue({
      slug: "x",
      active: true,
      externalId: "ext",
      provider: { code: "mock", name: "Mock", status: "ACTIVE" },
    });
    mockGetHotelProviderAdapter.mockReturnValue(
      fakeAdapter({
        getHotelDetails: vi.fn().mockRejectedValue(new HotelProviderNotOperationalError("mock", "fixture_in_production")),
      }),
    );
    expect(await getHotelForBooking("x")).toEqual({
      status: "unavailable",
      message: "This hotel's details aren't available right now. Please try again shortly.",
    });
  });

  it("getHotelAvailability reports unavailable without calling any adapter when the provider row doesn't exist", async () => {
    mockHotelProviderFindUnique.mockResolvedValue(null);
    const outcome = await getHotelAvailability("gone", "ext", {
      checkIn: stayWindowParams.checkIn,
      checkOut: stayWindowParams.checkOut,
      adults: 2,
      children: 0,
      rooms: 1,
    });
    expect(outcome.status).toBe("unavailable");
    expect(mockGetHotelProviderAdapter).not.toHaveBeenCalled();
  });
});

describe("concurrent AffiliateHotel upsert (P2002 race)", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    return () => {
      warnSpy.mockRestore();
      errorSpy.mockRestore();
    };
  });

  function uniqueViolation(target: string[] = ["slug"]) {
    return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "test",
      meta: { target },
    });
  }

  const hotel = (externalId: string, name = "The Grand Lodge") => ({
    externalId,
    name,
    city: "Blackpool",
    country: "UK",
    facilities: [],
    currency: "GBP",
    priceCents: 10000,
  });

  function setUpSearch(results: ReturnType<typeof hotel>[]) {
    mockHotelProviderFindMany.mockResolvedValue([{ id: "p1", code: "mock", name: "Mock" }]);
    mockGetHotelProviderAdapter.mockReturnValue(fakeAdapter({ searchHotels: vi.fn().mockResolvedValue(results) }));
  }

  async function createdExternalIds(transactionCall: number): Promise<string[]> {
    const ops = (await Promise.all(mockTransaction.mock.calls[transactionCall][0] as Promise<{ data: { externalId?: string } }>[]));
    return ops.map((op) => op.data.externalId).filter((id): id is string => Boolean(id));
  }

  it("re-runs the write after losing the race, updating the winner's rows instead of failing the search", async () => {
    setUpSearch([hotel("ext-1")]);
    mockTransaction.mockRejectedValueOnce(uniqueViolation(["providerId", "externalId"])).mockResolvedValueOnce([]);
    mockAffiliateHotelFindMany
      .mockResolvedValueOnce([]) // attempt 1: existing
      .mockResolvedValueOnce([]) // attempt 1: taken slugs
      .mockResolvedValueOnce([{ id: "row-1", externalId: "ext-1", slug: "the-grand-lodge-blackpool" }]); // attempt 2: winner's row

    const outcome = await searchHotels(stayWindowParams);

    expect(outcome.status).toBe("ok");
    if (outcome.status === "ok") expect(outcome.results.map((r) => r.slug)).toEqual(["the-grand-lodge-blackpool"]);
    expect(mockTransaction).toHaveBeenCalledTimes(2);
    // The second attempt updated the existing row rather than inserting again.
    expect(await createdExternalIds(1)).toEqual([]);
    const conflict = JSON.parse(warnSpy.mock.calls[0][0] as string);
    expect(conflict).toMatchObject({
      event: "hotel_provider.upsert_conflict",
      attempt: 1,
      maxAttempts: 3,
      target: "providerId,externalId",
      exhausted: false,
    });
  });

  it("picks the next free slug on retry when a different hotel won the same slug", async () => {
    setUpSearch([hotel("ext-2")]);
    mockTransaction.mockRejectedValueOnce(uniqueViolation(["slug"])).mockResolvedValueOnce([]);
    mockAffiliateHotelFindMany
      .mockResolvedValueOnce([]) // attempt 1: existing
      .mockResolvedValueOnce([]) // attempt 1: taken slugs
      .mockResolvedValueOnce([]) // attempt 2: existing - still not ours
      .mockResolvedValueOnce([{ slug: "the-grand-lodge-blackpool" }]); // attempt 2: the other hotel now holds the base slug

    const outcome = await searchHotels(stayWindowParams);

    expect(outcome.status).toBe("ok");
    if (outcome.status === "ok") expect(outcome.results[0].slug).toBe("the-grand-lodge-blackpool-2");
  });

  it("never throws when every attempt conflicts: falls back to the rows that exist and skips the rest", async () => {
    setUpSearch([hotel("ext-a", "Alpha House"), hotel("ext-b", "Beta House")]);
    mockTransaction.mockRejectedValue(uniqueViolation());
    mockAffiliateHotelFindMany.mockImplementation(async (args: { select?: { id?: boolean } }) =>
      // The final read-only fallback selects no id; only ext-a made it in.
      args.select?.id ? [] : [{ externalId: "ext-a", slug: "alpha-house-blackpool" }],
    );

    const outcome = await searchHotels(stayWindowParams);

    expect(outcome.status).toBe("ok");
    if (outcome.status === "ok") {
      expect(outcome.results.map((r) => r.externalId)).toEqual(["ext-a"]);
      expect(outcome.results[0].slug).toBe("alpha-house-blackpool");
    }
    expect(mockTransaction).toHaveBeenCalledTimes(3);
    const exhausted = (errorSpy.mock.calls as unknown[][])
      .map(([line]): Record<string, unknown> => JSON.parse(line as string))
      .find((record) => record.event === "hotel_provider.upsert_conflict");
    expect(exhausted).toMatchObject({ attempt: 3, exhausted: true });
  });

  it("does not retry or swallow any other database error", async () => {
    setUpSearch([hotel("ext-1")]);
    const dbDown = new Prisma.PrismaClientKnownRequestError("Foreign key constraint failed", {
      code: "P2003",
      clientVersion: "test",
    });
    mockTransaction.mockRejectedValue(dbDown);

    await expect(searchHotels(stayWindowParams)).rejects.toBe(dbDown);
    expect(mockTransaction).toHaveBeenCalledTimes(1);
  });

  it("takes locks in a consistent order (existing rows by id, new rows by externalId) so concurrent writers conflict rather than deadlock", async () => {
    setUpSearch([hotel("ext-c", "Gamma"), hotel("ext-a", "Alpha"), hotel("ext-b", "Beta")]);
    mockAffiliateHotelFindMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    await searchHotels(stayWindowParams);

    expect(mockAffiliateHotelFindMany.mock.calls[0][0]).toMatchObject({ orderBy: { id: "asc" } });
    expect(await createdExternalIds(0)).toEqual(["ext-a", "ext-b", "ext-c"]);
  });
});

describe("loadHotelDetailPageData (detail page: details and availability in parallel)", () => {
  const availabilityParams = { checkIn: stayWindowParams.checkIn, checkOut: stayWindowParams.checkOut, adults: 2, children: 0, rooms: 1 };
  const okLookup = {
    status: "ok" as const,
    hotel: {
      slug: "x",
      providerCode: "mock",
      providerName: "Mock",
      externalId: "ext-1",
      details: { externalId: "ext-1", name: "Hotel", city: "Blackpool", country: "UK", photos: [], facilities: [] },
    },
  };
  const deal = { name: "Room", currency: "GBP", priceCents: 1000 };

  function activeRow() {
    mockAffiliateHotelFindUnique.mockResolvedValue({ active: true, externalId: "ext-1", provider: { code: "mock", status: "ACTIVE" } });
  }

  it("returns not_found for an unknown slug without calling the provider at all", async () => {
    mockAffiliateHotelFindUnique.mockResolvedValue(null);
    const loadDetails = vi.fn();
    expect(await loadHotelDetailPageData("nope", availabilityParams, loadDetails)).toEqual({ status: "not_found" });
    expect(loadDetails).not.toHaveBeenCalled();
    expect(mockGetHotelProviderAdapter).not.toHaveBeenCalled();
  });

  it("returns not_found for an inactive (suppressed) hotel without calling the provider at all", async () => {
    mockAffiliateHotelFindUnique.mockResolvedValue({ active: false, externalId: "ext-1", provider: { code: "mock", status: "ACTIVE" } });
    const loadDetails = vi.fn();
    expect(await loadHotelDetailPageData("x", availabilityParams, loadDetails)).toEqual({ status: "not_found" });
    expect(loadDetails).not.toHaveBeenCalled();
    expect(mockGetHotelProviderAdapter).not.toHaveBeenCalled();
  });

  it("runs details and availability concurrently: two 1s calls finish in 1s, not 2s", async () => {
    vi.useFakeTimers();
    try {
      activeRow();
      const loadDetails = vi.fn(() => new Promise<typeof okLookup>((resolve) => setTimeout(() => resolve(okLookup), 1000)));
      const getAvailability = vi.fn(() => new Promise((resolve) => setTimeout(() => resolve([deal]), 1000)));
      mockGetHotelProviderAdapter.mockReturnValue(fakeAdapter({ getAvailability }));

      let settled: unknown = null;
      const pending = loadHotelDetailPageData("x", availabilityParams, loadDetails).then((value) => {
        settled = value;
      });
      await vi.advanceTimersByTimeAsync(0);
      // Both provider calls are in flight before either has finished.
      expect(loadDetails).toHaveBeenCalledTimes(1);
      expect(getAvailability).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1000);
      await pending;
      expect(settled).toEqual({ status: "ok", hotel: okLookup.hotel, availability: { status: "ok", deals: [deal] } });
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns the details' unavailable state unchanged when details fail, even if availability succeeded", async () => {
    activeRow();
    const unavailable = { status: "unavailable" as const, message: "This hotel's details aren't available right now. Please try again shortly." };
    mockGetHotelProviderAdapter.mockReturnValue(fakeAdapter({ getAvailability: vi.fn().mockResolvedValue([deal]) }));
    expect(await loadHotelDetailPageData("x", availabilityParams, vi.fn().mockResolvedValue(unavailable))).toEqual(unavailable);
  });

  it("keeps the availability unavailable message when only availability fails", async () => {
    activeRow();
    mockGetHotelProviderAdapter.mockReturnValue(
      fakeAdapter({ getAvailability: vi.fn().mockRejectedValue(new HotelProviderTimeoutError(4000)) }),
    );
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const outcome = await loadHotelDetailPageData("x", availabilityParams, vi.fn().mockResolvedValue(okLookup)).finally(() =>
      warnSpy.mockRestore(),
    );
    expect(outcome).toEqual({
      status: "ok",
      hotel: okLookup.hotel,
      availability: { status: "unavailable", message: "We couldn't check live availability for this hotel. Please try again shortly." },
    });
  });

  it("never requests availability for a provider that fails the activation rule", async () => {
    activeRow();
    mockEvaluateProviderActivation.mockReturnValue({ operational: false, reason: "fixture_in_production" });
    const unavailable = { status: "unavailable" as const, message: "This hotel's details aren't available right now. Please try again shortly." };
    const loadDetails = vi.fn().mockResolvedValue(unavailable);

    expect(await loadHotelDetailPageData("x", availabilityParams, loadDetails)).toEqual(unavailable);
    expect(loadDetails).toHaveBeenCalledWith("x");
    expect(mockHotelProviderFindUnique).not.toHaveBeenCalled();
    expect(mockGetHotelProviderAdapter).not.toHaveBeenCalled();
  });

  it("re-throws an unexpected availability error rather than hiding it", async () => {
    activeRow();
    const bug = new Error("unexpected bug");
    mockGetHotelProviderAdapter.mockReturnValue(fakeAdapter({ getAvailability: vi.fn().mockRejectedValue(bug) }));
    await expect(loadHotelDetailPageData("x", availabilityParams, vi.fn().mockResolvedValue(okLookup))).rejects.toThrow(bug);
  });
});

describe("provider failure logging", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    return () => {
      warnSpy.mockRestore();
      errorSpy.mockRestore();
    };
  });

  function loggedRecords(): Record<string, unknown>[] {
    return [...warnSpy.mock.calls, ...errorSpy.mock.calls]
      .map(([line]) => (typeof line === "string" && line.startsWith("{") ? JSON.parse(line) : null))
      .filter((record): record is Record<string, unknown> => record?.event === "hotel_provider.call_failed");
  }

  it("search: logs exactly one structured line per failed provider, and the guest message is unchanged", async () => {
    mockHotelProviderFindMany.mockResolvedValue([{ id: "p1", code: "mock", name: "Mock" }]);
    mockGetHotelProviderAdapter.mockReturnValue(
      fakeAdapter({
        searchHotels: vi.fn().mockRejectedValue(new HotelProviderAdapterError("secret upstream text", { retryable: true, statusCode: 503 })),
      }),
    );

    const outcome = await searchHotels(stayWindowParams);

    expect(outcome).toEqual({
      status: "unavailable",
      message: "We couldn't reach our hotel search partner. Please try again shortly.",
    });
    const records = loggedRecords();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      operation: "search",
      providerCode: "mock",
      outcome: "adapter_error",
      retryable: true,
      statusCode: 503,
    });
    expect(typeof records[0].durationMs).toBe("number");
    const allText = JSON.stringify([...warnSpy.mock.calls, ...errorSpy.mock.calls]);
    expect(allText).not.toContain("secret upstream text");
    // Nothing about the guest's own search is logged.
    expect(allText).not.toContain("Blackpool");
  });

  it("details: logs one line with the provider's hotel id and the timeout outcome", async () => {
    mockAffiliateHotelFindUnique.mockResolvedValue({
      slug: "x",
      active: true,
      externalId: "ext-9",
      provider: { code: "mock", name: "Mock" },
    });
    mockGetHotelProviderAdapter.mockReturnValue(
      fakeAdapter({ getHotelDetails: vi.fn().mockRejectedValue(new HotelProviderTimeoutError(4000)) }),
    );

    expect((await getHotelForBooking("x")).status).toBe("unavailable");
    const records = loggedRecords();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ operation: "details", outcome: "timeout", externalId: "ext-9" });
  });

  it("availability: logs one line, and a non-retryable error is logged at error level", async () => {
    mockGetHotelProviderAdapter.mockReturnValue(
      fakeAdapter({
        getAvailability: vi.fn().mockRejectedValue(new HotelProviderAdapterError("bad creds", { retryable: false })),
      }),
    );
    const outcome = await getHotelAvailability("mock", "ext-2", {
      checkIn: stayWindowParams.checkIn,
      checkOut: stayWindowParams.checkOut,
      adults: 2,
      children: 0,
      rooms: 1,
    });

    expect(outcome).toEqual({
      status: "unavailable",
      message: "We couldn't check live availability for this hotel. Please try again shortly.",
    });
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(loggedRecords()[0]).toMatchObject({ operation: "availability", outcome: "adapter_error", externalId: "ext-2" });
  });

  it("does not log anything for a successful call", async () => {
    mockGetHotelProviderAdapter.mockReturnValue(fakeAdapter({ getAvailability: vi.fn().mockResolvedValue([]) }));
    await getHotelAvailability("mock", "ext", {
      checkIn: stayWindowParams.checkIn,
      checkOut: stayWindowParams.checkOut,
      adults: 2,
      children: 0,
      rooms: 1,
    });
    expect(loggedRecords()).toHaveLength(0);
  });
});

describe("invalid configuration: guest-facing path stays generic", () => {
  it("maps an invalid_configuration lock to the normal unavailable message, with no config details", async () => {
    mockHotelProviderFindMany.mockResolvedValue([{ id: "p1", code: "mock", name: "Mock", status: "ACTIVE" }]);
    const configDetail = new Error('HOTEL_PROVIDER_MAX_ATTEMPTS="0.5" is not a positive whole number (allowed: 1-10).');
    mockGetHotelProviderAdapter.mockReturnValue(
      fakeAdapter({
        searchHotels: vi.fn().mockRejectedValue(new HotelProviderNotOperationalError("mock", "invalid_configuration", configDetail)),
      }),
    );

    const outcome = await searchHotels(stayWindowParams);

    expect(outcome).toEqual({
      status: "unavailable",
      message: "We couldn't reach our hotel search partner. Please try again shortly.",
    });
    const serialized = JSON.stringify(outcome);
    expect(serialized).not.toContain("HOTEL_PROVIDER");
    expect(serialized).not.toContain("0.5");
    expect(serialized).not.toContain("invalid_configuration");
  });
});
