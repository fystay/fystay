import { afterEach, describe, expect, it, vi } from "vitest";
import { PmsAdapterError, pmsErrorForHost } from "./types";

describe("pmsErrorForHost", () => {
  afterEach(() => vi.restoreAllMocks());
  const quiet = () => vi.spyOn(console, "error").mockImplementation(() => {});

  it("never shows a host the provider's raw response or a configuration variable", () => {
    quiet();
    const raw = new PmsAdapterError('Cloudbeds API error (400): {"error":"invalid_grant","trace":"abc"}', {
      retryable: false,
      statusCode: 400,
    });
    const config = new PmsAdapterError("Cloudbeds is not configured - CLOUDBEDS_CLIENT_ID/CLOUDBEDS_CLIENT_SECRET are unset.", {
      retryable: false,
    });
    for (const message of [pmsErrorForHost(raw, "We couldn't load your rooms."), pmsErrorForHost(config, "x")]) {
      expect(message).not.toMatch(/Cloudbeds API|invalid_grant|CLOUDBEDS_|\(\d{3}\)/);
    }
    expect(pmsErrorForHost(raw, "We couldn't load your rooms.")).toBe("We couldn't load your rooms.");
    expect(pmsErrorForHost(config, "x")).toMatch(/isn't available yet/);
  });

  it("tells the host what to do for a refused connection or an outage", () => {
    quiet();
    expect(pmsErrorForHost(new PmsAdapterError("401", { retryable: false, statusCode: 401 }), "x")).toMatch(/connect your account again/);
    expect(pmsErrorForHost(new PmsAdapterError("503", { retryable: true, statusCode: 503 }), "x")).toMatch(/try again in a few minutes/);
  });

  it("logs the technical detail for FYStay", () => {
    const log = quiet();
    const error = new PmsAdapterError("Cloudbeds API error (500): boom", { retryable: true, statusCode: 500 });
    pmsErrorForHost(error, "x");
    expect(log).toHaveBeenCalledWith(expect.any(String), error);
  });
});
