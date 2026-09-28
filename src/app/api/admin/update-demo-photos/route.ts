import { createHash, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { updateDemoListingCoverPhotos } from "@/lib/demoSeed";
import { isProductionSeedRefused } from "@/lib/productionSeedGuard";

/**
 * One-off sibling of /api/admin/seed-demo-data: retro-fits the current
 * TOWN_COVER_PHOTOS onto demo listings an earlier seeding pass already
 * created (see updateDemoListingCoverPhotos's own comment for why a plain
 * reseed doesn't pick this up). Same shared-secret gate, same "safe to
 * call more than once" idempotency, same GET-triggerable pragmatic pattern
 * as that route - see its comment for the full reasoning.
 *
 * This is temporary demo-catalogue tooling, not a permanent admin feature
 * - remove this route (and TOWN_COVER_PHOTOS) once real host photos
 * replace the demo dataset ahead of go-live.
 */
async function handle(request: Request) {
  const expected = process.env.SEED_ADMIN_SECRET;
  if (!expected) {
    return NextResponse.json({ error: "SEED_ADMIN_SECRET is not configured" }, { status: 501 });
  }

  const provided =
    new URL(request.url).searchParams.get("secret") ?? request.headers.get("x-seed-secret") ?? "";
  const expectedDigest = createHash("sha256").update(expected).digest();
  const providedDigest = createHash("sha256").update(provided).digest();
  if (!timingSafeEqual(expectedDigest, providedDigest)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Same production rule as seed-demo-data (checked after the secret, so an
  // unauthenticated caller learns nothing about the environment): this
  // overwrites cover photos on any listing whose title matches a demo title,
  // which must never happen to a real production catalogue by accident.
  if (isProductionSeedRefused()) {
    return NextResponse.json({ error: "Demo photo updates are disabled in production." }, { status: 403 });
  }

  const results = await updateDemoListingCoverPhotos(prisma);
  return NextResponse.json({ results });
}

export const GET = handle;
export const POST = handle;
