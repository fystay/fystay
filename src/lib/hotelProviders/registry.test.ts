import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EnvSource } from "@/lib/deploymentEnvironment";
import { HotelProviderNotOperationalError } from "./types";

const mockFindUnique = vi.fn();
const mockUpsert = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    hotelProviderCacheEntry: {
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
      upsert: (...args: unknown[]) => mockUpsert(...args),
    },
  },
}));

const {
  getOperationalHotelProviderAdapter,
  evaluateProviderActivation,
  defaultActivationContext,
  LIVE_HOTEL_PROVIDER_CODES,
  FIXTURE_HOTEL_PROVIDER_CODES,
} = await import("./registry");
const { createFixtureAdapter } = await import("./testFixtures");
const { bookingComAdapter } = await import("./providers/bookingCom");

const DEV_ENV = {};
const PREVIEW_ENV = { VERCEL_ENV: "preview" };
const PRODUCTION_ENV = { VERCEL_ENV: "production" };

const searchParams = {
  destination: "registry-test-destination",
  checkIn: new Date("2026-12-01"),
  checkOut: new Date("2026-12-03"),
  adults: 2,
  children: 0,
  rooms: 1,
};

beforeEach(() => {
  mockFindUnique.mockReset().mockResolvedValue(null);
  mockUpsert.mockReset().mockResolvedValue({});
});

describe("getOperationalHotelProviderAdapter", () => {
  it("resolves the mock provider", () => {
    expect(getOperationalHotelProviderAdapter({ code: "mock", status: "ACTIVE" }, { env: DEV_ENV }).code).toBe("mock");
  });

  it("resolves the booking_com provider", () => {
    expect(getOperationalHotelProviderAdapter({ code: "booking_com", status: "ACTIVE" }, { env: DEV_ENV }).code).toBe(
      "booking_com",
    );
  });

  it("throws for an unregistered provider code", async () => {
    const adapter = getOperationalHotelProviderAdapter({ code: "not-a-real-provider", status: "ACTIVE" }, { env: DEV_ENV });
    await expect(adapter.searchHotels(searchParams)).rejects.toMatchObject({
      name: "HotelProviderNotOperationalError",
      reason: "not_registered",
    });
  });

  it("returns a wrapped 'mock' adapter that still behaves like the real mock provider end to end", async () => {
    const adapter = getOperationalHotelProviderAdapter({ code: "mock", status: "ACTIVE" }, { env: DEV_ENV });
    expect(adapter.code).toBe("mock");

    const results = await adapter.searchHotels(searchParams);

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].externalId).toContain("registry-test-destination");
  });

  it("wraps 'booking_com' too - once live-listed, still throws its own not-yet-configured error, wrapping doesn't hide or change that", async () => {
    const context = { ...defaultActivationContext(DEV_ENV), liveCodes: ["booking_com"] };
    const adapter = getOperationalHotelProviderAdapter({ code: "booking_com", status: "ACTIVE" }, { context, env: DEV_ENV });
    await expect(adapter.searchHotels(searchParams)).rejects.toThrow(/not configured/i);
  });
});

describe("LIVE_HOTEL_PROVIDER_CODES", () => {
  it("stays empty - no provider is live simply because it's registered or has an adapter", () => {
    expect(LIVE_HOTEL_PROVIDER_CODES).toEqual([]);
  });

  it("never includes the mock provider", () => {
    expect(LIVE_HOTEL_PROVIDER_CODES).not.toContain("mock");
  });

  it("does not include 'booking_com' - it must never be flipped on without a deliberate decision", () => {
    expect(LIVE_HOTEL_PROVIDER_CODES).not.toContain("booking_com");
  });

  it("is frozen - nothing can add a provider to it at runtime", () => {
    expect(Object.isFrozen(LIVE_HOTEL_PROVIDER_CODES)).toBe(true);
    expect(() => (LIVE_HOTEL_PROVIDER_CODES as string[]).push("booking_com")).toThrow();
    expect(FIXTURE_HOTEL_PROVIDER_CODES).toEqual(["mock"]);
  });
});

describe("evaluateProviderActivation - the activation rule", () => {
  const futureExternal = createFixtureAdapter({ code: "future_external" });
  const contextWith = (env: EnvSource, liveCodes: string[] = []) => ({
    ...defaultActivationContext(env),
    adapters: { ...defaultActivationContext(env).adapters, future_external: futureExternal },
    liveCodes,
  });
  const evaluate = (code: string, status: string, env: EnvSource, liveCodes: string[] = []) =>
    evaluateProviderActivation({ code, status }, contextWith(env, liveCodes));

  it("mock + development + ACTIVE = operational", () => {
    expect(evaluate("mock", "ACTIVE", DEV_ENV)).toEqual({ operational: true });
    expect(evaluate("mock", "ACTIVE", { VERCEL_ENV: "development" })).toEqual({ operational: true });
  });

  it("mock + preview + ACTIVE = operational", () => {
    expect(evaluate("mock", "ACTIVE", PREVIEW_ENV)).toEqual({ operational: true });
  });

  it("mock + production = NOT operational, even when ACTIVE", () => {
    expect(evaluate("mock", "ACTIVE", PRODUCTION_ENV)).toEqual({ operational: false, reason: "fixture_in_production" });
  });

  it("mock stays blocked in production even if someone lists it as live", () => {
    expect(evaluate("mock", "ACTIVE", PRODUCTION_ENV, ["mock"])).toEqual({
      operational: false,
      reason: "fixture_in_production",
    });
  });

  it("booking_com + ACTIVE but not live-listed = NOT operational, in every environment", () => {
    for (const env of [DEV_ENV, PREVIEW_ENV, PRODUCTION_ENV]) {
      expect(evaluate("booking_com", "ACTIVE", env)).toEqual({ operational: false, reason: "not_live_listed" });
    }
  });

  it("a future external provider + production + ACTIVE but not live-listed = NOT operational", () => {
    expect(evaluate("future_external", "ACTIVE", PRODUCTION_ENV)).toEqual({
      operational: false,
      reason: "not_live_listed",
    });
  });

  it("an external provider + production + ACTIVE + live-listed = operational (its own readiness still applies)", () => {
    expect(evaluate("future_external", "ACTIVE", PRODUCTION_ENV, ["future_external"])).toEqual({ operational: true });
    expect(evaluate("booking_com", "ACTIVE", PRODUCTION_ENV, ["booking_com"])).toEqual({ operational: true });
  });

  it("INACTIVE (or COMING_SOON) is never operational - for fixture or external, listed or not, in any environment", () => {
    for (const env of [DEV_ENV, PREVIEW_ENV, PRODUCTION_ENV]) {
      for (const code of ["mock", "booking_com", "future_external"]) {
        for (const status of ["INACTIVE", "COMING_SOON"]) {
          expect(evaluate(code, status, env, [code])).toEqual({ operational: false, reason: "not_active" });
        }
      }
    }
  });

  it("an unregistered code is never operational, even if ACTIVE and live-listed", () => {
    expect(evaluate("unknown", "ACTIVE", DEV_ENV, ["unknown"])).toEqual({ operational: false, reason: "not_registered" });
    // Object prototype keys are not "registered adapters".
    expect(evaluate("toString", "ACTIVE", DEV_ENV, ["toString"])).toEqual({ operational: false, reason: "not_registered" });
  });
});

describe("runtime enforcement - fails if the gate is ever removed", () => {
  it("an ACTIVE external provider that isn't live-listed is refused and its real adapter is never called", async () => {
    const searchHotels = vi.fn().mockResolvedValue([]);
    const getAvailability = vi.fn().mockResolvedValue([]);
    const createDeepLink = vi.fn().mockReturnValue("https://fixture-provider.invalid/x");
    const external = createFixtureAdapter({ code: "future_external", searchHotels, getAvailability, createDeepLink });
    const context = { ...defaultActivationContext(PRODUCTION_ENV), adapters: { future_external: external }, liveCodes: [] };

    const adapter = getOperationalHotelProviderAdapter({ code: "future_external", status: "ACTIVE" }, { context, env: PRODUCTION_ENV });

    await expect(adapter.searchHotels(searchParams)).rejects.toBeInstanceOf(HotelProviderNotOperationalError);
    await expect(adapter.getAvailability("x", searchParams)).rejects.toBeInstanceOf(HotelProviderNotOperationalError);
    expect(() =>
      adapter.createDeepLink({ externalId: "x", checkIn: new Date(), checkOut: new Date(), adults: 1, children: 0, rooms: 1, subId: "s" }),
    ).toThrow(HotelProviderNotOperationalError);
    expect(searchHotels).not.toHaveBeenCalled();
    expect(getAvailability).not.toHaveBeenCalled();
    expect(createDeepLink).not.toHaveBeenCalled();
  });

  it("the same provider becomes operational only once it is live-listed", async () => {
    const searchHotels = vi.fn().mockResolvedValue([]);
    const external = createFixtureAdapter({ code: "future_external", searchHotels });
    const context = {
      ...defaultActivationContext(PRODUCTION_ENV),
      adapters: { future_external: external },
      liveCodes: ["future_external"],
    };

    const adapter = getOperationalHotelProviderAdapter({ code: "future_external", status: "ACTIVE" }, { context, env: PRODUCTION_ENV });

    await expect(adapter.searchHotels(searchParams)).resolves.toEqual([]);
    expect(searchHotels).toHaveBeenCalledTimes(1);
  });

  it("the real booking_com adapter is refused by the gate even with credentials set - its own code never runs", async () => {
    const spy = vi.spyOn(bookingComAdapter, "searchHotels");
    const env = { ...PRODUCTION_ENV, BOOKING_COM_API_KEY: "k", BOOKING_COM_AFFILIATE_ID: "a" };
    try {
      const adapter = getOperationalHotelProviderAdapter({ code: "booking_com", status: "ACTIVE" }, { env });
      await expect(adapter.searchHotels(searchParams)).rejects.toMatchObject({
        name: "HotelProviderNotOperationalError",
        reason: "not_live_listed",
      });
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it("mock is refused at runtime on a production deployment - its real adapter never runs", async () => {
    const adapter = getOperationalHotelProviderAdapter({ code: "mock", status: "ACTIVE" }, { env: PRODUCTION_ENV });
    await expect(adapter.searchHotels(searchParams)).rejects.toMatchObject({ reason: "fixture_in_production" });
    expect(() =>
      adapter.createDeepLink({ externalId: "mock:x:0", checkIn: new Date(), checkOut: new Date(), adults: 1, children: 0, rooms: 1, subId: "s" }),
    ).toThrow(HotelProviderNotOperationalError);
  });

  it("an INACTIVE provider is refused at runtime", async () => {
    const adapter = getOperationalHotelProviderAdapter({ code: "mock", status: "INACTIVE" }, { env: DEV_ENV });
    await expect(adapter.searchHotels(searchParams)).rejects.toMatchObject({ reason: "not_active" });
  });
});

describe("invalid configuration fails closed", () => {
  it("logs the detailed config error server-side but exposes only a generic, non-retryable error to callers", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const searchHotels = vi.fn();
    const context = { ...defaultActivationContext(DEV_ENV), adapters: { mock: createFixtureAdapter({ code: "mock", searchHotels }) } };
    try {
      const adapter = getOperationalHotelProviderAdapter(
        { code: "mock", status: "ACTIVE" },
        { context, env: { HOTEL_PROVIDER_MAX_ATTEMPTS: "0.5" } },
      );

      const err = await adapter.searchHotels(searchParams).catch((e: unknown) => e);

      expect(err).toBeInstanceOf(HotelProviderNotOperationalError);
      const notOperational = err as HotelProviderNotOperationalError;
      expect(notOperational.reason).toBe("invalid_configuration");
      expect(notOperational.retryable).toBe(false);
      // The caller-facing message carries no variable name or value...
      expect(notOperational.message).not.toContain("HOTEL_PROVIDER_MAX_ATTEMPTS");
      expect(notOperational.message).not.toContain("0.5");
      // ...but the full detail is available internally, via `cause` and the log.
      expect(String((notOperational.cause as Error).message)).toContain('HOTEL_PROVIDER_MAX_ATTEMPTS="0.5"');
      expect(errorLog).toHaveBeenCalledWith(expect.objectContaining({ name: "HotelProviderConfigError" }));
      expect(searchHotels).not.toHaveBeenCalled();
    } finally {
      errorLog.mockRestore();
    }
  });
});
