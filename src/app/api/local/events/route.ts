import { NextResponse } from "next/server";
import { getTownEvents } from "@/lib/localData/events";
import { checkRateLimit, clientIp, rateLimitedResponse } from "@/lib/rateLimit";
import { withApiErrorHandling } from "@/lib/apiError";

const RATE_LIMIT = 60;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;

async function getHandler(request: Request) {
  const rateLimit = await checkRateLimit({
    key: `local-events:${clientIp(request)}`,
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
    const events = await getTownEvents(town);
    return NextResponse.json({ town, events });
  } catch {
    return NextResponse.json({ error: "Local events are temporarily unavailable" }, { status: 503 });
  }
}

export const GET = withApiErrorHandling(getHandler);
