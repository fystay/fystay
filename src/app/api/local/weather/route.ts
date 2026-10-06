import { NextResponse } from "next/server";
import { getTownWeather } from "@/lib/localData/weather";
import { checkRateLimit, clientIp, rateLimitedResponse } from "@/lib/rateLimit";
import { withApiErrorHandling } from "@/lib/apiError";

// Generous - this endpoint only ever reads a cache (a live Open-Meteo call
// happens at most once per town per 45-minute TTL, regardless of how many
// requests land here) - the limit exists to stop outright abuse, not to
// protect Open-Meteo from real guest traffic.
const RATE_LIMIT = 60;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;

/**
 * The only place in the app allowed to know Open-Meteo's URL shape reads
 * from here indirectly via getTownWeather - this route (and every other
 * /api/local/* route) exists so no browser code ever calls a third-party
 * API, or holds a key for one, directly.
 */
async function getHandler(request: Request) {
  const rateLimit = await checkRateLimit({
    key: `local-weather:${clientIp(request)}`,
    limit: RATE_LIMIT,
    windowMs: RATE_LIMIT_WINDOW_MS,
  });
  if (!rateLimit.allowed) return rateLimitedResponse(rateLimit);

  const { searchParams } = new URL(request.url);
  const town = searchParams.get("town");
  if (!town) {
    return NextResponse.json({ error: "A town slug is required" }, { status: 400 });
  }

  try {
    const weather = await getTownWeather(town);
    if (!weather) {
      return NextResponse.json({ error: "No weather available for that town" }, { status: 404 });
    }
    return NextResponse.json(weather);
  } catch {
    return NextResponse.json({ error: "Weather is temporarily unavailable" }, { status: 503 });
  }
}

export const GET = withApiErrorHandling(getHandler);
