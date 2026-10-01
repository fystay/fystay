import { afterEach, describe, expect, it, vi } from "vitest";
import { isAuthorizedCronRequest } from "./cronAuth";

const req = (headers: Record<string, string>) => new Request("http://x/api/cron/job", { headers });

afterEach(() => vi.unstubAllEnvs());

describe("isAuthorizedCronRequest", () => {
  it("does not trust the spoofable x-vercel-cron header", () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    expect(isAuthorizedCronRequest(req({ "x-vercel-cron": "1" }))).toBe(false);
  });

  it("accepts Vercel's CRON_SECRET bearer token", () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    expect(isAuthorizedCronRequest(req({ authorization: "Bearer s3cret" }))).toBe(true);
    expect(isAuthorizedCronRequest(req({ authorization: "Bearer wrong" }))).toBe(false);
  });

  it("accepts the route's own secret for manual runs", () => {
    vi.stubEnv("CRON_SECRET", "");
    expect(isAuthorizedCronRequest(req({ authorization: "Bearer route" }), "route")).toBe(true);
  });

  it("refuses everything when no secret is configured", () => {
    vi.stubEnv("CRON_SECRET", "");
    expect(isAuthorizedCronRequest(req({ authorization: "Bearer " }), undefined)).toBe(false);
    expect(isAuthorizedCronRequest(req({ authorization: "Bearer undefined" }))).toBe(false);
  });
});
