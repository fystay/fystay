import { cache } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AlertTriangle, CalendarCheck, ExternalLink, Home, MapPin, Sparkles, Star } from "lucide-react";
import {
  destinationSlugFor,
  getHotelForBooking,
  loadHotelDetailPageData,
  recordHotelDetailView,
} from "@/lib/hotelProviders/search";
import {
  buildHotelSearchQuery,
  DEFAULT_GUEST_COUNTS,
  defaultStayWindow,
  formatDateParam,
  parseOptionalGuestCounts,
  parseOptionalStayWindow,
} from "@/lib/hotelSearchParams";
import { PhotoGallery } from "@/components/PhotoGallery";
import { SectionHeading } from "@/components/SectionHeading";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { HotelMobileBookingBar } from "@/components/hotels/HotelMobileBookingBar";
import { EvExecCrossSellCard } from "@/components/EvExecCrossSellCard";
import { getActiveOfferingByCategory } from "@/lib/travelAddons";
import { formatProviderPrice } from "@/lib/format";
import { SITE_URL, withCity } from "@/lib/seo";

type Params = { destination: string; hotelSlug: string };
type SearchParams = Record<string, string | string[] | undefined>;

const getHotel = cache(async (slug: string) => getHotelForBooking(slug));

function formatDateRange(checkIn: Date, checkOut: Date): string {
  const fmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });
  return `${fmt.format(checkIn)} – ${fmt.format(checkOut)}`;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { hotelSlug } = await params;
  const outcome = await getHotel(hotelSlug);
  if (outcome.status !== "ok") return {};

  const { details, slug } = outcome.hotel;
  const title = withCity(details.name, details.city);
  const description =
    details.description?.slice(0, 155) ??
    `${details.name} in ${details.city}, ${details.country} - compare and book via our booking partner.`;
  // Deliberately excludes checkIn/checkOut/guests: the same hotel is
  // reachable from any number of date/guest combinations, and they'd all
  // dilute into the same canonical page - a duplicate/thin-page risk this
  // avoids entirely rather than papering over with per-query canonicals.
  const url = `${SITE_URL}/hotels/${destinationSlugFor(details.city)}/${slug}`;

  return {
    title,
    description,
    alternates: { canonical: url },
    // Built against the mock provider only today (Phase 5/6) - never index
    // a page whose content is test fixture data. Revisit once a real
    // provider (e.g. Booking.com) is live and this reflects real inventory.
    robots: { index: false, follow: true },
    openGraph: details.photos[0] ? { title, description, images: [{ url: details.photos[0] }] } : undefined,
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: details.photos[0] ? [details.photos[0]] : undefined,
    },
  };
}

/**
 * The affiliate hotel detail page - photos/description/facilities/rating
 * come from a live getHotelForBooking() call (never the AffiliateHotel
 * cache row directly - see search.ts's own top comment on why). Every
 * "Book now" CTA links to this app's own /api/hotels/redirect (Phase 7),
 * never straight to a provider URL - that route is what actually resolves
 * the provider, builds the deep link, and records the click, opening in a
 * new tab so a guest never loses their place on FYStay. FYStay never takes
 * payment or a booking on this page itself.
 */
export default async function HotelDetailPage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<SearchParams>;
}) {
  const { destination, hotelSlug } = await params;
  const resolvedSearchParams = await searchParams;
  const stayWindow = parseOptionalStayWindow(resolvedSearchParams) ?? defaultStayWindow();
  const guestCounts = parseOptionalGuestCounts(resolvedSearchParams) ?? DEFAULT_GUEST_COUNTS;

  // Live details and live availability are fetched in parallel (see
  // loadHotelDetailPageData) - details through the same cache()d getHotel
  // generateMetadata uses, so the provider is asked for them once.
  const outcome = await loadHotelDetailPageData(hotelSlug, { ...stayWindow, ...guestCounts }, getHotel);
  if (outcome.status === "not_found") notFound();

  if (outcome.status === "unavailable") {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center gap-3 px-6 py-16 text-center">
        <AlertTriangle className="h-8 w-8 text-stone-300" aria-hidden />
        <p className="font-medium text-foreground">This hotel isn&apos;t available right now</p>
        <p className="max-w-sm text-sm text-stone-500">{outcome.message}</p>
      </div>
    );
  }

  const { hotel, availability: availabilityOutcome } = outcome;
  const canonicalDestination = destinationSlugFor(hotel.details.city);
  if (destination !== canonicalDestination) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(resolvedSearchParams)) {
      if (typeof value === "string") query.set(key, value);
    }
    const qs = query.toString();
    redirect(`/hotels/${canonicalDestination}/${hotel.slug}${qs ? `?${qs}` : ""}`);
  }

  const [evExecOffering] = await Promise.all([
    // The EV Exec cross-sell (Phase 9) - a completely separate lookup from
    // everything else on this page: it never touches AffiliateHotel/
    // AffiliateClick/AffiliateConversion, and its own analytics events
    // (ev_exec_cross_sell_impression/click, see EvExecCrossSellCard) are
    // never mixed into hotel affiliate reporting.
    getActiveOfferingByCategory("AIRPORT_TRANSFER"),
    // Only after the canonical-destination check above, so a guest hitting
    // the non-canonical URL (immediately redirected, never actually shown
    // this page) doesn't get double-counted alongside the canonical render
    // they land on next. Its result is discarded (void) - it must come
    // last in this array so the name above lines up positionally.
    recordHotelDetailView(hotel, hotel.details.city),
  ]);

  const details = hotel.details;
  // The exact query every "Book now" link below carries into
  // /api/hotels/redirect - that route re-derives the same stay window/
  // guest counts from these same params (falling back to the same
  // defaults if any are missing), so the deep link it builds always
  // matches what this page just showed the guest. Never includes a
  // provider or hotel id directly - the route resolves both itself from
  // the "hotel" slug against the database (see that route's own top
  // comment on why nothing here is trusted as-is).
  const redirectQuery = buildHotelSearchQuery({
    destination: "",
    checkIn: stayWindow.checkIn,
    checkOut: stayWindow.checkOut,
    adults: guestCounts.adults,
    children: guestCounts.children,
    rooms: guestCounts.rooms,
  });
  const totalGuests = guestCounts.adults + guestCounts.children;

  // What EvExecCrossSellCard carries through to /travel-extras - only real,
  // already-known values from this exact search (see travelAddonHref's own
  // comment: no airport is ever included, since no airport mapping exists
  // anywhere in this codebase and one is never invented here).
  const evExecContext = {
    destination: details.city,
    hotelName: details.name,
    checkIn: formatDateParam(stayWindow.checkIn),
    checkOut: formatDateParam(stayWindow.checkOut),
    adults: guestCounts.adults,
    children: guestCounts.children,
  };

  // "Back to these results" - the same city, dates and guests the guest
  // already searched with, so following the breadcrumb (or a "see other
  // hotels" link from the empty-deals state below) never drops their
  // search context. destinationSlugFor(details.city) already established
  // this hotel's own canonical city text is what search treats as the
  // destination, so reusing it here keeps the two in agreement.
  const backToResultsHref = `/hotels?${buildHotelSearchQuery({
    destination: details.city,
    checkIn: stayWindow.checkIn,
    checkOut: stayWindow.checkOut,
    adults: guestCounts.adults,
    children: guestCounts.children,
    rooms: guestCounts.rooms,
  })}`;
  // Same destination/guests, dates deliberately omitted - lands on a
  // pre-filled search form prompting the guest to pick new ones, for the
  // "no deals for these dates" case.
  const changeDatesHref = `/hotels?${buildHotelSearchQuery({
    destination: details.city,
    adults: guestCounts.adults,
    children: guestCounts.children,
    rooms: guestCounts.rooms,
  })}`;

  const lowestDeal =
    availabilityOutcome.status === "ok" && availabilityOutcome.deals.length > 0
      ? availabilityOutcome.deals.reduce((min, deal) => (deal.priceCents < min.priceCents ? deal : min))
      : null;

  return (
    <div className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">
      <nav aria-label="Breadcrumb" className="mb-2 flex items-center gap-1.5 text-xs text-stone-500">
        <Link href="/hotels" className="focus-ring rounded-sm hover:text-brand-700">
          Hotels
        </Link>
        <span aria-hidden>/</span>
        <Link href={backToResultsHref} className="focus-ring rounded-sm hover:text-brand-700">
          {details.city}
        </Link>
        <span aria-hidden>/</span>
        <span className="truncate text-stone-600">{details.name}</span>
      </nav>

      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold text-foreground sm:text-3xl">{details.name}</h1>
        <div className="flex flex-wrap items-center gap-3 text-sm text-stone-500">
          <span className="flex items-center gap-1">
            <MapPin className="h-3.5 w-3.5 shrink-0 text-brand-600" aria-hidden />
            {details.city}, {details.country}
          </span>
          {details.starRating != null && <span>{details.starRating}-star hotel</span>}
          {details.guestRating != null && (
            <span className="flex items-center gap-1 rounded-full border border-border-subtle bg-surface px-2 py-0.5 text-xs font-medium text-stone-700">
              <Star className="h-3.5 w-3.5 fill-accent-500 text-accent-500" aria-hidden />
              {details.guestRating.toFixed(1)}
              {details.reviewCount ? <span className="text-stone-500">({details.reviewCount})</span> : null}
            </span>
          )}
          <span className="rounded-full bg-surface-muted px-2 py-0.5 text-xs font-medium text-stone-600">
            Via {hotel.providerName}
          </span>
        </div>
      </div>

      <PhotoGallery photos={details.photos} title={details.name} />

      <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-[2fr_1fr]">
        <div className="flex flex-col gap-8">
          {details.description && (
            <section className="flex flex-col gap-2">
              <SectionHeading icon={Home}>About this hotel</SectionHeading>
              <p className="text-sm leading-relaxed text-stone-600">{details.description}</p>
            </section>
          )}

          {details.facilities.length > 0 && (
            <section className="flex flex-col gap-3">
              <SectionHeading icon={Sparkles}>Facilities</SectionHeading>
              <ul className="flex flex-wrap gap-2">
                {details.facilities.map((facility) => (
                  <li
                    key={facility}
                    className="rounded-full border border-border-subtle bg-surface-muted px-3 py-1 text-xs font-medium text-stone-600"
                  >
                    {facility}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        {/* A distinct bordered/shadowed Card, deliberately unlike the plain
            inline sections to the left - the visual break itself is most of
            what tells a guest "this box is a live check against the
            provider, not fixed content about the hotel", reinforced by the
            "Live pricing" badge and id="hotel-deals" (the mobile sticky
            bar's scroll target). */}
        <aside id="hotel-deals" className="flex flex-col gap-4">
          <Card className="lg:sticky lg:top-24">
            <CardHeader className="pb-0">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="flex items-center gap-2">
                  <CalendarCheck className="h-4 w-4 text-brand-600" aria-hidden />
                  Available deals
                </CardTitle>
                <Badge variant="success">Live pricing</Badge>
              </div>
              <p className="mt-1 text-xs text-stone-500">
                {formatDateRange(stayWindow.checkIn, stayWindow.checkOut)} · {totalGuests} guest
                {totalGuests === 1 ? "" : "s"}, {guestCounts.rooms} room{guestCounts.rooms === 1 ? "" : "s"}
              </p>
              <p className="mt-0.5 text-[11px] text-stone-400">Checked just now</p>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 pt-4">
              {availabilityOutcome.status === "unavailable" ? (
                <p className="text-sm text-stone-500">{availabilityOutcome.message}</p>
              ) : availabilityOutcome.deals.length === 0 ? (
                <div className="flex flex-col gap-2">
                  <p className="text-sm text-stone-500">No rooms available for these dates.</p>
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    <Link
                      href={changeDatesHref}
                      className="focus-ring rounded-sm text-sm font-medium text-brand-700 hover:underline"
                    >
                      Try different dates
                    </Link>
                    <Link
                      href={backToResultsHref}
                      className="focus-ring rounded-sm text-sm font-medium text-brand-700 hover:underline"
                    >
                      See other hotels in {details.city}
                    </Link>
                  </div>
                </div>
              ) : (
                availabilityOutcome.deals.map((deal, i) => {
                  const redirectParams = new URLSearchParams(redirectQuery);
                  redirectParams.set("hotel", hotel.slug);
                  if (deal.externalRoomId) redirectParams.set("room", deal.externalRoomId);
                  const redirectHref = `/api/hotels/redirect?${redirectParams.toString()}`;
                  return (
                    <div key={deal.externalRoomId ?? i} className="rounded-xl border border-border-subtle p-3">
                      <p className="text-sm font-semibold text-foreground">{deal.name}</p>
                      {deal.description && (
                        <p className="mt-0.5 text-xs text-stone-500">{deal.description}</p>
                      )}
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <span className="font-serif text-lg tabular-nums text-brand-800">
                          {formatProviderPrice(deal.priceCents, deal.currency)}
                        </span>
                        {deal.refundable != null && (
                          <span className="text-xs text-stone-500">
                            {deal.refundable ? "Free cancellation" : "Non-refundable"}
                          </span>
                        )}
                      </div>
                      <a
                        href={redirectHref}
                        target="_blank"
                        rel="nofollow sponsored noopener noreferrer"
                        className="focus-ring mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl bg-brand-700 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-800"
                      >
                        Book now
                        <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                      </a>
                    </div>
                  );
                })
              )}
              {availabilityOutcome.status === "ok" && availabilityOutcome.deals.length > 0 && (
                <p className="mt-1 text-[11px] text-stone-500">
                  You&apos;ll book and pay directly with {hotel.providerName}. FYStay doesn&apos;t process
                  this booking.
                </p>
              )}
            </CardContent>
          </Card>

          {/* Optional, separate from the deal above it - see EvExecCrossSellCard's
              own comment for why this is its own component rather than a reuse of
              PropertyTransferPromo, and item 8 of the Phase 9 brief for why nothing
              above this line changes to make room for it. */}
          {evExecOffering && (
            <EvExecCrossSellCard
              offering={evExecOffering}
              context={evExecContext}
              surface="hotel_detail_page"
            />
          )}
        </aside>
      </div>

      <HotelMobileBookingBar
        lowestPriceCents={lowestDeal?.priceCents ?? null}
        currency={lowestDeal?.currency ?? "GBP"}
        targetId="hotel-deals"
      />
    </div>
  );
}
