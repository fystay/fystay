import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockCacheFindUnique = vi.fn();
const mockCacheUpsert = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    hotelProviderCacheEntry: {
      findUnique: (...args: unknown[]) => mockCacheFindUnique(...args),
      upsert: (...args: unknown[]) => mockCacheUpsert(...args),
    },
  },
}));
vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn() }));

const { validateSearchResults, validateDeals, validateHotelDetails, withValidatedAdapter, MAX_SEARCH_RESULTS, MAX_DEALS } =
  await import("./validation");
const { HotelProviderInvalidResponseError, HotelProviderAdapterError } = await import("./types");
const { mockHotelProviderAdapter } = await import("./providers/mock");
const { createFixtureAdapter } = await import("./testFixtures");
const { getOperationalHotelProviderAdapter } = await import("./registry");

function validHotel(overrides: Record<string, unknown> = {}) {
  return {
    externalId: "ext-1",
    name: "The Grand Lodge",
    city: "Blackpool",
    country: "United Kingdom",
    latitude: 53.8,
    longitude: -3.05,
    starRating: 4,
    guestRating: 8.7,
    reviewCount: 120,
    primaryPhotoUrl: "https://images.example.test/a.jpg",
    facilities: ["Free WiFi"],
    currency: "GBP",
    priceCents: 12000,
    ...overrides,
  };
}

function validDeal(overrides: Record<string, unknown> = {}) {
  return {
    externalRoomId: "room-1",
    name: "Standard Double",
    description: "A double room.",
    maxGuests: 2,
    currency: "GBP",
    priceCents: 24000,
    refundable: true,
    ...overrides,
  };
}

function validDetails(overrides: Record<string, unknown> = {}) {
  return {
    externalId: "ext-1",
    name: "The Grand Lodge",
    description: "Seafront hotel.",
    city: "Blackpool",
    country: "United Kingdom",
    latitude: null,
    longitude: null,
    starRating: 4,
    guestRating: 8.7,
    reviewCount: 120,
    photos: ["https://images.example.test/a.jpg"],
    facilities: ["Free WiFi"],
    ...overrides,
  };
}

let warnSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  mockCacheFindUnique.mockReset().mockResolvedValue(null);
  mockCacheUpsert.mockReset().mockResolvedValue({});
});
afterEach(() => {
  warnSpy.mockRestore();
});

function expectInvalid(fn: () => unknown, operation: string): InstanceType<typeof HotelProviderInvalidResponseError> {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(HotelProviderInvalidResponseError);
    expect(err).toBeInstanceOf(HotelProviderAdapterError);
    const invalid = err as InstanceType<typeof HotelProviderInvalidResponseError>;
    expect(invalid.retryable).toBe(false);
    expect(invalid.operation).toBe(operation);
    expect(invalid.message).toBe(`Provider returned a malformed ${operation} response`);
    return invalid;
  }
  throw new Error("expected a HotelProviderInvalidResponseError");
}

describe("validateSearchResults: accepted data", () => {
  it("accepts a well-formed result, and optional fields left out or null", () => {
    const minimal = { externalId: "e2", name: "Inn", city: "Leeds", country: "UK", facilities: [], currency: "EUR", priceCents: 1 };
    const withNulls = validHotel({ externalId: "e3", latitude: null, starRating: null, primaryPhotoUrl: null, reviewCount: null });
    expect(validateSearchResults([validHotel(), minimal, withNulls], "mock")).toHaveLength(3);
  });

  it("accepts an empty array (no hotels) without treating it as a failure", () => {
    expect(validateSearchResults([], "mock")).toEqual([]);
  });

  it("accepts boundary values", () => {
    const edge = validHotel({ latitude: -90, longitude: 180, starRating: 0, guestRating: 10, priceCents: 2_147_483_647 });
    expect(validateSearchResults([edge], "mock")).toHaveLength(1);
  });

  it("strips unknown keys so extra provider fields never reach the cache or database", () => {
    const [result] = validateSearchResults([validHotel({ internalCommissionRate: 0.18, rawPayload: { a: 1 } })], "mock");
    expect(result).not.toHaveProperty("internalCommissionRate");
    expect(result).not.toHaveProperty("rawPayload");
  });

  it("accepts every result the real mock provider returns, for several destinations", async () => {
    for (const destination of ["Blackpool", "London", "St Ives", "Llandudno", "  weird--Input!! "]) {
      const raw = await mockHotelProviderAdapter.searchHotels({
        destination,
        checkIn: new Date("2026-11-10"),
        checkOut: new Date("2026-11-12"),
        adults: 2,
        children: 0,
        rooms: 1,
      });
      expect(validateSearchResults(raw, "mock")).toEqual(raw);
    }
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

describe("validateSearchResults: per-item rules (drop the bad item, keep the rest)", () => {
  const badItems: [string, Record<string, unknown>][] = [
    ["empty externalId", { externalId: "" }],
    ["control characters in externalId", { externalId: "ext\u0000x" }],
    ["over-long externalId", { externalId: "x".repeat(257) }],
    ["blank name", { name: "   " }],
    ["over-long name", { name: "n".repeat(301) }],
    ["missing city", { city: undefined }],
    ["latitude out of range", { latitude: 91 }],
    ["longitude out of range", { longitude: -181 }],
    ["star rating above 5", { starRating: 6 }],
    ["guest rating above 10", { guestRating: 11 }],
    ["negative review count", { reviewCount: -1 }],
    ["fractional review count", { reviewCount: 1.5 }],
    ["http photo URL", { primaryPhotoUrl: "http://images.example.test/a.jpg" }],
    ["javascript: photo URL", { primaryPhotoUrl: "javascript:alert(1)" }],
    ["unparseable photo URL", { primaryPhotoUrl: "not a url" }],
    ["too many facilities", { facilities: Array.from({ length: 101 }, (_, i) => `f${i}`) }],
    ["over-long facility", { facilities: ["f".repeat(101)] }],
    ["lowercase currency", { currency: "gbp" }],
    ["zero price", { priceCents: 0 }],
    ["negative price", { priceCents: -100 }],
    ["fractional price", { priceCents: 100.5 }],
    ["price above Postgres int4", { priceCents: 2_147_483_648 }],
    ["NaN price", { priceCents: Number.NaN }],
    ["infinite price", { priceCents: Number.POSITIVE_INFINITY }],
    ["price as a string", { priceCents: "12000" }],
  ];

  for (const [label, override] of badItems) {
    it(`drops an item with ${label}`, () => {
      const kept = validateSearchResults([validHotel({ externalId: "good" }), validHotel({ externalId: "bad", ...override })], "mock");
      expect(kept.map((r) => r.externalId)).toEqual(["good"]);
    });
  }

  it("drops a later repeat of the same externalId (the first one wins)", () => {
    const kept = validateSearchResults(
      [validHotel({ name: "First" }), validHotel({ name: "Second" }), validHotel({ externalId: "other" })],
      "mock",
    );
    expect(kept.map((r) => r.name)).toEqual(["First", "The Grand Lodge"]);
  });

  it("logs one warning per response with counts and issue paths/codes only - never the bad values", () => {
    validateSearchResults(
      [validHotel(), validHotel({ externalId: "e2", priceCents: -7777777, primaryPhotoUrl: "javascript:SECRETVALUE" })],
      "mock",
    );
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const record = JSON.parse(warnSpy.mock.calls[0][0] as string);
    expect(record).toMatchObject({
      event: "hotel_provider.response_items_dropped",
      operation: "search",
      providerCode: "mock",
      received: 2,
      kept: 1,
      dropped: 1,
    });
    expect(record.issues).toEqual(
      expect.arrayContaining([
        { path: "[1].primaryPhotoUrl", code: "custom" },
        { path: "[1].priceCents", code: "too_small" },
      ]),
    );
    const text = JSON.stringify(warnSpy.mock.calls);
    expect(text).not.toContain("7777777");
    expect(text).not.toContain("SECRETVALUE");
  });
});

describe("validateSearchResults: whole-response rejection", () => {
  it("rejects a response that isn't an array", () => {
    for (const input of [null, undefined, {}, { results: [] }, "[]", 42]) {
      const err = expectInvalid(() => validateSearchResults(input, "mock"), "search");
      expect(err.issues).toEqual([{ path: "", code: "invalid_type" }]);
    }
  });

  it("rejects a response over the size limit", () => {
    const tooMany = Array.from({ length: MAX_SEARCH_RESULTS + 1 }, (_, i) => validHotel({ externalId: `e${i}` }));
    const err = expectInvalid(() => validateSearchResults(tooMany, "mock"), "search");
    expect(err.issues).toEqual([{ path: "", code: "too_big" }]);
    expect(validateSearchResults(tooMany.slice(0, MAX_SEARCH_RESULTS), "mock")).toHaveLength(MAX_SEARCH_RESULTS);
  });

  it("rejects (rather than reporting 'no hotels') when there were items but every one was invalid", () => {
    const err = expectInvalid(
      () => validateSearchResults([validHotel({ priceCents: 0 }), validHotel({ externalId: "e2", currency: "pounds" })], "mock"),
      "search",
    );
    expect(err.issues.length).toBeGreaterThan(0);
    expect(JSON.stringify(err.issues)).not.toContain("pounds");
  });

  it("caps the recorded issues at 10", () => {
    const bad = Array.from({ length: 30 }, (_, i) => validHotel({ externalId: `e${i}`, priceCents: 0, currency: "x" }));
    const err = expectInvalid(() => validateSearchResults(bad, "mock"), "search");
    expect(err.issues).toHaveLength(10);
  });
});

describe("validateDeals", () => {
  it("accepts well-formed deals, an empty (sold out) list, and minimal deals", () => {
    expect(validateDeals([validDeal(), { name: "Room", currency: "GBP", priceCents: 5000 }], "mock")).toHaveLength(2);
    expect(validateDeals([], "mock")).toEqual([]);
  });

  it("accepts every deal the real mock provider returns", async () => {
    for (const externalId of ["mock:blackpool:0", "mock:london:3", "mock:st-ives:5"]) {
      const raw = await mockHotelProviderAdapter.getAvailability(externalId, {
        checkIn: new Date("2026-11-10"),
        checkOut: new Date("2026-11-13"),
        adults: 2,
        children: 1,
        rooms: 1,
      });
      expect(validateDeals(raw, "mock")).toEqual(raw);
    }
  });

  it("drops individual invalid deals and keeps the rest", () => {
    const kept = validateDeals(
      [
        validDeal(),
        validDeal({ priceCents: 0 }),
        validDeal({ maxGuests: 0 }),
        validDeal({ refundable: "yes" }),
        validDeal({ currency: "GBPX" }),
      ],
      "mock",
    );
    expect(kept).toHaveLength(1);
  });

  it("rejects a non-array, an over-size list, or a list where every deal is invalid", () => {
    expectInvalid(() => validateDeals({ deals: [] }, "mock"), "availability");
    expectInvalid(() => validateDeals(Array.from({ length: MAX_DEALS + 1 }, () => validDeal()), "mock"), "availability");
    expectInvalid(() => validateDeals([validDeal({ priceCents: -1 })], "mock"), "availability");
  });
});

describe("validateHotelDetails (all-or-nothing)", () => {
  it("accepts well-formed details for the requested hotel, and the real mock provider's details", async () => {
    expect(validateHotelDetails(validDetails(), "ext-1").name).toBe("The Grand Lodge");
    const raw = await mockHotelProviderAdapter.getHotelDetails("mock:blackpool:2");
    expect(validateHotelDetails(raw, "mock:blackpool:2")).toEqual(raw);
  });

  it("rejects the whole response when any field is invalid", () => {
    for (const override of [
      { photos: ["https://ok.example.test/a.jpg", "http://insecure.example.test/b.jpg"] },
      { photos: Array.from({ length: 101 }, () => "https://ok.example.test/a.jpg") },
      { description: "d".repeat(10_001) },
      { name: "" },
      { guestRating: 10.5 },
      { facilities: "Free WiFi" },
    ]) {
      expectInvalid(() => validateHotelDetails(validDetails(override), "ext-1"), "details");
    }
    expectInvalid(() => validateHotelDetails(null, "ext-1"), "details");
  });

  it("rejects details for a different hotel than the one requested", () => {
    const err = expectInvalid(() => validateHotelDetails(validDetails({ externalId: "someone-else" }), "ext-1"), "details");
    expect(err.issues).toEqual([{ path: "externalId", code: "mismatch" }]);
  });

  it("strips unknown keys", () => {
    expect(validateHotelDetails(validDetails({ supplierNotes: "internal" }), "ext-1")).not.toHaveProperty("supplierNotes");
  });
});

describe("withValidatedAdapter", () => {
  it("leaves identity, capability flags and createDeepLink untouched", () => {
    const fixture = createFixtureAdapter();
    const wrapped = withValidatedAdapter(fixture);
    expect(wrapped.code).toBe(fixture.code);
    expect(wrapped.supportsDeepLink).toBe(fixture.supportsDeepLink);
    expect(wrapped.createDeepLink).toBe(fixture.createDeepLink);
  });

  it("passes the caller's signal through to the adapter", async () => {
    const searchHotels = vi.fn().mockResolvedValue([]);
    const wrapped = withValidatedAdapter(createFixtureAdapter({ searchHotels }));
    const controller = new AbortController();
    const params = { destination: "x", checkIn: new Date(), checkOut: new Date(), adults: 1, children: 0, rooms: 1 };
    await wrapped.searchHotels(params, controller.signal);
    expect(searchHotels).toHaveBeenCalledWith(params, controller.signal);
  });
});

describe("registry chain: malformed provider data never reaches the cache", () => {
  const params = { destination: "chain-test", checkIn: new Date("2026-12-01"), checkOut: new Date("2026-12-03"), adults: 2, children: 0, rooms: 1 };
  const availabilityParams = { checkIn: params.checkIn, checkOut: params.checkOut, adults: 2, children: 0, rooms: 1 };

  function chainFor(adapterOverrides: Parameters<typeof createFixtureAdapter>[0]) {
    const adapter = createFixtureAdapter(adapterOverrides);
    return getOperationalHotelProviderAdapter(
      { code: "fixture", status: "ACTIVE" },
      { context: { adapters: { fixture: adapter }, fixtureCodes: [], liveCodes: ["fixture"], isProduction: false }, env: {} },
    );
  }

  it("rejects a malformed search response without caching it, and fails without retrying", async () => {
    const searchHotels = vi.fn().mockResolvedValue([{ externalId: "e1", name: "Bad", priceCents: "free" }]);
    const chain = chainFor({ searchHotels });
    await expect(chain.searchHotels(params)).rejects.toBeInstanceOf(HotelProviderInvalidResponseError);
    expect(searchHotels).toHaveBeenCalledTimes(1);
    expect(mockCacheUpsert).not.toHaveBeenCalled();
  });

  it("rejects a malformed availability response without caching it", async () => {
    const chain = chainFor({ getAvailability: vi.fn().mockResolvedValue("<html>502 Bad Gateway</html>") });
    await expect(chain.getAvailability("e1", availabilityParams)).rejects.toBeInstanceOf(HotelProviderInvalidResponseError);
    expect(mockCacheUpsert).not.toHaveBeenCalled();
  });

  it("caches only the validated, key-stripped items when some were dropped", async () => {
    const chain = chainFor({
      searchHotels: vi.fn().mockResolvedValue([validHotel({ secretField: "x" }), validHotel({ externalId: "bad", priceCents: -1 })]),
    });
    const results = await chain.searchHotels(params);
    expect(results.map((r) => r.externalId)).toEqual(["ext-1"]);
    expect(mockCacheUpsert).toHaveBeenCalledTimes(1);
    const cachedPayload = mockCacheUpsert.mock.calls[0][0].create.payload;
    expect(cachedPayload).toEqual(results);
    expect(JSON.stringify(cachedPayload)).not.toContain("secretField");
    expect(JSON.stringify(cachedPayload)).not.toContain('"bad"');
  });

  it("rejects details for the wrong hotel through the full chain", async () => {
    const chain = chainFor({ getHotelDetails: vi.fn().mockResolvedValue(validDetails({ externalId: "other" })) });
    await expect(chain.getHotelDetails("ext-1")).rejects.toBeInstanceOf(HotelProviderInvalidResponseError);
  });
});
