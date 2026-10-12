import { NextResponse } from "next/server";
import { withApiErrorHandling } from "@/lib/apiError";
import { checkRateLimit, clientIp, rateLimitedResponse } from "@/lib/rateLimit";
import { getPlaceDetails, isGooglePlacesConfigured, validSessionToken } from "@/lib/googlePlaces";

/**
 * The details of a Google place the guest picked in the search box - name,
 * coordinates and viewport - fetched server-side so the key stays private.
 * The search box puts them in the results URL; the search validates them.
 */
async function getHandler(request: Request) {
  if (!isGooglePlacesConfigured()) {
    return NextResponse.json({ error: "Place search isn't available right now." }, { status: 503 });
  }
  const { searchParams } = new URL(request.url);
  const placeId = searchParams.get("id") ?? "";
  if (!/^[A-Za-z0-9_-]{10,300}$/.test(placeId)) {
    return NextResponse.json({ error: "Invalid place." }, { status: 400 });
  }

  // Each lookup is a billable Google call.
  const limit = await checkRateLimit({ key: `place-details:${clientIp(request)}`, limit: 60, windowMs: 10 * 60 * 1000 });
  if (!limit.allowed) return rateLimitedResponse(limit);

  const details = await getPlaceDetails(placeId, { sessionToken: validSessionToken(searchParams.get("session")) });
  if (!details) {
    return NextResponse.json({ error: "We couldn't load that place. Try again or pick another." }, { status: 502 });
  }
  return NextResponse.json({ place: details });
}

export const GET = withApiErrorHandling(getHandler);
