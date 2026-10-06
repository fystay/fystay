import { NextResponse } from "next/server";
import type { LocalPlaceCategory } from "@prisma/client";
import { getTownPlaces } from "@/lib/localData/places";
import { checkRateLimit, clientIp, rateLimitedResponse } from "@/lib/rateLimit";
import { withApiErrorHandling } from "@/lib/apiError";

const RATE_LIMIT = 60;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;

const VALID_CATEGORIES = new Set<string>([
  "RESTAURANT",
  "CAFE",
  "PUB",
  "SHOP",
  "SUPERMARKET",
  "PHARMACY",
  "PARK",
  "BEACH",
  "PLAYGROUND",
  "ATTRACTION",
  "MUSEUM",
  "TOILET",
  "PARKING",
  "EV_CHARGING",
  "VIEWPOINT",
  "OTHER",
]);

async function getHandler(request: Request) {
  const rateLimit = await checkRateLimit({
    key: `local-places:${clientIp(request)}`,
    limit: RATE_LIMIT,
    windowMs: RATE_LIMIT_WINDOW_MS,
  });
  if (!rateLimit.allowed) return rateLimitedResponse(rateLimit);

  const { searchParams } = new URL(request.url);
  const town = searchParams.get("town");
  if (!town) {
    return NextResponse.json({ error: "A town slug is required" }, { status: 400 });
  }

  const categoryParam = searchParams.get("category");
  if (categoryParam && !VALID_CATEGORIES.has(categoryParam)) {
    return NextResponse.json({ error: "Unknown category" }, { status: 400 });
  }

  try {
    const places = await getTownPlaces(town, categoryParam as LocalPlaceCategory | undefined);
    return NextResponse.json({ town, places });
  } catch {
    return NextResponse.json({ error: "Local places are temporarily unavailable" }, { status: 503 });
  }
}

export const GET = withApiErrorHandling(getHandler);
