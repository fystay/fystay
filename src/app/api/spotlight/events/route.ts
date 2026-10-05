import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiErrorHandling } from "@/lib/apiError";
import { checkRateLimit, clientIp } from "@/lib/rateLimit";
import { isLikelyBot, recordSpotlightEvent, SPOTLIGHT_EVENT_TYPES, visitorKey } from "@/lib/spotlightStats";

const eventSchema = z.object({
  promotionId: z.string().min(1).max(64),
  type: z.enum(SPOTLIGHT_EVENT_TYPES),
});

// However many placements and loops a visitor sees, one address sending
// more than this is not a person browsing the homepage.
const EVENTS_PER_VISITOR = 120;
const EVENTS_WINDOW_MS = 10 * 60 * 1000;

/**
 * Where the homepage's Spotlight showcase reports that a placement was shown
 * or clicked (see src/lib/spotlightStats.ts for what's counted and why).
 * Public - anyone can view the homepage - so it never says whether an event
 * was counted: valid requests always get 204, sent with navigator.sendBeacon
 * by a page that doesn't wait for the answer.
 */
async function postHandler(request: Request) {
  // sendBeacon posts a text/plain body, so it's parsed here rather than
  // with request.json() (a malformed body still throws SyntaxError -> 400).
  const parsed = eventSchema.safeParse(JSON.parse(await request.text()));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid event." }, { status: 400 });
  }
  if (isLikelyBot(request.headers.get("user-agent"))) {
    return new NextResponse(null, { status: 204 });
  }

  const visitor = visitorKey(clientIp(request));
  const withinLimit = await checkRateLimit({
    key: `spotlight-events:${visitor}`,
    limit: EVENTS_PER_VISITOR,
    windowMs: EVENTS_WINDOW_MS,
  });
  if (withinLimit.allowed) {
    await recordSpotlightEvent({ ...parsed.data, visitor });
  }
  return new NextResponse(null, { status: 204 });
}

export const POST = withApiErrorHandling(postHandler);
