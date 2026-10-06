import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import {
  BadgeCheck,
  CalendarCheck,
  Compass,
  Home as HomeIcon,
  Receipt,
  MapPin,
  ShieldCheck,
  Star,
} from "lucide-react";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { SearchBar } from "@/components/SearchBar";
import { HeroBanner } from "@/components/HeroBanner";
import { buttonVariants } from "@/components/ui/Button";
import { LargeCard } from "@/components/LargeCard";
import { LargeCardRail } from "@/components/LargeCardRail";
import { FYSTAY_SERVICES } from "@/lib/services";
import { TravelAddonCard } from "@/components/TravelAddonsSection";
import { PopularStays } from "@/components/PopularStays";
import { SectionHeader } from "@/components/SectionHeader";
import { ListingsCarouselSkeleton } from "@/components/ListingCardSkeleton";
import { Reveal } from "@/components/Reveal";
import { buildExploreFilters, rankByPopularity } from "@/lib/marketplace";
import { getActiveOfferings } from "@/lib/travelAddons";
import { NowCovering } from "@/components/NowCovering";
import { SpotlightStays } from "@/components/SpotlightStays";
import { LastMinuteDeals } from "@/components/LastMinuteDeals";
import { FYLDE_COAST_DESTINATIONS } from "@/lib/destinations";
import { SITE_NAME, SITE_URL, SUPPORT_EMAIL } from "@/lib/seo";
import { cn } from "@/lib/cn";

// The four reasons to trust a booking, shown directly under the hero search
// so they're read in the same glance as it. Each is already true site-wide:
// payment runs through Stripe Checkout, every listing is a Fylde Coast host,
// only a guest with a completed paid stay can review, and every listing
// shows its cancellation policy before payment. TRUST_POINTS below is the
// fuller "Why FYStay?" version further down the page.
const TRUST_STRIP = [
  { icon: ShieldCheck, label: "Secure payments", detail: "Encrypted Stripe checkout" },
  { icon: MapPin, label: "Local hosts", detail: "Based on the Fylde Coast" },
  { icon: BadgeCheck, label: "Genuine reviews", detail: "Only from guests who stayed" },
  { icon: CalendarCheck, label: "Flexible cancellation", detail: "Where available, shown upfront" },
];

// "Why FYStay?": four short, checkable reasons - each already true
// site-wide (local hosts only, the full price before payment, reviews only
// from completed paid stays, transfers and services booked alongside).
const TRUST_POINTS = [
  { icon: MapPin, title: "Local", description: "Real Fylde Coast hosts and properties." },
  { icon: Receipt, title: "Transparent", description: "See the full price before you book." },
  { icon: Star, title: "Trusted", description: "Reviews only from guests who've stayed." },
  { icon: Compass, title: "Everything in one place", description: "Stay, travel and local services together." },
];

const title = "Local Accommodation in Blackpool & the Fylde Coast";
const description =
  "Search and book independent apartments, cottages and guest houses across Blackpool and the Fylde Coast. Real local hosts, genuine reviews, secure booking.";

// Per-user and database-backed throughout (auth() in PopularStaysSection,
// live listing counts), so the page was already rendered per request - this
// just stops `next build` from starting its database queries before
// discovering that. Same reasoning as sitemap.ts.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: SITE_URL },
  openGraph: { title, description, url: SITE_URL, type: "website" },
  twitter: { card: "summary_large_image", title, description },
};

/**
 * The homepage's one browse row of stays (see PopularStays): the most
 * popular published stays, narrowed by the kind of stay first (top rated,
 * family-sized, long-stay discounts, sea views), then by town (the busiest
 * few). See buildExploreFilters for the rules: each filter appears only
 * once enough stays genuinely match it, matches only what the card itself
 * shows, and has a "See all" link to the same filter on /search.
 * The selected filter is the homepage's ?stays= value (see PopularStays),
 * so coming Back from the results page shows the filter the guest left on.
 */
async function PopularStaysSection() {
  const [session, listings] = await Promise.all([
    auth(),
    prisma.listing.findMany({
      where: { published: true, suspendedAt: null },
      select: {
        id: true,
        title: true,
        city: true,
        country: true,
        pricePerNightCents: true,
        cleaningFeeCents: true,
        weeklyDiscountPercent: true,
        monthlyDiscountPercent: true,
        photos: true,
        amenities: true,
        maxGuests: true,
        bedrooms: true,
        latitude: true,
        longitude: true,
        createdAt: true,
        lastMinuteDiscountPercent: true,
        lastMinuteWindowDays: true,
        priceDropFromCents: true,
        priceDroppedAt: true,
        reviews: { where: { status: "PUBLISHED" }, select: { rating: true } },
      },
    }),
  ]);
  if (listings.length < 2) return null;

  const ranked = rankByPopularity(listings);
  const filters = buildExploreFilters(ranked);

  // Each stay is sent to the browser once; the filters refer to it by id.
  const shownIds = new Set(filters.flatMap((filter) => filter.listingIds));
  const shown = ranked.filter((listing) => shownIds.has(listing.id));

  const savedListingIds = session?.user
    ? (
        await prisma.savedListing.findMany({
          where: { userId: session.user.id, listingId: { in: [...shownIds] } },
          select: { listingId: true },
        })
      ).map((saved) => saved.listingId)
    : [];

  return (
    <section className="mt-10 sm:mt-14">
      <PopularStays
        title="Explore the Fylde Coast"
        subtitle={`${listings.length} stays from local hosts. Narrow it down by the kind of stay or by town.`}
        listings={shown}
        filters={filters}
        savedListingIds={savedListingIds}
        isLoggedIn={Boolean(session?.user)}
      />
    </section>
  );
}

export default async function Home() {
  const travelOfferings = await getActiveOfferings();

  // WebSite + SearchAction tells Google this site has an internal search it
  // can offer directly in results (a "sitelinks search box"), targeting the
  // real /search?city= URL the homepage's own search bar already uses -
  // not a hypothetical endpoint. Organization's areaServed is the same
  // named-town list as the "Now covering" badges and the Explore section
  // below, so this only ever states places FYStay actually covers.
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        name: SITE_NAME,
        url: SITE_URL,
        potentialAction: {
          "@type": "SearchAction",
          target: `${SITE_URL}/search?city={search_term_string}`,
          "query-input": "required name=search_term_string",
        },
      },
      {
        "@type": "Organization",
        name: SITE_NAME,
        url: SITE_URL,
        logo: `${SITE_URL}/apple-icon`,
        description,
        areaServed: FYLDE_COAST_DESTINATIONS.map((destination) => ({
          "@type": "Place",
          name: destination.name,
        })),
        contactPoint: {
          "@type": "ContactPoint",
          email: SUPPORT_EMAIL,
          contactType: "customer support",
          areaServed: "GB",
        },
      },
    ],
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />
      {/* The homepage opens as one continuous destination-first sequence:
          the video hero (headline at the bottom), then the search panel
          straddling the seam, the trust row, and the towns covered, then
          the discovery rails. The headline, search and everything below
          share the header's max-w-6xl grid, so they line up with the logo
          (the hero runs edge to edge, so its text sits in that same grid).

          The hero runs the full width of the page directly under the
          header - no framed, rounded panel - and its bottom dissolves into
          the cream page over a fixed band (80px on phones, 140px on tablets, 180px from lg):
          the footage's sand is close to the page's own colour, so the beach
          simply becomes the page instead of ending at an edge. The fade is a
          mask on the media layer only, so the headline above it is never
          faded. On phones it takes 37% of the screen (svh: the height with
          the browser's toolbars showing, so it doesn't resize as they
          collapse), which keeps the whole search panel, Search button
          included, above the fold on a typical phone. isolate keeps its
          layered video/scrim/text z-indexes inside the hero, so neither the
          sticky header nor the cream sheet has to out-rank them.

          The headline block is bottom-anchored with padding that keeps it
          clear of the fade band, where the search bar floats. */}
      <section className="relative isolate flex h-[37svh] min-h-[250px] w-full flex-col justify-end sm:h-[48svh] sm:min-h-[380px] lg:h-[68svh] lg:max-h-[700px] lg:min-h-[540px]">
        <div className="absolute inset-0 [mask-image:linear-gradient(to_top,transparent_0,#000_80px)] sm:[mask-image:linear-gradient(to_top,transparent_0,#000_140px)] lg:[mask-image:linear-gradient(to_top,transparent_0,#000_180px)]">
          <HeroBanner className="absolute inset-0 h-full w-full" />

          {/* Scrim, only where the text is: a whisper of shade at the very
              top, clear through the sky, Tower and pier, a warm-brown band
              (the brand's own dark, not near-black) behind the headline,
              easing off again into the fade so the sand meets the cream page
              in its own colour rather than as a muddy brown smudge. From lg
              the headline is left-aligned, so the band there is lighter and
              a wash from the left carries it instead. */}
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(46,24,14,0.06)_0%,rgba(46,24,14,0)_28%,rgba(46,24,14,0.44)_58%,rgba(46,24,14,0.5)_calc(100%-96px),rgba(46,24,14,0)_100%)] sm:bg-[linear-gradient(180deg,rgba(46,24,14,0.06)_0%,rgba(46,24,14,0)_28%,rgba(46,24,14,0.4)_55%,rgba(46,24,14,0.42)_calc(100%-160px),rgba(46,24,14,0)_100%)] lg:bg-[linear-gradient(180deg,rgba(46,24,14,0.05)_0%,rgba(46,24,14,0)_30%,rgba(46,24,14,0.22)_55%,rgba(46,24,14,0.26)_calc(100%-200px),rgba(46,24,14,0)_100%)]" />
          <div className="pointer-events-none absolute inset-0 hidden bg-[linear-gradient(90deg,rgba(46,24,14,0.5)_0%,rgba(46,24,14,0.18)_40%,rgba(46,24,14,0)_62%)] lg:block" />
        </div>

        <div className="relative z-10 mx-auto w-full max-w-6xl px-6 pb-[88px] [text-shadow:0_1px_18px_rgba(46,24,14,0.5)] sm:pb-[156px] lg:pb-[196px]">
          <h1 className="max-w-2xl text-[2rem] leading-[1.08] text-balance text-white min-[400px]:text-[2.2rem] sm:text-5xl lg:text-[3.5rem]">
            Find your stay on the Fylde Coast
          </h1>
          {/* One supporting line - the headline already says where. */}
          <p className="mt-2 max-w-2xl text-pretty text-[15px] leading-snug text-white/90 sm:mt-3 sm:text-lg sm:leading-relaxed">
            Apartments, cottages, hotels and guest houses from Fleetwood to Lytham.
          </p>
        </div>
      </section>

      {/* relative z-10 paints this (and the search bar inside it) over the
          isolated hero panel where the two overlap on lg, while staying
          under the sticky header. */}
      <div className="relative z-10 bg-background">
      <div className="mx-auto w-full max-w-6xl flex-1 px-6 pb-8">
        {/* The search panel: the solid search card (the same variant the
            /search page uses), the same fields and search logic as before.
            On phones it sits on the cream just below the video. From lg
            it's a single-row bar the full width of the page grid, raised.
            Both float up into the band where the video fades into the
            page. */}
        <div className="relative -mx-2 -mt-9 sm:mx-0 sm:-mt-20 lg:-mt-[112px]">
          <Suspense>
            <SearchBar liveUpdate={false} className="max-w-none lg:shadow-[var(--shadow-popover)]" />
          </Suspense>
        </div>

        {/* Trust row: read in the same glance as the search, as quiet
            icon-and-text items rather than cards or ruled cells - a 2x2
            grid on phones, one row from lg. */}
        <ul
          aria-label="Why book with FYStay"
          className="mt-7 grid grid-cols-2 gap-x-5 gap-y-6 px-1 sm:mt-6 sm:px-0 lg:mt-7 lg:grid-cols-4 lg:gap-x-8"
        >
          {TRUST_STRIP.map(({ icon: Icon, label, detail }) => (
            <li key={label} className="flex items-start gap-3 lg:pl-1">
              <Icon className="mt-px h-[18px] w-[18px] shrink-0 text-brand-600" aria-hidden />
              <div className="min-w-0">
                <p className="text-[13.5px] font-semibold leading-snug text-foreground sm:text-sm">{label}</p>
                <p className="mt-1 text-xs leading-relaxed text-stone-500 sm:text-[13px]">{detail}</p>
              </div>
            </li>
          ))}
        </ul>

        <div className="mt-9 lg:mt-10">
          <NowCovering />
        </div>

        {/* Discovery: stays, then towns, then trip types - each a swipeable
            rail or compact grid under one consistent header row, spaced as
            one sequence rather than separate pages. */}
        {/* Paid placements (see SpotlightStays) - renders nothing unless a
            host's Spotlight placement is live right now. */}
        <Suspense fallback={null}>
          <SpotlightStays />
        </Suspense>

        {/* Genuine last-minute deals and price drops (see LastMinuteDeals) -
            renders nothing on a day with no deals; the browse row below
            still lists every stay. */}
        <Suspense fallback={null}>
          <LastMinuteDeals />
        </Suspense>

        {/* The homepage's browse row of stays, filtered by kind of stay or
            by town (see PopularStaysSection). The towns themselves have their
            own Explore section (/destinations), so they aren't repeated here.
            Its placeholder holds the row's shape while it loads, so nothing
            below jumps when it arrives. */}
        <Suspense fallback={<PopularStaysSkeleton />}>
          <PopularStaysSection />
        </Suspense>

        {/* Getting here, and everything else FYStay offers, as one row:
            first the services FYStay offers through independent partners
            (a card per travel add-on category with a live offering - EV
            Exec's airport transfers today, see src/lib/partnerServices.ts;
            none when nothing is live, so the page never shows a promise
            with nothing behind it), then FYStay's own guest services. The
            generic "Airport transfers" card is left out while a live partner
            card already leads to the same page, and hosting has its own card
            at the end of the page. */}
        <Reveal className="mt-10 sm:mt-14">
          <SectionHeader
            title="More from FYStay"
            subtitle="Everything you need around your stay, booked in the same place."
            link={{ href: "/services", label: "All services" }}
          />
          <LargeCardRail label="More from FYStay">
            {travelOfferings.map((offering) => (
              <TravelAddonCard key={offering.id} offering={offering} />
            ))}
            {FYSTAY_SERVICES.filter(
              (service) => service.onHomepage && !(travelOfferings.length > 0 && service.href === "/travel-extras"),
            ).map(
              (service) => (
                <LargeCard
                  key={service.title}
                  href={service.href}
                  image={{ icon: service.icon, tone: "quiet" }}
                  title={service.title}
                  description={service.description}
                  meta={service.cta}
                />
              ),
            )}
          </LargeCardRail>
        </Reveal>

        <Reveal className="mt-14 border-t border-border-subtle pt-10">
          <h2 className="text-center text-xl font-bold text-foreground sm:text-2xl">Why FYStay?</h2>
          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {TRUST_POINTS.map(({ icon: Icon, title, description }) => (
              <div
                key={title}
                className="flex flex-col gap-3 rounded-2xl border border-border-subtle bg-surface p-5 shadow-[var(--shadow-card)]"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-700">
                  <Icon className="h-5 w-5" aria-hidden />
                </span>
                <div>
                  <h3 className="text-base font-semibold text-foreground">{title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-stone-500">{description}</p>
                </div>
              </div>
            ))}
          </div>
        </Reveal>

        {/* The one host-facing moment on an otherwise guest-facing homepage -
            a distinct gradient card (same signature-strip idea as the search
            card above) so it reads as a deliberate second front door, not an
            afterthought link buried in the footer. Routes to /host, which
            makes its own role-aware call on where "List your property"
            should actually go (sign-up vs. straight to a new listing for an
            existing host). */}
        <Reveal className="mt-14 overflow-hidden rounded-2xl bg-gradient-to-br from-brand-950 via-brand-800 to-brand-600 shadow-[var(--shadow-popover)]">
          <div className="flex flex-col items-center gap-5 px-6 py-10 text-center sm:flex-row sm:justify-between sm:px-10 sm:text-left">
            <div className="flex items-start gap-4">
              <span className="hidden h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/10 text-white sm:flex">
                <HomeIcon className="h-5 w-5" aria-hidden />
              </span>
              <div>
                <h2 className="text-xl font-bold text-white sm:text-2xl">
                  Own a place on the Fylde Coast?
                </h2>
                <p className="mt-1 max-w-md text-sm text-white/80">
                  Reach guests who want to stay here, and run bookings, calendar and payouts from
                  one dashboard.
                </p>
                <Suspense fallback={null}>
                  <LiveStayCount />
                </Suspense>
              </div>
            </div>
            <Link
              href="/host"
              className={cn(buttonVariants({ size: "lg" }), "shrink-0 bg-white text-brand-800 hover:bg-white/90")}
            >
              List your property
            </Link>
          </div>
        </Reveal>
      </div>
      </div>
    </>
  );
}

/** The Explore row's shape - heading, filter row, cards - while its stays load. */
function PopularStaysSkeleton() {
  return (
    <section className="mt-10 sm:mt-14" aria-hidden>
      <div className="mb-5 sm:mb-6">
        <h2 className="text-xl font-bold text-foreground sm:text-2xl">Explore the Fylde Coast</h2>
        <div className="skeleton-shimmer mt-2 h-4 w-64 max-w-full rounded" />
      </div>
      <div className="mb-6 flex h-10 gap-2 overflow-hidden">
        {[56, 88, 150, 96, 104].map((width) => (
          <div key={width} className="skeleton-shimmer h-9 shrink-0 rounded-full" style={{ width }} />
        ))}
      </div>
      <ListingsCarouselSkeleton />
    </section>
  );
}

/**
 * A single honest fact ("N stays live today") rather than any invented
 * urgency or growth claim - only rendered once there's at least one real
 * stay to count, so an empty catalog never states "0 stays live" as if
 * that were a selling point. Its own query (not threaded down from
 * PopularStaysSection above) since a plain count is cheap and
 * this is the one place on the page that needs exactly that number.
 */
async function LiveStayCount() {
  const count = await prisma.listing.count({ where: { published: true } });
  if (count === 0) return null;

  return (
    <p className="mt-3 text-xs font-medium text-white/70">
      {count} stay{count === 1 ? "" : "s"} already live across the Fylde Coast
    </p>
  );
}
