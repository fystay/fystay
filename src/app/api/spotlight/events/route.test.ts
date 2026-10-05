import { beforeEach, describe, expect, it, vi } from "vitest";

const record = vi.fn();
const rateLimit = vi.fn();

vi.mock("@/lib/rateLimit", () => ({
  checkRateLimit: (...a: unknown[]) => rateLimit(...a),
  clientIp: () => "203.0.113.9",
}));
vi.mock("@/lib/spotlightStats", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/spotlightStats")>()),
  recordSpotlightEvent: (...a: unknown[]) => record(...a),
}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { POST } from "./route";

const BROWSER = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 Chrome/130.0 Safari/537.36";

const call = (body: string, userAgent = BROWSER) =>
  POST(
    new Request("http://x/api/spotlight/events", {
      method: "POST",
      headers: { "content-type": "text/plain;charset=UTF-8", "user-agent": userAgent },
      body,
    }),
  );

beforeEach(() => {
  record.mockReset().mockResolvedValue("counted");
  rateLimit.mockReset().mockResolvedValue({ allowed: true, remaining: 10, resetAt: new Date() });
});

describe("POST /api/spotlight/events", () => {
  it("records an event from a browser's beacon, keyed by a hashed visitor", async () => {
    const res = await call(JSON.stringify({ promotionId: "promo_1", type: "impression" }));
    expect(res.status).toBe(204);
    expect(record).toHaveBeenCalledWith({ promotionId: "promo_1", type: "impression", visitor: expect.any(String) });
    expect(record.mock.calls[0][0].visitor).not.toContain("203.0.113.9");
  });

  it("rejects an unknown event type or a malformed body", async () => {
    expect((await call(JSON.stringify({ promotionId: "promo_1", type: "booking" }))).status).toBe(400);
    expect((await call("not json")).status).toBe(400);
    expect(record).not.toHaveBeenCalled();
  });

  it("ignores crawlers without saying so", async () => {
    const res = await call(JSON.stringify({ promotionId: "promo_1", type: "click" }), "Googlebot/2.1");
    expect(res.status).toBe(204);
    expect(record).not.toHaveBeenCalled();
  });

  it("stops counting a visitor sending far more events than browsing produces", async () => {
    rateLimit.mockResolvedValue({ allowed: false, remaining: 0, resetAt: new Date() });
    const res = await call(JSON.stringify({ promotionId: "promo_1", type: "impression" }));
    expect(res.status).toBe(204);
    expect(record).not.toHaveBeenCalled();
  });
});
