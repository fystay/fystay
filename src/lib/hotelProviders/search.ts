/**
 * The one place the hotel search UI (Phase 5) actually calls to reach a
 * provider - every page/component gets here through this module, never by
 * importing an adapter or the registry directly (see this package's own
 * types.ts top comment). Two responsibilities live here that don't belong
 * in a pure lib file because both need Prisma:
 *
 *   1. Deciding WHICH provider(s) to query: every ACTIVE HotelProvider row
 *      in the database, not a hardcoded provider. Today that's only ever
 *      the seeded "mock" row (see src/lib/demoSeed.ts) - "booking_com"
 *      stays unseeded/INACTIVE until real partner credentials exist (see
 *      providers/bookingCom.ts) - but the loop below already handles
 *      however many providers are ACTIVE at once, so flipping a real
 *      provider on later is a database change, not a code change here or
 *      in any page that calls this module.
 *   2. Caching each result into AffiliateHotel, keyed by (providerId,
 *      externalId) - not for freshness (the hotel detail page always
 *      re-fetches live details/availability - see getHotelForBooking
 *      below), but because AffiliateHotel.slug is the stable, public
 *      identifier `/hotels/[destination]/[slug]` resolves by. A hotel
 *      needs exactly one durable slug the first time it's ever seen, and
 *      needs to keep answering to that same slug on every later search
 *      that surfaces it again.
 */
import { cookies, headers } from "next/headers";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { evaluateProviderActivation, getOperationalHotelProviderAdapter } from "@/lib/hotelProviders/registry";
import {
  HotelProviderAdapterError,
  type AvailabilityParams,
  type HotelDeal,
  type HotelDetails,
  type HotelSearchParams,
  type HotelSearchResult,
} from "@/lib/hotelProviders/types";
import { buildHotelSlugBase, ensureUniqueSlug, slugify } from "@/lib/hotelSlug";
import { VISITOR_ID_COOKIE } from "@/lib/visitorId";

export type HotelSearchCard = HotelSearchResult & {
  slug: string;
  providerCode: string;
  providerName: string;
};

export type HotelSearchOutcome =
  | { status: "ok"; results: HotelSearchCard[] }
  | { status: "unavailable"; message: string };

/**
 * Batches the slug-uniqueness check into one query per provider search
 * call (findMany + a Set), rather than one query per hotel - the search
 * results this runs against are a handful of rows, never worth N+1 queries.
 */
async function upsertAffiliateHotels(
  providerId: string,
  results: HotelSearchResult[],
): Promise<Map<string, string>> {
  const resultByExternalId = new Map(results.map((r) => [r.externalId, r]));
  const externalIds = results.map((r) => r.externalId);
  const existing = await prisma.affiliateHotel.findMany({
    where: { providerId, externalId: { in: externalIds } },
    select: { id: true, externalId: true, slug: true },
  });
  const existingByExternalId = new Map(existing.map((row) => [row.externalId, row]));

  const toCreate = results.filter((r) => !existingByExternalId.has(r.externalId));
  const candidateBases = toCreate.map((r) => buildHotelSlugBase(r.name, r.city));
  const potentiallyTaken =
    candidateBases.length > 0
      ? await prisma.affiliateHotel.findMany({
          where: { OR: candidateBases.map((base) => ({ slug: { startsWith: base } })) },
          select: { slug: true },
        })
      : [];
  const takenSlugs = new Set(potentiallyTaken.map((row) => row.slug));

  const slugByExternalId = new Map<string, string>();
  for (const row of existing) slugByExternalId.set(row.externalId, row.slug);

  const creates = toCreate.map((result) => {
    const base = buildHotelSlugBase(result.name, result.city);
    const slug = ensureUniqueSlug(base, (candidate) => takenSlugs.has(candidate));
    takenSlugs.add(slug);
    slugByExternalId.set(result.externalId, slug);
    return { result, slug };
  });

  // Every row in `existing` was looked up by an externalId drawn from
  // `results` itself (the where clause above), so resultByExternalId is
  // guaranteed to have an entry for each - this loop is exhaustive over
  // that same source array, never a value not already known to exist.
  const updates = existing.flatMap((row) => {
    const result = resultByExternalId.get(row.externalId);
    if (!result) return [];
    return [
      prisma.affiliateHotel.update({
        where: { id: row.id },
        data: {
          name: result.name,
          city: result.city,
          country: result.country,
          latitude: result.latitude,
          longitude: result.longitude,
          starRating: result.starRating,
          guestRating: result.guestRating,
          reviewCount: result.reviewCount,
          primaryPhotoUrl: result.primaryPhotoUrl,
          currency: result.currency,
          lastKnownPriceCents: result.priceCents,
          lastFetchedAt: new Date(),
        },
      }),
    ];
  });

  await prisma.$transaction([
    ...updates,
    ...creates.map(({ result, slug }) =>
      prisma.affiliateHotel.create({
        data: {
          providerId,
          externalId: result.externalId,
          name: result.name,
          city: result.city,
          country: result.country,
          latitude: result.latitude,
          longitude: result.longitude,
          starRating: result.starRating,
          guestRating: result.guestRating,
          reviewCount: result.reviewCount,
          primaryPhotoUrl: result.primaryPhotoUrl,
          photos: [],
          facilities: [],
          currency: result.currency,
          lastKnownPriceCents: result.priceCents,
          lastFetchedAt: new Date(),
          slug,
        },
      }),
    ),
  ]);

  return slugByExternalId;
}

/**
 * A search page render can legitimately fire searchHotels() more than once
 * for the *exact same* query with no real new intent behind it - most
 * notably a browser/Next.js Link prefetch of a URL the guest only hovered,
 * or (before Phase 7/8) simply re-rendering the same results page. Rather
 * than count every one of those as its own "search" (Phase 5 explicitly
 * deferred this exact concern), an identical search for the same provider/
 * destination/dates/guests/visitor within this window is treated as the
 * same search event and not recorded again. Long enough to absorb a
 * prefetch immediately before/after the real navigation; short enough that
 * a guest genuinely repeating the same search minutes later still counts.
 */
const SEARCH_DEDUP_WINDOW_MS = 30_000;

type SearchIdentity = { userId: string | null; sessionId: string | null };

/**
 * One AffiliateSearch row per provider actually queried (see this file's
 * own top comment on why that's the schema's intended shape, not one row
 * per searchHotels() call) - resultCount is the provider's real result
 * count on success, or null on a provider failure (never 0, which would
 * misreport "the provider answered with nothing" as "the provider was
 * down" or vice versa - see AffiliateSearch.resultCount's own schema
 * comment). Never lets a tracking failure break search results: any error
 * here is logged and swallowed, not surfaced to the guest.
 */
async function recordSearchEvent(
  provider: { id: string },
  params: HotelSearchParams,
  resultCount: number | null,
  identity: SearchIdentity,
  now: Date = new Date(),
): Promise<void> {
  try {
    const since = new Date(now.getTime() - SEARCH_DEDUP_WINDOW_MS);
    const recentDuplicate = await prisma.affiliateSearch.findFirst({
      where: {
        providerId: provider.id,
        destination: params.destination,
        checkIn: params.checkIn,
        checkOut: params.checkOut,
        adults: params.adults,
        children: params.children,
        rooms: params.rooms,
        userId: identity.userId,
        sessionId: identity.sessionId,
        createdAt: { gte: since },
      },
      select: { id: true },
    });
    if (recentDuplicate) return;

    await prisma.affiliateSearch.create({
      data: {
        providerId: provider.id,
        destination: params.destination,
        destinationLat: params.destinationLat ?? null,
        destinationLng: params.destinationLng ?? null,
        checkIn: params.checkIn,
        checkOut: params.checkOut,
        adults: params.adults,
        children: params.children,
        rooms: params.rooms,
        resultCount,
        userId: identity.userId,
        sessionId: identity.sessionId,
      },
    });
  } catch (err) {
    console.error(err);
  }
}

/**
 * Searches every ACTIVE provider and merges their results. A single
 * provider failing (HotelProviderAdapterError) doesn't fail the whole
 * search if at least one other provider succeeded - only surfaces as
 * "unavailable" when every provider failed or none are configured at all,
 * matching Phase 5's "provider error" state without letting one bad
 * provider take down a page that has other, working results to show.
 */
export async function searchHotels(params: HotelSearchParams): Promise<HotelSearchOutcome> {
  // ACTIVE in the database is necessary but not sufficient - the registry's
  // activation rule (e.g. mock is never operational in production; an
  // external provider must be live-listed) decides which ones may be queried.
  const activeProviders = await prisma.hotelProvider.findMany({ where: { status: "ACTIVE" } });
  const providers = activeProviders.filter((provider) => evaluateProviderActivation(provider).operational);
  if (providers.length === 0) {
    return {
      status: "unavailable",
      message: "Hotel search isn't available right now. Please try again later.",
    };
  }

  const [session, cookieStore] = await Promise.all([auth(), cookies()]);
  const identity: SearchIdentity = {
    userId: session?.user?.id ?? null,
    sessionId: cookieStore.get(VISITOR_ID_COOKIE)?.value ?? null,
  };

  const allResults: HotelSearchCard[] = [];
  let failureCount = 0;

  for (const provider of providers) {
    const adapter = getOperationalHotelProviderAdapter(provider);
    try {
      const results = await adapter.searchHotels(params);
      await recordSearchEvent(provider, params, results.length, identity);
      if (results.length === 0) continue;
      const slugByExternalId = await upsertAffiliateHotels(provider.id, results);
      for (const result of results) {
        const slug = slugByExternalId.get(result.externalId);
        if (!slug) continue;
        allResults.push({ ...result, slug, providerCode: provider.code, providerName: provider.name });
      }
    } catch (err) {
      if (!(err instanceof HotelProviderAdapterError)) throw err;
      failureCount++;
      await recordSearchEvent(provider, params, null, identity);
    }
  }

  if (allResults.length === 0 && failureCount === providers.length) {
    return {
      status: "unavailable",
      message: "We couldn't reach our hotel search partner. Please try again shortly.",
    };
  }

  return { status: "ok", results: allResults };
}

export type HotelForBooking = {
  slug: string;
  providerCode: string;
  providerName: string;
  externalId: string;
  details: HotelDetails;
};

export type HotelLookupOutcome =
  | { status: "ok"; hotel: HotelForBooking }
  | { status: "not_found" }
  | { status: "unavailable"; message: string };

const HOTEL_DETAIL_VIEWED_EVENT = "hotel_detail_viewed";
/** See recordSearchEvent's own comment on why a dedup window exists at all - the risk here is more acute: every hotel-result card links to its detail page via next/link, which prefetches routes as they scroll into the viewport, so without this a guest merely scrolling past six cards on the results page would look identical to opening six hotel pages. */
const DETAIL_VIEW_DEDUP_WINDOW_MS = 60_000;

/**
 * Records a hotel_detail_viewed row in AnalyticsEvent - the same general-
 * purpose event log Trip Extras cross-sell tracking already uses (see
 * src/lib/analytics.ts) rather than a new bespoke table, since a "detail
 * view" isn't a search, a click, or a conversion and the Phase 2 schema has
 * no dedicated table for it. Never lets a tracking failure break the page:
 * any error here is logged and swallowed.
 *
 * Dedup identity falls back three ways: a logged-in userId, else the
 * fystay_vid visitor cookie (see visitorId.ts), else the request's own IP -
 * that last fallback matters more here than it would for search tracking,
 * because this is a guest's *first-ever* touch of the hotel-affiliate
 * system just as often as not (the visitor cookie is only ever issued by
 * the click/redirect route, so a guest who has only ever viewed hotels, not
 * clicked one, never has it yet) - without an IP fallback, exactly the
 * highest-prefetch-risk population (brand-new anonymous visitors scrolling
 * a results page full of next/link cards) would get none of this
 * function's own dedup protection. IP is a coarser key (shared by
 * everyone behind the same NAT/office connection) - an acceptable
 * imprecision for best-effort analytics dedup, never used for anything
 * where that imprecision would matter.
 */
export async function recordHotelDetailView(
  hotel: { slug: string; providerCode: string },
  destination: string,
  now: Date = new Date(),
): Promise<void> {
  try {
    const [session, cookieStore, headerList] = await Promise.all([auth(), cookies(), headers()]);
    const userId = session?.user?.id ?? null;
    const sessionId = cookieStore.get(VISITOR_ID_COOKIE)?.value ?? null;
    const ipKey = userId || sessionId ? null : headerList.get("x-forwarded-for")?.split(",")[0]?.trim() || null;

    if (userId || sessionId || ipKey) {
      const since = new Date(now.getTime() - DETAIL_VIEW_DEDUP_WINDOW_MS);
      const identityFilter = userId
        ? { userId }
        : sessionId
          ? { metadata: { path: ["sessionId"], equals: sessionId } }
          : { metadata: { path: ["ipKey"], equals: ipKey as string } };
      const recentDuplicate = await prisma.analyticsEvent.findFirst({
        where: {
          name: HOTEL_DETAIL_VIEWED_EVENT,
          createdAt: { gte: since },
          AND: [{ metadata: { path: ["slug"], equals: hotel.slug } }, identityFilter],
        },
        select: { id: true },
      });
      if (recentDuplicate) return;
    }

    await prisma.analyticsEvent.create({
      data: {
        name: HOTEL_DETAIL_VIEWED_EVENT,
        category: "HOTEL_AFFILIATE",
        surface: "hotel_detail_page",
        userId,
        metadata: { slug: hotel.slug, providerCode: hotel.providerCode, destination, sessionId, ipKey },
      },
    });
  } catch (err) {
    console.error(err);
  }
}

/**
 * Resolves a public hotel slug back to (provider, externalId) via the
 * AffiliateHotel cache, then re-fetches live details from the provider -
 * the cache is only ever used for routing/identity here, never for display
 * content, so the detail page can never show a guest a stale description,
 * facility list, or photo set (see this module's own top comment).
 */
export async function getHotelForBooking(slug: string): Promise<HotelLookupOutcome> {
  const cached = await prisma.affiliateHotel.findUnique({
    where: { slug },
    include: { provider: true },
  });
  if (!cached || !cached.active) return { status: "not_found" };

  // A provider that fails the activation rule gets a locked adapter whose
  // methods throw HotelProviderNotOperationalError - handled below exactly
  // like any other provider failure.
  const adapter = getOperationalHotelProviderAdapter(cached.provider);
  try {
    const details = await adapter.getHotelDetails(cached.externalId);
    return {
      status: "ok",
      hotel: {
        slug: cached.slug,
        providerCode: cached.provider.code,
        providerName: cached.provider.name,
        externalId: cached.externalId,
        details,
      },
    };
  } catch (err) {
    if (err instanceof HotelProviderAdapterError) {
      return {
        status: "unavailable",
        message: "This hotel's details aren't available right now. Please try again shortly.",
      };
    }
    throw err;
  }
}

export type HotelAvailabilityOutcome =
  | { status: "ok"; deals: HotelDeal[] }
  | { status: "unavailable"; message: string };

export async function getHotelAvailability(
  providerCode: string,
  externalId: string,
  params: AvailabilityParams,
): Promise<HotelAvailabilityOutcome> {
  const unavailable: HotelAvailabilityOutcome = {
    status: "unavailable",
    message: "We couldn't check live availability for this hotel. Please try again shortly.",
  };
  // Read the provider's current status so the activation rule applies here
  // too, rather than trusting a code passed in by the caller.
  const provider = await prisma.hotelProvider.findUnique({
    where: { code: providerCode },
    select: { code: true, status: true },
  });
  if (!provider) return unavailable;
  const adapter = getOperationalHotelProviderAdapter(provider);
  try {
    const deals = await adapter.getAvailability(externalId, params);
    return { status: "ok", deals };
  } catch (err) {
    if (err instanceof HotelProviderAdapterError) return unavailable;
    throw err;
  }
}

/** The `[destination]` URL segment a hotel's card/detail link should use - always derived from the hotel's own city, never the raw search query, so two different searches that surface the same hotel always agree on one canonical URL. */
export function destinationSlugFor(city: string): string {
  return slugify(city);
}

export type AffiliateHotelForRedirect = {
  id: string;
  externalId: string;
  slug: string;
  city: string;
  active: boolean;
  provider: {
    id: string;
    code: string;
    status: string;
    supportsDeepLink: boolean;
  };
};

/**
 * The one lookup the click/redirect route (Phase 7) resolves a hotel from -
 * by slug only, the same stable public identifier every other hotel page
 * already uses, never a raw id or provider/hotel pair taken directly off
 * the request. Deliberately doesn't call the provider adapter at all (unlike
 * getHotelForBooking above): a redirect only needs this cached row's own
 * identity/status fields, and requiring a live details call to succeed
 * before a guest can be forwarded to book would make an unrelated provider
 * hiccup block a click that has nothing to do with fetching details.
 */
export async function resolveAffiliateHotelForRedirect(
  slug: string,
): Promise<AffiliateHotelForRedirect | null> {
  const row = await prisma.affiliateHotel.findUnique({
    where: { slug },
    include: { provider: true },
  });
  if (!row) return null;
  return {
    id: row.id,
    externalId: row.externalId,
    slug: row.slug,
    city: row.city,
    active: row.active,
    provider: {
      id: row.provider.id,
      code: row.provider.code,
      status: row.provider.status,
      supportsDeepLink: row.provider.supportsDeepLink,
    },
  };
}
