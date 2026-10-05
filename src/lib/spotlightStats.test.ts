import { beforeEach, describe, expect, it, vi } from "vitest";

const findFirst = vi.fn();
const executeRaw = vi.fn();
const groupBy = vi.fn();
const rateLimit = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    listingPromotion: { findFirst: (...a: unknown[]) => findFirst(...a) },
    listingPromotionStat: { groupBy: (...a: unknown[]) => groupBy(...a) },
    $executeRaw: (...a: unknown[]) => executeRaw(...a),
  },
}));
vi.mock("@/lib/rateLimit", () => ({ checkRateLimit: (...a: unknown[]) => rateLimit(...a) }));

import {
  isLikelyBot,
  recordSpotlightEvent,
  spotlightStatsFor,
  statDay,
  visitorKey,
  VISITOR_DEDUPE_WINDOW_MS,
} from "./spotlightStats";

const now = new Date("2026-10-05T23:30:00Z");

beforeEach(() => {
  findFirst.mockReset().mockResolvedValue({ id: "promo_1" });
  executeRaw.mockReset().mockResolvedValue(1);
  groupBy.mockReset();
  rateLimit.mockReset().mockResolvedValue({ allowed: true, remaining: 0, resetAt: now });
});

describe("recordSpotlightEvent", () => {
  it("counts an event for a live placement, once per visitor per window", async () => {
    expect(await recordSpotlightEvent({ promotionId: "promo_1", type: "impression", visitor: "v1", now })).toBe(
      "counted",
    );
    expect(rateLimit).toHaveBeenCalledWith({
      key: "spotlight:impression:promo_1:v1",
      limit: 1,
      windowMs: VISITOR_DEDUPE_WINDOW_MS,
      now,
    });
    expect(executeRaw).toHaveBeenCalledTimes(1);
  });

  it("only looks for the placement among live ones", async () => {
    await recordSpotlightEvent({ promotionId: "promo_1", type: "click", visitor: "v1", now });
    const where = findFirst.mock.calls[0][0].where;
    expect(where).toMatchObject({ id: "promo_1", status: "PAID", startsAt: { lte: now }, endsAt: { gt: now } });
  });

  it("counts nothing for a placement that isn't live (ended, unpaid or made up)", async () => {
    findFirst.mockResolvedValue(null);
    expect(await recordSpotlightEvent({ promotionId: "nope", type: "impression", visitor: "v1", now })).toBe(
      "not_live",
    );
    expect(rateLimit).not.toHaveBeenCalled();
    expect(executeRaw).not.toHaveBeenCalled();
  });

  it("doesn't count the same visitor twice inside the window", async () => {
    rateLimit.mockResolvedValue({ allowed: false, remaining: 0, resetAt: now });
    expect(await recordSpotlightEvent({ promotionId: "promo_1", type: "impression", visitor: "v1", now })).toBe(
      "duplicate",
    );
    expect(executeRaw).not.toHaveBeenCalled();
  });

  it("keeps impressions and clicks apart", async () => {
    await recordSpotlightEvent({ promotionId: "promo_1", type: "click", visitor: "v1", now });
    // Tagged-template call: [strings, id, promotionId, day, impressions, clicks, impressions, clicks].
    const values = executeRaw.mock.calls[0].slice(1);
    expect(values[1]).toBe("promo_1");
    expect(values[2]).toEqual(new Date("2026-10-05T00:00:00Z"));
    expect(values.slice(3)).toEqual([0, 1, 0, 1]);
    expect(rateLimit.mock.calls[0][0].key).toBe("spotlight:click:promo_1:v1");
  });
});

describe("helpers", () => {
  it("files an event under its UTC day", () => {
    expect(statDay(now)).toEqual(new Date("2026-10-05T00:00:00Z"));
    expect(statDay(new Date("2026-10-06T00:00:01Z"))).toEqual(new Date("2026-10-06T00:00:00Z"));
  });

  it("hashes the visitor's address rather than keeping it", () => {
    const key = visitorKey("203.0.113.9");
    expect(key).not.toContain("203.0.113.9");
    expect(key).toBe(visitorKey("203.0.113.9"));
    expect(key).not.toBe(visitorKey("203.0.113.10"));
  });

  it("recognises crawlers and link previews, but not ordinary browsers", () => {
    expect(isLikelyBot("Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)")).toBe(true);
    expect(isLikelyBot("facebookexternalhit/1.1")).toBe(true);
    expect(isLikelyBot(null)).toBe(true);
    expect(
      isLikelyBot("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Safari/604.1"),
    ).toBe(false);
  });

  it("totals each placement's days", async () => {
    groupBy.mockResolvedValue([{ promotionId: "promo_1", _sum: { impressions: 40, clicks: 3 } }]);
    const stats = await spotlightStatsFor(["promo_1", "promo_2"]);
    expect(stats.get("promo_1")).toEqual({ impressions: 40, clicks: 3 });
    expect(stats.get("promo_2")).toBeUndefined();
    expect(await spotlightStatsFor([])).toEqual(new Map());
  });
});
