import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rateLimit";
import { liveSpotlightWhere } from "@/lib/listingPromotions";

/**
 * How Spotlight placements perform: the homepage showcase reports each time
 * a placement's slide is shown to a visitor ("impression") and each time it
 * is clicked through to the listing ("click"), and hosts see the totals for
 * what they paid for (/host/promote). Stored as one counter row per
 * placement per UTC day (ListingPromotionStat) - never anything about who
 * saw it.
 *
 * The counts are only worth showing a paying host if they can't be padded,
 * so an event is counted only when:
 * - the placement is live right now (an ended, unpaid or made-up id counts
 *   nothing),
 * - it doesn't come from a crawler or link-preview bot, and
 * - the same visitor hasn't already been counted for the same placement and
 *   event in the last VISITOR_DEDUPE_WINDOW_MS - so refreshing the page, or
 *   the showcase looping back round, doesn't count again.
 * A visitor is their IP address, hashed before it's used as a key, so no
 * address is stored.
 */

export const SPOTLIGHT_EVENT_TYPES = ["impression", "click"] as const;
export type SpotlightEventType = (typeof SPOTLIGHT_EVENT_TYPES)[number];

export const VISITOR_DEDUPE_WINDOW_MS = 30 * 60 * 1000;

// Crawlers and link unfurlers that fetch pages without a person looking at
// them. Headless browsers aren't listed: a real person's browser can report
// itself that way, and the per-visitor limit already bounds automated use.
const BOT_USER_AGENT = /bot|crawl|spider|slurp|facebookexternalhit|embedly|preview|monitor|curl|wget|python-requests/i;

export function isLikelyBot(userAgent: string | null): boolean {
  return !userAgent || BOT_USER_AGENT.test(userAgent);
}

/** A stable, non-reversible key for one visitor, from their IP address. */
export function visitorKey(ip: string): string {
  return createHash("sha256").update(`spotlight:${ip}`).digest("hex").slice(0, 24);
}

/** The UTC calendar day `now` falls on, as midnight UTC - the day a counter row belongs to. */
export function statDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export type SpotlightEventOutcome = "counted" | "not_live" | "duplicate";

export async function recordSpotlightEvent(params: {
  promotionId: string;
  type: SpotlightEventType;
  visitor: string;
  now?: Date;
}): Promise<SpotlightEventOutcome> {
  const { promotionId, type, visitor, now = new Date() } = params;

  const live = await prisma.listingPromotion.findFirst({
    where: { id: promotionId, ...liveSpotlightWhere(now) },
    select: { id: true },
  });
  if (!live) return "not_live";

  const firstInWindow = await checkRateLimit({
    key: `spotlight:${type}:${promotionId}:${visitor}`,
    limit: 1,
    windowMs: VISITOR_DEDUPE_WINDOW_MS,
    now,
  });
  if (!firstInWindow.allowed) return "duplicate";

  // One atomic statement, so two visitors counted at the same moment can't
  // both create today's row (or both read the same count and lose one).
  const day = statDay(now);
  const impressions = type === "impression" ? 1 : 0;
  const clicks = type === "click" ? 1 : 0;
  await prisma.$executeRaw`
    INSERT INTO "ListingPromotionStat" ("id", "promotionId", "day", "impressions", "clicks")
    VALUES (${`stat_${promotionId}_${day.toISOString().slice(0, 10)}`}, ${promotionId}, ${day}, ${impressions}, ${clicks})
    ON CONFLICT ("promotionId", "day") DO UPDATE SET
      "impressions" = "ListingPromotionStat"."impressions" + ${impressions},
      "clicks" = "ListingPromotionStat"."clicks" + ${clicks}
  `;
  return "counted";
}

export type SpotlightStats = { impressions: number; clicks: number };

/** Total impressions and clicks for each of the given placements (absent ones have none yet). */
export async function spotlightStatsFor(promotionIds: string[]): Promise<Map<string, SpotlightStats>> {
  if (promotionIds.length === 0) return new Map();
  const rows = await prisma.listingPromotionStat.groupBy({
    by: ["promotionId"],
    where: { promotionId: { in: promotionIds } },
    _sum: { impressions: true, clicks: true },
  });
  return new Map(
    rows.map((row) => [row.promotionId, { impressions: row._sum.impressions ?? 0, clicks: row._sum.clicks ?? 0 }]),
  );
}
