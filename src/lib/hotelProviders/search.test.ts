import { beforeEach, describe, expect, it, vi } from "vitest";
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

const { searchHotels, getHotelForBooking, getHotelAvailability } = await import("./search");

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
