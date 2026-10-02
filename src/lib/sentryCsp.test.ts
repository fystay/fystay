import { describe, expect, it } from "vitest";
import { sentryIngestOrigin } from "./sentryCsp";

describe("sentryIngestOrigin", () => {
  it("returns just the ingest origin, never the key or project", () => {
    expect(sentryIngestOrigin("https://abc123@o1.ingest.de.sentry.io/456")).toBe("https://o1.ingest.de.sentry.io");
  });

  it("adds nothing without a usable https DSN", () => {
    expect(sentryIngestOrigin(undefined)).toBeNull();
    expect(sentryIngestOrigin("")).toBeNull();
    expect(sentryIngestOrigin("not a url")).toBeNull();
    expect(sentryIngestOrigin("http://abc@o1.ingest.sentry.io/1")).toBeNull();
  });
});
