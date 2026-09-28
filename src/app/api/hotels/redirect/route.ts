import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { withApiErrorHandling } from "@/lib/apiError";
import { checkRateLimit, clientIp, rateLimitedResponse } from "@/lib/rateLimit";
import { resolveAffiliateHotelForRedirect } from "@/lib/hotelProviders/search";
import { evaluateProviderActivation, getOperationalHotelProviderAdapter } from "@/lib/hotelProviders/registry";
import { HotelProviderAdapterError } from "@/lib/hotelProviders/types";
import { computeClickSubId, isAllowedDeepLinkUrl } from "@/lib/hotelProviders/click";
import {
  DEFAULT_GUEST_COUNTS,
  defaultStayWindow,
  parseOptionalGuestCounts,
  parseOptionalStayWindow,
} from "@/lib/hotelSearchParams";
import { readVisitorId, visitorIdCookieOptions } from "@/lib/visitorId";
import { SITE_URL } from "@/lib/seo";

/**
 * The one route every "Book now" / "View deal" link on a hotel affiliate
 * page ever points to - see prisma/schema.prisma's own hotel-affiliate
 * section comment for the architectural rule this route exists to
 * enforce: the browser is never handed a provider URL and asked to
 * navigate itself there in a way this server doesn't control. Only this
 * route resolves a provider+hotel from data it already stored (a slug
 * looked up against AffiliateHotel, never a raw id/provider pair taken
 * from the request), builds the deep link itself via that hotel's own
 * adapter, records the click, and only then issues the redirect.
 *
 * Concretely, this closes off every attack this phase's security review
 * asks about:
 *  - Open redirect: there is no "url"/"next"/"returnTo" parameter anywhere
 *    in this handler. The only possible redirect targets are (a) the fixed
 *    literal "/hotels" fallback and (b) a URL this route just built itself
 *    from a DB-resolved adapter, additionally checked against that
 *    provider's own host allowlist (see isAllowedDeepLinkUrl) before it's
 *    ever followed.
 *  - Hotel ID tampering: "hotel" is a slug looked up against the DB: an
 *    unknown slug resolves to nothing (safe fallback); a slug for a real,
 *    different hotel just sends the guest to that other real hotel, the
 *    same outcome as clicking a different real link - not a boundary
 *    violation.
 *  - Provider ID tampering: there is no providerId parameter read from the
 *    request anywhere in this file. The provider is always the one the
 *    resolved AffiliateHotel row itself belongs to.
 *  - Sub-ID manipulation: there is no subId parameter read from the
 *    request either. computeClickSubId derives it entirely from
 *    server-resolved values (see that function's own comment).
 *  - Cross-user/session attribution: userId comes only from auth()'s
 *    verified session, never a request parameter; sessionId comes only
 *    from a cookie this server itself issued (see visitorId.ts) or
 *    generates fresh - never a client-supplied identifier naming somebody
 *    else's session.
 *  - Missing/invalid hotel/provider records: an unresolvable, inactive, or
 *    non-ACTIVE-provider hotel, or a provider with no registered adapter,
 *    all fall back to the same safe "/hotels" redirect - never a crash or
 *    a leaked error.
 *  - Direct access: this endpoint is designed to be hit directly (a
 *    bookmark, a shared link, an email click are all legitimate in real
 *    affiliate tracking) - "safe" here means well-validated, not
 *    unreachable, which is exactly what the rest of this list establishes.
 *
 * Never touches a provider credential: createDeepLink() is a pure,
 * synchronous string builder (see HotelProviderAdapter's own contract) -
 * nothing in this route path ever has, needs, or could leak an API key.
 */

function safeFallback(): NextResponse {
  return NextResponse.redirect(new URL("/hotels", SITE_URL));
}

/** Only ever stores a path from this exact request's own origin - a referrer from elsewhere isn't "which FYStay page this click came from" (this column's whole purpose), so it's discarded rather than stored as an arbitrary, unbounded external string. */
function safeReferrerPath(refererHeader: string | null, requestOrigin: string): string | null {
  if (!refererHeader) return null;
  try {
    const parsed = new URL(refererHeader);
    if (parsed.origin !== requestOrigin) return null;
    return parsed.pathname.slice(0, 300);
  } catch {
    return null;
  }
}

export const GET = withApiErrorHandling(async function GET(request: Request) {
  const rateLimit = await checkRateLimit({
    key: `hotel-click:${clientIp(request)}`,
    limit: 40,
    windowMs: 5 * 60 * 1000,
  });
  if (!rateLimit.allowed) return rateLimitedResponse(rateLimit);

  const url = new URL(request.url);
  const hotelSlug = url.searchParams.get("hotel");
  if (!hotelSlug) return safeFallback();

  const hotel = await resolveAffiliateHotelForRedirect(hotelSlug);
  if (!hotel || !hotel.active) return safeFallback();
  if (!hotel.provider.supportsDeepLink) return safeFallback();
  // The registry's activation rule covers a non-ACTIVE provider, a code with
  // no registered adapter, mock on a production deployment, and an external
  // provider that isn't live-listed - all fall back safely, before any click
  // is recorded.
  if (!evaluateProviderActivation(hotel.provider).operational) return safeFallback();

  const adapter = getOperationalHotelProviderAdapter(hotel.provider);

  const rawParams = Object.fromEntries(url.searchParams.entries());
  const stayWindow = parseOptionalStayWindow(rawParams) ?? defaultStayWindow();
  const guestCounts = parseOptionalGuestCounts(rawParams) ?? DEFAULT_GUEST_COUNTS;
  // Cosmetic only - identifies which deal/room the click was for in the
  // subId hash (see computeClickSubId), never used to look anything up.
  // A tampered value here can only make a guest's own click look like it
  // was for a different room than it really was - it can't affect anyone
  // else's data, the resolved hotel/provider, or the redirect target.
  const externalRoomId = url.searchParams.get("room");

  const session = await auth();
  const existingVisitorId = readVisitorId(request.headers.get("cookie"));
  const visitorId = existingVisitorId ?? crypto.randomUUID();
  const visitorKey = session?.user?.id ?? visitorId;

  const subId = computeClickSubId({
    hotelId: hotel.id,
    externalRoomId,
    checkIn: stayWindow.checkIn,
    checkOut: stayWindow.checkOut,
    adults: guestCounts.adults,
    children: guestCounts.children,
    rooms: guestCounts.rooms,
    visitorKey,
  });

  let deepLinkUrl: string;
  try {
    deepLinkUrl = adapter.createDeepLink({
      externalId: hotel.externalId,
      checkIn: stayWindow.checkIn,
      checkOut: stayWindow.checkOut,
      adults: guestCounts.adults,
      children: guestCounts.children,
      rooms: guestCounts.rooms,
      subId,
    });
  } catch (err) {
    if (err instanceof HotelProviderAdapterError) return safeFallback();
    throw err;
  }

  if (!isAllowedDeepLinkUrl(hotel.provider.code, deepLinkUrl)) {
    // An adapter just returned a URL outside its own declared host
    // allowlist - never follow it. This should be unreachable (see
    // click.ts's own comment on ALLOWED_DEEP_LINK_HOSTS); if it ever
    // fires, it's a bug in that adapter, not anything this request did.
    console.error(
      `Refusing to redirect to a disallowed host for provider "${hotel.provider.code}": ${deepLinkUrl}`,
    );
    return safeFallback();
  }

  // The URL actually recorded/followed for this click - starts as the one
  // just built, but is replaced with an existing row's own URL below if
  // this exact click (same subId) was already recorded a moment ago, so
  // the audit trail and the redirect always agree with each other.
  let finalDeepLinkUrl = deepLinkUrl;
  try {
    await prisma.affiliateClick.create({
      data: {
        providerId: hotel.provider.id,
        hotelId: hotel.id,
        // AffiliateSearch rows have existed since Phase 8, but this route
        // has no reliable way to know *which* search (if any) led to this
        // click - correlating them (e.g. "most recent search for this
        // visitor/session within some time window") is a real design
        // decision (how wide a window, how to break ties) that risks
        // mislinking a click to the wrong search if guessed casually, so
        // searchId is deliberately left null here rather than guessed at.
        // See the Phase 10 production-readiness report for this open item.
        searchId: null,
        subId,
        destination: hotel.city,
        checkIn: stayWindow.checkIn,
        checkOut: stayWindow.checkOut,
        deepLinkUrl,
        userId: session?.user?.id ?? null,
        sessionId: visitorId,
        ipAddress: clientIp(request),
        userAgent: request.headers.get("user-agent"),
        referrerPath: safeReferrerPath(request.headers.get("referer"), url.origin),
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      // The exact same click was already recorded a moment ago - a
      // double-click, or the guest refreshing/going back and clicking
      // again within the same UTC day (see computeClickSubId's own
      // comment). Reuse that row's own URL rather than inserting a
      // duplicate.
      const existing = await prisma.affiliateClick.findUnique({ where: { subId } });
      if (existing) finalDeepLinkUrl = existing.deepLinkUrl;
    } else {
      // Never let a tracking failure cost a real booking - log it and
      // still send the guest on their way with the URL already built.
      console.error(err);
    }
  }

  const response = NextResponse.redirect(finalDeepLinkUrl, { status: 302 });
  if (!existingVisitorId) {
    response.cookies.set({ value: visitorId, ...visitorIdCookieOptions() });
  }
  return response;
});
