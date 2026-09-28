import { describe, expect, it } from "vitest";
import { HotelProviderConfigError, resolveHotelProviderConfig } from "./config";

describe("resolveHotelProviderConfig", () => {
  it("uses the agreed defaults when nothing is set", () => {
    expect(resolveHotelProviderConfig({})).toEqual({
      resilience: {
        timeoutMs: 4000,
        maxAttempts: 3,
        totalBudgetMs: 10_000,
        baseDelayMs: 200,
        maxDelayMs: 2000,
        minAttemptMs: 250,
      },
      cache: { searchTtlMs: 300_000, availabilityTtlMs: 60_000 },
    });
  });

  it("treats an empty or whitespace-only value as unset", () => {
    expect(resolveHotelProviderConfig({ HOTEL_PROVIDER_MAX_ATTEMPTS: "", HOTEL_PROVIDER_TIMEOUT_MS: "  " }).resilience)
      .toMatchObject({ maxAttempts: 3, timeoutMs: 4000 });
  });

  it("accepts valid overrides", () => {
    const config = resolveHotelProviderConfig({
      HOTEL_PROVIDER_TIMEOUT_MS: "2500",
      HOTEL_PROVIDER_MAX_ATTEMPTS: "2",
      HOTEL_PROVIDER_TOTAL_BUDGET_MS: "6000",
      HOTEL_SEARCH_CACHE_TTL_MS: "120000",
      HOTEL_AVAILABILITY_CACHE_TTL_MS: "30000",
    });
    expect(config.resilience).toMatchObject({ timeoutMs: 2500, maxAttempts: 2, totalBudgetMs: 6000 });
    expect(config.cache).toEqual({ searchTtlMs: 120_000, availabilityTtlMs: 30_000 });
  });

  it.each(["0.5", "1.5", "-1", "abc", "NaN", "Infinity", "3e2", "0x10", "0", "11"])(
    "rejects HOTEL_PROVIDER_MAX_ATTEMPTS=%s with a clear, deterministic error",
    (value) => {
      expect(() => resolveHotelProviderConfig({ HOTEL_PROVIDER_MAX_ATTEMPTS: value })).toThrow(HotelProviderConfigError);
      expect(() => resolveHotelProviderConfig({ HOTEL_PROVIDER_MAX_ATTEMPTS: value })).toThrow(/HOTEL_PROVIDER_MAX_ATTEMPTS/);
    },
  );

  it.each([
    ["HOTEL_PROVIDER_TIMEOUT_MS", "50"],
    ["HOTEL_PROVIDER_TIMEOUT_MS", "-4000"],
    ["HOTEL_PROVIDER_TOTAL_BUDGET_MS", "999999999"],
    ["HOTEL_SEARCH_CACHE_TTL_MS", "abc"],
    ["HOTEL_AVAILABILITY_CACHE_TTL_MS", "500"],
  ])("rejects %s=%s", (name, value) => {
    expect(() => resolveHotelProviderConfig({ [name]: value })).toThrow(HotelProviderConfigError);
  });

  it("rejects a total budget smaller than the per-attempt timeout", () => {
    expect(() =>
      resolveHotelProviderConfig({ HOTEL_PROVIDER_TIMEOUT_MS: "5000", HOTEL_PROVIDER_TOTAL_BUDGET_MS: "3000" }),
    ).toThrow(/must be at least/);
  });

  it("names the variable, the bad value and the allowed range in the (server-side) message", () => {
    expect(() => resolveHotelProviderConfig({ HOTEL_PROVIDER_MAX_ATTEMPTS: "0.5" })).toThrow(
      'HOTEL_PROVIDER_MAX_ATTEMPTS="0.5" is not a positive whole number (allowed: 1-10).',
    );
  });
});
