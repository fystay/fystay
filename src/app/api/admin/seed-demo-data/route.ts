import { createHash, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { seedDemoData } from "@/lib/demoSeed";
import { isProductionSeedRefused } from "@/lib/productionSeedGuard";

/**
 * One-off: populates the demo host/guest/listings/reviews/trip-extras
 * dataset (the same content prisma/seed.ts uses for local dev) through
 * the app's own already-configured DATABASE_URL, for an environment
 * nobody has a direct database connection to.
 *
 * Gated by a shared secret (SEED_ADMIN_SECRET) rather than an ADMIN
 * session, since a freshly-provisioned database has no admin account to
 * sign in as yet - this is meant to be the very first write against it.
 * Fails closed if the env var isn't set, rather than falling open.
 *
 * GET (not just POST) so this can be triggered by visiting a URL - the
 * one time this app accepts a state-changing GET, matching the same
 * pragmatic pattern as an email-verification link, since the whole point
 * is a single manual trigger with nothing else able to reach this path
 * without the secret.
 *
 * Safe to call more than once - every write it makes is idempotent (see
 * src/lib/demoSeed.ts), so a repeat call just reports what already
 * existed instead of duplicating rows.
 */
async function handle(request: Request) {
  const expected = process.env.SEED_ADMIN_SECRET;
  if (!expected) {
    return NextResponse.json({ error: "SEED_ADMIN_SECRET is not configured" }, { status: 501 });
  }

  const provided =
    new URL(request.url).searchParams.get("secret") ?? request.headers.get("x-seed-secret") ?? "";
  // Compare fixed-length digests, not the raw strings - timingSafeEqual
  // throws on a length mismatch, which itself would otherwise leak the
  // real secret's length to a probing caller.
  const expectedDigest = createHash("sha256").update(expected).digest();
  const providedDigest = createHash("sha256").update(provided).digest();
  if (!timingSafeEqual(expectedDigest, providedDigest)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Checked after the secret, so an unauthenticated caller sees the same 401
  // as before and learns nothing about the deployment.
  if (isProductionSeedRefused()) {
    return NextResponse.json({ error: "Demo seeding is disabled in production." }, { status: 403 });
  }

  const summary = await seedDemoData(prisma);
  return NextResponse.json({ summary });
}

export const GET = handle;
export const POST = handle;
