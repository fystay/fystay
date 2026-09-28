import type { HotelProviderAdapter, ProviderNotOperationalReason } from "@/lib/hotelProviders/types";
import { HotelProviderNotOperationalError } from "@/lib/hotelProviders/types";
import { mockHotelProviderAdapter } from "@/lib/hotelProviders/providers/mock";
import { bookingComAdapter } from "@/lib/hotelProviders/providers/bookingCom";
import { withResilientAdapter } from "@/lib/hotelProviders/resilience";
import { withCachedAdapter } from "@/lib/hotelProviders/cache";
import { resolveHotelProviderConfig } from "@/lib/hotelProviders/config";
import { isProductionDeployment, type EnvSource } from "@/lib/deploymentEnvironment";

/**
 * Every hotel provider this app knows how to talk to, keyed by
 * HotelProvider.code. Adding a provider later (Expedia, Hotelbeds) is a new
 * file in providers/ plus one entry here - and it starts out NOT operational
 * until its code is also added to LIVE_HOTEL_PROVIDER_CODES below.
 */
const ADAPTERS: Readonly<Record<string, HotelProviderAdapter>> = Object.freeze({
  mock: mockHotelProviderAdapter,
  booking_com: bookingComAdapter,
});

/**
 * Providers that serve dev/demo fixture data rather than real inventory.
 * They may operate in development and preview, never on a production
 * deployment - production must never show fake hotels to real guests.
 */
export const FIXTURE_HOTEL_PROVIDER_CODES: readonly string[] = Object.freeze(["mock"]);

/**
 * External (real) providers that have been explicitly authorised to serve
 * traffic. Enforced at runtime by evaluateProviderActivation below: an
 * external provider not listed here is refused even when its HotelProvider
 * row is ACTIVE and its credentials are set. Adding a code here is a
 * deliberate code change and deploy - see
 * docs/hotel-provider-integration-runbook.md for what must be true first.
 * Frozen so nothing can add to it at runtime.
 */
export const LIVE_HOTEL_PROVIDER_CODES: readonly string[] = Object.freeze([]);

export type ProviderActivationContext = {
  adapters: Readonly<Record<string, HotelProviderAdapter>>;
  fixtureCodes: readonly string[];
  liveCodes: readonly string[];
  isProduction: boolean;
};

export type ProviderActivationDecision =
  | { operational: true }
  | { operational: false; reason: ProviderNotOperationalReason };

export function defaultActivationContext(env: EnvSource = process.env): ProviderActivationContext {
  return {
    adapters: ADAPTERS,
    fixtureCodes: FIXTURE_HOTEL_PROVIDER_CODES,
    liveCodes: LIVE_HOTEL_PROVIDER_CODES,
    isProduction: isProductionDeployment(env),
  };
}

/**
 * THE provider activation rule - the single place that decides whether a
 * provider may serve traffic. Every provider call in the app goes through
 * getOperationalHotelProviderAdapter below, which enforces this at runtime.
 *
 *   1. Its code must have a registered adapter.
 *   2. Its HotelProvider row must be ACTIVE (INACTIVE/COMING_SOON never operate).
 *   3. A fixture provider (mock) operates only outside production.
 *   4. An external provider operates only if listed in LIVE_HOTEL_PROVIDER_CODES.
 *   5. Once operational, the adapter still enforces its own readiness (e.g.
 *      booking_com throws until credentials and confirmed endpoints exist).
 *
 * Credentials alone never make a provider operational.
 */
export function evaluateProviderActivation(
  provider: { code: string; status: string },
  context: ProviderActivationContext = defaultActivationContext(),
): ProviderActivationDecision {
  if (!Object.hasOwn(context.adapters, provider.code)) return { operational: false, reason: "not_registered" };
  if (provider.status !== "ACTIVE") return { operational: false, reason: "not_active" };
  if (context.fixtureCodes.includes(provider.code)) {
    return context.isProduction ? { operational: false, reason: "fixture_in_production" } : { operational: true };
  }
  return context.liveCodes.includes(provider.code)
    ? { operational: true }
    : { operational: false, reason: "not_live_listed" };
}

/** An adapter whose every method refuses - returned for any provider that fails the rule above. */
function lockedAdapter(code: string, reason: ProviderNotOperationalReason, cause?: unknown): HotelProviderAdapter {
  const refuse = () => new HotelProviderNotOperationalError(code, reason, cause);
  return {
    code,
    name: code,
    supportsSearch: false,
    supportsDeepLink: false,
    supportsClickTracking: false,
    supportsConversionTracking: false,
    searchHotels: async () => {
      throw refuse();
    },
    getHotelDetails: async () => {
      throw refuse();
    },
    getAvailability: async () => {
      throw refuse();
    },
    createDeepLink: () => {
      throw refuse();
    },
  };
}

/**
 * The runtime enforcement point: the only way app code obtains a provider
 * adapter. Takes the provider's database row (code + status), applies
 * evaluateProviderActivation, and returns either:
 *   - a locked adapter whose methods throw HotelProviderNotOperationalError
 *     (the real adapter is never touched), or
 *   - the real adapter wrapped in caching(resilience(...)) - cache outermost,
 *     so a cache hit never reaches the timeout/retry layer.
 *
 * Invalid tuning configuration (config.ts) also fails closed here: the full
 * detail is logged server-side and the adapter is locked with reason
 * "invalid_configuration", so the guest sees only the generic unavailable
 * state.
 */
export function getOperationalHotelProviderAdapter(
  provider: { code: string; status: string },
  options: { context?: ProviderActivationContext; env?: EnvSource } = {},
): HotelProviderAdapter {
  const env = options.env ?? process.env;
  const context = options.context ?? defaultActivationContext(env);

  const decision = evaluateProviderActivation(provider, context);
  if (!decision.operational) return lockedAdapter(provider.code, decision.reason);

  let config;
  try {
    config = resolveHotelProviderConfig(env);
  } catch (err) {
    console.error(err);
    return lockedAdapter(provider.code, "invalid_configuration", err);
  }

  const adapter = context.adapters[provider.code];
  return withCachedAdapter(withResilientAdapter(adapter, config.resilience), config.cache);
}
