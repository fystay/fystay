import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
};

// Comfortably longer than the longest windowMs any call site actually uses
// today (signup's 1 hour) - a row this old is stale under every window in
// use, never one still being actively counted against.
const STALE_ROW_AGE_MS = 24 * 60 * 60 * 1000;
// No background job runner (see completePastBookings in bookingLifecycle.ts
// for the same reasoning elsewhere), so instead of a cron job, every write
// to this table has a small independent chance of also sweeping out rows
// nothing will ever read again - cheap enough to skip most of the time
// without ever letting the table grow unbounded.
const PRUNE_PROBABILITY = 0.05;

async function maybePruneStaleRows(now: Date): Promise<void> {
  if (Math.random() >= PRUNE_PROBABILITY) return;
  const staleBefore = new Date(now.getTime() - STALE_ROW_AGE_MS);
  await prisma.$executeRaw`DELETE FROM "RateLimitHit" WHERE "windowStart" < ${staleBefore}`;
}

/**
 * Gives back one hit counted by checkRateLimit, for a request that turned
 * out to cost nothing (e.g. the provider refused it), so the cap counts
 * only attempts that actually happened.
 */
export async function releaseRateLimitHit(key: string): Promise<void> {
  await prisma.$executeRaw`UPDATE "RateLimitHit" SET "count" = "count" - 1 WHERE "key" = ${key} AND "count" > 0`;
}

/**
 * A fixed-window request counter backed by Postgres, not an in-memory Map -
 * FYStay runs as short-lived serverless functions (Vercel), each with its
 * own process memory, so an in-process counter would reset on every cold
 * start and wouldn't actually stop anything, let alone agree across
 * concurrent instances. The upsert below is a single atomic statement (one
 * row, one round trip): two concurrent requests for the same key can't both
 * read a stale count and both be let through, the way a separate
 * read-then-write would allow.
 *
 * A window "resets" the first time it's hit after windowMs has elapsed
 * since it started, rather than on a wall-clock boundary - simpler than a
 * sliding log, and precise enough for abuse protection on a handful of
 * auth-adjacent endpoints.
 */
export async function checkRateLimit(params: {
  key: string;
  limit: number;
  windowMs: number;
  now?: Date;
}): Promise<RateLimitResult> {
  const { key, limit, windowMs, now = new Date() } = params;
  const staleBefore = new Date(now.getTime() - windowMs);

  const rows = await prisma.$queryRaw<{ count: number; windowStart: Date }[]>`
    INSERT INTO "RateLimitHit" ("key", "windowStart", "count")
    VALUES (${key}, ${now}, 1)
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE
        WHEN "RateLimitHit"."windowStart" <= ${staleBefore} THEN 1
        ELSE "RateLimitHit"."count" + 1
      END,
      "windowStart" = CASE
        WHEN "RateLimitHit"."windowStart" <= ${staleBefore} THEN ${now}
        ELSE "RateLimitHit"."windowStart"
      END
    RETURNING "count", "windowStart"
  `;
  await maybePruneStaleRows(now);

  const row = rows[0];
  return {
    allowed: row.count <= limit,
    remaining: Math.max(0, limit - row.count),
    resetAt: new Date(row.windowStart.getTime() + windowMs),
  };
}

/**
 * Read-only version of the same fixed window, for call sites where only
 * *failures* should count against the limit (see recordFailedAttempt/
 * resetRateLimit below) but the limit still needs enforcing before doing
 * any real work. Never creates or touches a row - a key with no rows yet
 * is simply under the limit.
 */
export async function peekRateLimit(params: {
  key: string;
  limit: number;
  windowMs: number;
  now?: Date;
}): Promise<RateLimitResult> {
  const { key, limit, windowMs, now = new Date() } = params;
  const staleBefore = new Date(now.getTime() - windowMs);

  const rows = await prisma.$queryRaw<{ count: number; windowStart: Date }[]>`
    SELECT "count", "windowStart" FROM "RateLimitHit" WHERE "key" = ${key}
  `;
  const row = rows[0];
  if (!row || row.windowStart <= staleBefore) {
    return { allowed: true, remaining: limit, resetAt: new Date(now.getTime() + windowMs) };
  }
  return {
    allowed: row.count < limit,
    remaining: Math.max(0, limit - row.count),
    resetAt: new Date(row.windowStart.getTime() + windowMs),
  };
}

/**
 * Increments the same counter as checkRateLimit, but without a limit to
 * compare against - for call sites (login) where success and failure need
 * different treatment: check with peekRateLimit before doing any real work,
 * call this only once the attempt has been confirmed to fail, and call
 * resetRateLimit on success. Counting every attempt regardless of outcome
 * (the plain checkRateLimit above) would lock out a real user simply for
 * logging in from several devices in the same session - only a run of
 * actual failures should ever cost someone their own next login.
 */
export async function recordFailedAttempt(params: {
  key: string;
  windowMs: number;
  now?: Date;
}): Promise<void> {
  const { key, windowMs, now = new Date() } = params;
  const staleBefore = new Date(now.getTime() - windowMs);

  await prisma.$executeRaw`
    INSERT INTO "RateLimitHit" ("key", "windowStart", "count")
    VALUES (${key}, ${now}, 1)
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE
        WHEN "RateLimitHit"."windowStart" <= ${staleBefore} THEN 1
        ELSE "RateLimitHit"."count" + 1
      END,
      "windowStart" = CASE
        WHEN "RateLimitHit"."windowStart" <= ${staleBefore} THEN ${now}
        ELSE "RateLimitHit"."windowStart"
      END
  `;
  await maybePruneStaleRows(now);
}

/** Clears a key's counter entirely - e.g. a successful login wiping out a string of earlier failed attempts, so they can't count against a future one. */
export async function resetRateLimit(key: string): Promise<void> {
  await prisma.$executeRaw`DELETE FROM "RateLimitHit" WHERE "key" = ${key}`;
}

/** The client's IP as reported by the platform's proxy (Vercel sets this on every request). Falls back to a single shared bucket if it's missing, e.g. in local development. */
export function clientIp(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  return forwardedFor?.split(",")[0]?.trim() || "unknown";
}

export function rateLimitedResponse(result: RateLimitResult): NextResponse {
  const retryAfterSeconds = Math.max(1, Math.ceil((result.resetAt.getTime() - Date.now()) / 1000));
  return NextResponse.json(
    { error: "Too many attempts. Please try again later." },
    { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } },
  );
}
