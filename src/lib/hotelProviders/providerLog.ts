import * as Sentry from "@sentry/nextjs";
import {
  HotelProviderInvalidResponseError,
  HotelProviderNotOperationalError,
  HotelProviderTimeoutError,
  type HotelProviderAdapterError,
  type ProviderResponseIssue,
} from "@/lib/hotelProviders/types";

/**
 * Structured, privacy-safe logging for hotel-provider failures. Every
 * provider catch path (search, hotel details, availability, deep link)
 * reports through logProviderFailure, so an outage, a timeout storm or a
 * provider breaking its contract is visible in the deployment logs instead
 * of silently turning into the guest's generic "unavailable" state.
 *
 * Each record is one JSON line built only from the named fields below -
 * never by spreading an error. In particular it never contains an error's
 * message, cause or stack (a future adapter could put a provider response
 * body in any of those), nor anything about the guest: no destination text,
 * dates, guest counts, user/session id, IP, cookie or deep-link URL.
 * `externalId` is the provider's own public hotel identifier, not personal
 * data.
 */

export type ProviderOperation = "search" | "details" | "availability" | "deep_link";

export type ProviderFailureOutcome = "timeout" | "not_operational" | "invalid_response" | "adapter_error";

type LogLevel = "warn" | "error";

type LogValue = string | number | boolean | null | readonly ProviderResponseIssue[];

const MAX_FIELD_LENGTH = 256;

function bounded(value: string): string {
  return value.length > MAX_FIELD_LENGTH ? value.slice(0, MAX_FIELD_LENGTH) : value;
}

/** Emits one structured JSON line. Fields must be primitives (or validation issues) - callers never pass objects from a provider. */
export function logHotelProviderEvent(level: LogLevel, event: string, fields: Record<string, LogValue | undefined>): void {
  const record: Record<string, LogValue> = { event };
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    record[key] = typeof value === "string" ? bounded(value) : value;
  }
  const line = JSON.stringify(record);
  if (level === "error") console.error(line);
  else console.warn(line);
}

export function classifyProviderFailure(error: HotelProviderAdapterError): ProviderFailureOutcome {
  if (error instanceof HotelProviderTimeoutError) return "timeout";
  if (error instanceof HotelProviderNotOperationalError) return "not_operational";
  if (error instanceof HotelProviderInvalidResponseError) return "invalid_response";
  return "adapter_error";
}

/**
 * Logs one provider call that ended in a HotelProviderAdapterError. Expected,
 * transient or configuration-state outcomes (timeouts, retryable errors, a
 * provider that isn't operational) are warnings; a non-retryable provider
 * error or a malformed response is an error. A malformed response is also
 * reported to Sentry (a no-op without SENTRY_DSN) - it means a provider broke
 * its contract, which should alert rather than wait to be noticed in logs.
 */
export function logProviderFailure(input: {
  operation: ProviderOperation;
  providerCode: string;
  error: HotelProviderAdapterError;
  durationMs?: number;
  externalId?: string;
}): void {
  const { error } = input;
  const outcome = classifyProviderFailure(error);
  const fields = {
    operation: input.operation,
    providerCode: input.providerCode,
    outcome,
    errorName: error.name,
    retryable: error.retryable,
    statusCode: error.statusCode ?? null,
    reason: error instanceof HotelProviderNotOperationalError ? error.reason : undefined,
    issues: error instanceof HotelProviderInvalidResponseError ? error.issues : undefined,
    durationMs: input.durationMs,
    externalId: input.externalId,
  };
  const level: LogLevel =
    outcome === "invalid_response" || (outcome === "adapter_error" && !error.retryable) ? "error" : "warn";
  logHotelProviderEvent(level, "hotel_provider.call_failed", fields);

  if (outcome === "invalid_response") {
    const extra: Record<string, LogValue> = {};
    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined) extra[key] = value;
    }
    Sentry.captureMessage("hotel_provider.invalid_response", { level: "error", extra });
  }
}
