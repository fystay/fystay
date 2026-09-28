import type { EnvSource } from "@/lib/deploymentEnvironment";

/**
 * Every tunable for the hotel-provider execution layer (resilience.ts,
 * cache.ts), read and strictly validated in one place. An unset or empty
 * variable uses its default; anything else must be a plain positive integer
 * inside its documented range, or resolveHotelProviderConfig throws a
 * HotelProviderConfigError. registry.ts catches that, logs the full detail
 * server-side, and fails the provider call closed - the guest only ever sees
 * the generic "unavailable" state, never a variable name or value.
 */

export class HotelProviderConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HotelProviderConfigError";
  }
}

export type ResilienceConfig = {
  /** Cap on a single attempt. Always further capped by whatever remains of totalBudgetMs. */
  timeoutMs: number;
  /** Total attempts including the first. Only retryable failures use another one. */
  maxAttempts: number;
  /** Hard ceiling on one provider call across every attempt and backoff. Always wins. */
  totalBudgetMs: number;
  /** Delay before the first retry; doubles per retry, capped at maxDelayMs. */
  baseDelayMs: number;
  maxDelayMs: number;
  /** A retry only starts if at least this much budget would remain for it after its backoff. */
  minAttemptMs: number;
};

export type CacheTtlConfig = {
  searchTtlMs: number;
  availabilityTtlMs: number;
};

export type HotelProviderRuntimeConfig = {
  resilience: ResilienceConfig;
  cache: CacheTtlConfig;
};

type IntSetting = { name: string; defaultValue: number; min: number; max: number };

const TIMEOUT: IntSetting = { name: "HOTEL_PROVIDER_TIMEOUT_MS", defaultValue: 4000, min: 100, max: 60_000 };
const MAX_ATTEMPTS: IntSetting = { name: "HOTEL_PROVIDER_MAX_ATTEMPTS", defaultValue: 3, min: 1, max: 10 };
const TOTAL_BUDGET: IntSetting = { name: "HOTEL_PROVIDER_TOTAL_BUDGET_MS", defaultValue: 10_000, min: 100, max: 120_000 };
const SEARCH_TTL: IntSetting = { name: "HOTEL_SEARCH_CACHE_TTL_MS", defaultValue: 5 * 60 * 1000, min: 1000, max: 86_400_000 };
const AVAILABILITY_TTL: IntSetting = { name: "HOTEL_AVAILABILITY_CACHE_TTL_MS", defaultValue: 60 * 1000, min: 1000, max: 86_400_000 };

function readInt(env: EnvSource, setting: IntSetting): number {
  const raw = env[setting.name]?.trim();
  if (!raw) return setting.defaultValue;
  if (!/^\d+$/.test(raw)) {
    throw new HotelProviderConfigError(
      `${setting.name}="${env[setting.name]}" is not a positive whole number (allowed: ${setting.min}-${setting.max}).`,
    );
  }
  const value = Number(raw);
  if (value < setting.min || value > setting.max) {
    throw new HotelProviderConfigError(
      `${setting.name}=${value} is out of range (allowed: ${setting.min}-${setting.max}).`,
    );
  }
  return value;
}

export function resolveHotelProviderConfig(env: EnvSource = process.env): HotelProviderRuntimeConfig {
  const timeoutMs = readInt(env, TIMEOUT);
  const totalBudgetMs = readInt(env, TOTAL_BUDGET);
  if (totalBudgetMs < timeoutMs) {
    throw new HotelProviderConfigError(
      `${TOTAL_BUDGET.name}=${totalBudgetMs} must be at least ${TIMEOUT.name}=${timeoutMs}.`,
    );
  }
  return {
    resilience: {
      timeoutMs,
      maxAttempts: readInt(env, MAX_ATTEMPTS),
      totalBudgetMs,
      baseDelayMs: 200,
      maxDelayMs: 2000,
      minAttemptMs: 250,
    },
    cache: {
      searchTtlMs: readInt(env, SEARCH_TTL),
      availabilityTtlMs: readInt(env, AVAILABILITY_TTL),
    },
  };
}
