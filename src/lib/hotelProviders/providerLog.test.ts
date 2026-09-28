import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockCaptureMessage = vi.fn();
vi.mock("@sentry/nextjs", () => ({ captureMessage: (...args: unknown[]) => mockCaptureMessage(...args) }));

const { logProviderFailure, logHotelProviderEvent, classifyProviderFailure } = await import(
  "@/lib/hotelProviders/providerLog"
);
const {
  HotelProviderAdapterError,
  HotelProviderInvalidResponseError,
  HotelProviderNotOperationalError,
  HotelProviderTimeoutError,
} = await import("@/lib/hotelProviders/types");

/** Strings planted in every place a careless logger might leak from. None may ever reach a log line. */
const SECRET_BITS = [
  "api_key=sk_live_SECRET",
  "guest@example.com",
  "Bearer eyJhbGciOi",
  '{"rawProviderPayload":true}',
  "stack-frame-marker",
];

function errorCarryingSecrets(): InstanceType<typeof HotelProviderAdapterError> {
  const error = new HotelProviderAdapterError(`Upstream said ${SECRET_BITS[0]} for ${SECRET_BITS[1]}`, {
    retryable: false,
    statusCode: 502,
    cause: new Error(`${SECRET_BITS[2]} ${SECRET_BITS[3]}`),
  });
  error.stack = SECRET_BITS[4];
  return error;
}

let warnSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  mockCaptureMessage.mockReset();
});

afterEach(() => {
  warnSpy.mockRestore();
  errorSpy.mockRestore();
});

function onlyLine(spy: ReturnType<typeof vi.spyOn>): Record<string, unknown> {
  expect(spy).toHaveBeenCalledTimes(1);
  const [line] = spy.mock.calls[0];
  expect(typeof line).toBe("string");
  return JSON.parse(line as string);
}

function allLoggedText(): string {
  return [...warnSpy.mock.calls, ...errorSpy.mock.calls, ...mockCaptureMessage.mock.calls]
    .map((call) => JSON.stringify(call))
    .join("\n");
}

describe("logProviderFailure", () => {
  it("emits exactly one JSON line with only the documented keys", () => {
    logProviderFailure({
      operation: "availability",
      providerCode: "mock",
      error: new HotelProviderTimeoutError(4000),
      durationMs: 10012,
      externalId: "mock-london-3",
    });
    const record = onlyLine(warnSpy);
    expect(errorSpy).not.toHaveBeenCalled();
    expect(Object.keys(record).sort()).toEqual(
      ["durationMs", "errorName", "event", "externalId", "operation", "outcome", "providerCode", "retryable", "statusCode"].sort(),
    );
    expect(record).toMatchObject({
      event: "hotel_provider.call_failed",
      operation: "availability",
      providerCode: "mock",
      outcome: "timeout",
      errorName: "HotelProviderTimeoutError",
      retryable: true,
      statusCode: null,
      durationMs: 10012,
      externalId: "mock-london-3",
    });
  });

  it("never logs an error's message, cause or stack - a planted secret, email, token or payload never appears", () => {
    logProviderFailure({ operation: "search", providerCode: "mock", error: errorCarryingSecrets(), durationMs: 5 });
    const text = allLoggedText();
    for (const bit of SECRET_BITS) expect(text).not.toContain(bit);
    const record = onlyLine(errorSpy);
    expect(record).not.toHaveProperty("message");
    expect(record).not.toHaveProperty("cause");
    expect(record).not.toHaveProperty("stack");
    expect(record.statusCode).toBe(502);
  });

  it("logs expected outcomes as warnings: timeouts, retryable errors and non-operational providers", () => {
    logProviderFailure({ operation: "search", providerCode: "mock", error: new HotelProviderTimeoutError(10) });
    logProviderFailure({
      operation: "search",
      providerCode: "mock",
      error: new HotelProviderAdapterError("503", { retryable: true, statusCode: 503 }),
    });
    logProviderFailure({
      operation: "details",
      providerCode: "booking_com",
      error: new HotelProviderNotOperationalError("booking_com", "not_live_listed"),
    });
    expect(warnSpy).toHaveBeenCalledTimes(3);
    expect(errorSpy).not.toHaveBeenCalled();
    const notOperational = JSON.parse(warnSpy.mock.calls[2][0] as string);
    expect(notOperational).toMatchObject({ outcome: "not_operational", reason: "not_live_listed" });
  });

  it("does not leak an invalid-configuration cause (env var names/values) through a not-operational error", () => {
    const cause = new Error('HOTEL_PROVIDER_TIMEOUT_MS="abc" is not a positive whole number');
    logProviderFailure({
      operation: "search",
      providerCode: "mock",
      error: new HotelProviderNotOperationalError("mock", "invalid_configuration", cause),
    });
    expect(allLoggedText()).not.toContain("HOTEL_PROVIDER_TIMEOUT_MS");
    expect(onlyLine(warnSpy)).toMatchObject({ reason: "invalid_configuration" });
  });

  it("logs a malformed response as an error with issue paths/codes only, and reports it to Sentry with the same sanitised fields", () => {
    const error = new HotelProviderInvalidResponseError("search", [
      { path: "[2].priceCents", code: "too_small" },
      { path: "[4].primaryPhotoUrl", code: "invalid_format" },
    ]);
    logProviderFailure({ operation: "search", providerCode: "mock", error, durationMs: 40 });
    const record = onlyLine(errorSpy);
    expect(record).toMatchObject({
      outcome: "invalid_response",
      retryable: false,
      issues: [
        { path: "[2].priceCents", code: "too_small" },
        { path: "[4].primaryPhotoUrl", code: "invalid_format" },
      ],
    });
    expect(mockCaptureMessage).toHaveBeenCalledTimes(1);
    const [message, context] = mockCaptureMessage.mock.calls[0];
    expect(message).toBe("hotel_provider.invalid_response");
    expect(context).toEqual({ level: "error", extra: { ...record, event: undefined } });
  });

  it("only reports malformed responses to Sentry - timeouts and other failures are log-only", () => {
    logProviderFailure({ operation: "search", providerCode: "mock", error: new HotelProviderTimeoutError(10) });
    logProviderFailure({ operation: "search", providerCode: "mock", error: errorCarryingSecrets() });
    expect(mockCaptureMessage).not.toHaveBeenCalled();
  });
});

describe("classifyProviderFailure", () => {
  it("maps each error class to its outcome", () => {
    expect(classifyProviderFailure(new HotelProviderTimeoutError(1))).toBe("timeout");
    expect(classifyProviderFailure(new HotelProviderNotOperationalError("x", "not_active"))).toBe("not_operational");
    expect(classifyProviderFailure(new HotelProviderInvalidResponseError("details", []))).toBe("invalid_response");
    expect(classifyProviderFailure(new HotelProviderAdapterError("x", { retryable: false }))).toBe("adapter_error");
  });
});

describe("logHotelProviderEvent", () => {
  it("drops undefined fields and truncates long strings", () => {
    logHotelProviderEvent("warn", "hotel_provider.test", { a: "x".repeat(1000), b: undefined, c: 3 });
    const record = onlyLine(warnSpy);
    expect(record.event).toBe("hotel_provider.test");
    expect((record.a as string).length).toBe(256);
    expect(record).not.toHaveProperty("b");
    expect(record.c).toBe(3);
  });
});
