import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import {
  Compass,
  Home as HomeIcon,
  Lock,
  MapPin,
  MessageCircle,
  RotateCcw,
  Star,
  Users,
  Zap,
} from "lucide-react";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { SearchBar } from "@/components/SearchBar";
import { HeroBanner } from "@/components/HeroBanner";
import { ListingsGrid } from "@/components/search/ListingsGrid";
import { buttonVariants } from "@/components/ui/Button";
import { ListingsCarousel } from "@/components/ListingsCarousel";
import { ExploreDestinations } from "@/components/ExploreDestinations";
import { LargeCard, LargeCardRailSkeleton } from "@/components/LargeCard";
import { LargeCardRail } from "@/components/LargeCardRail";
import { FYSTAY_SERVICES } from "@/lib/services";
import { TripTypeCategories } from "@/components/TripTypeCategories";
import { TravelAddonsSection } from "@/components/TravelAddonsSection";
import { Reveal } from "@/components/Reveal";
import { beachStaysSection, groupByCity, recentlyAddedSection } from "@/lib/marketplace";
import { getActiveOfferings } from "@/lib/travelAddons";
import { SectionPills } from "@/components/SectionPills";
import { FYLDE_COAST_DESTINATIONS } from "@/lib/destinations";
import { SITE_NAME, SITE_URL, SUPPORT_EMAIL } from "@/lib/seo";
import { cn } from "@/lib/cn";

// A condensed, single-line read of four facts already true site-wide
// (Listing.instantBook defaults to true, Stripe checkout, every listing is
// a real Fylde Coast host, cancellation policies exist on every listing) -
// the value-proposition strip Jet2/Virgin Atlantic lead their own
// homepages with, right under the hero rather than buried in the full
// "Why FYStay?" section further down (see TRUST_POINTS below, which this
// doesn't replace - that section keeps its own full descriptions).
const TRUST_STRIP = [
  { icon: Zap, label: "Instant Book" },
  { icon: Lock, label: "Stripe checkout" },
  { icon: Users, label: "Local hosts" },
  { icon: RotateCcw, label: "Free cancellation" },
];

const TRUST_POINTS = [
  {
    icon: Users,
    title: "Local hosts, not a franchise",
    description:
      "Every stay is listed and managed by an individual host based on the Fylde Coast - never a resold listing or an absent management company.",
  },
  {
    icon: Compass,
    title: "A real Local Guide with every stay",
    description:
      "Live weather, where locals actually eat, hidden gems and what's on nearby - a genuine concierge brief on the town itself, not four sentences the host wrote once and forgot about.",
  },
  {
    icon: MapPin,
    title: "Genuinely local properties",
    description:
      "Apartments, cottages and guest houses across Blackpool, Lytham, St Annes, Poulton-le-Fylde, Fleetwood and Thornton-Cleveleys - real places on this coast, not imported inventory.",
  },
  {
    icon: MessageCircle,
    title: "Direct access to your host",
    description:
      "Once you've booked, your host's contact details are right there on your booking - no call centre standing between you and the person who actually knows the place.",
  },
  {
    icon: Star,
    title: "Genuine guest reviews",
    description: "Only a guest who's completed a paid stay can leave a review, so every rating reflects a real stay.",
  },
  {
    icon: Lock,
    title: "Secure, transparent booking",
    description: "Payments run through Stripe's encrypted checkout with the full price shown upfront - we never see your card details.",
  },
];

const title = "Local Accommodation in Blackpool & the Fylde Coast";
const description =
  "Search and book independent apartments, cottages and guest houses across Blackpool and the Fylde Coast. Real local hosts, genuine reviews, secure booking.";

// Per-user and database-backed throughout (auth() in MarketplaceSections,
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
 * Browse-by-category rows shown only on the homepage - a search instead
 * takes the visitor to the dedicated /search results page, so there's no
 * "active search" state to reconcile these against here any more.
 */
async function MarketplaceSections() {
  const [session, listings] = await Promise.all([
    auth(),
    prisma.listing.findMany({
      where: { published: true },
      include: { reviews: { where: { status: "PUBLISHED" }, select: { rating: true } } },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const savedListingIds = session?.user
    ? new Set(
        (
          await prisma.savedListing.findMany({
            where: { userId: session.user.id },
            select: { listingId: true },
          })
        ).map((s) => s.listingId),
      )
    : new Set<string>();

  const sections = [
    ...groupByCity(listings),
    beachStaysSection(listings),
    recentlyAddedSection(listings),
  ].filter((section) => section !== null);

  if (sections.length === 0) return null;

  return (
    <div className="mt-14 flex flex-col gap-12">
      {sections.map((section) => (
        <div key={section.key}>
          <h2 className="text-xl font-bold text-foreground sm:text-2xl">{section.title}</h2>
          <p className="mt-1 text-sm text-stone-500">{section.subtitle}</p>
          <div className="mt-6">
            <ListingsCarousel
              listings={section.listings}
              savedListingIds={savedListingIds}
              isLoggedIn={Boolean(session?.user)}
            />
          </div>
        </div>
      ))}
    </div>
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
      {/* Full-bleed backdrop, deliberately outside the max-w-6xl content
          container so it spans the entire viewport width. Purely a video
          moment - no rotating real-listing photo or caption here (that's
          what the search results and destination pages are for), so
          nothing on this section depends on the catalog having listings
          in it.

          Deliberately no overflow-hidden here: the video itself is
          already clipped to this box by its own object-cover (see
          HeroBanner), so this section doesn't need to clip anything to
          look right closed. But the search bar's date/guest popovers open
          downward and are taller than the sliver of room left below the
          bar - clipping the section would cut those panels off (confirmed
          on a real phone) instead of letting them float over the page
          content below, which is normal, expected dropdown behaviour. */}
      {/* -mt-[84px]/lg:-mt-[97px] pulls this section up underneath the
          navbar at every breakpoint (previously lg:-only, with a plain
          positive margin below lg instead - the navbar itself used to
          stay opaque and in-flow there, so nothing needed to overlap; now
          that it's transparent everywhere too, the hero needs to sit
          behind it everywhere too) - see NavbarChrome's own comment on why
          that's a negative margin on this sibling rather than making the
          nav position:absolute (which would ignore the cookie consent
          banner's flow height and overlap it). 84px/97px match that
          navbar's actual rendered height at each breakpoint (measured
          directly, not a round-number guess - lg: comes out taller because
          the desktop logo/tagline lockup (Logo size="lg", with the
          "Hotels · B&Bs · Apartments" tagline sized to span the full width
          of the "FYStay" wordmark beneath it, plus mt-2 clearance so the
          "y" descender's swash doesn't touch the tagline) is taller than
          the mobile icon-button row - the mobile logo lockup itself grew
          too, but it's absolutely positioned over the header rather than
          in flow, so it doesn't add to the header's own layout height
          there) - if the navbar's own padding/content ever changes height,
          this needs to move with it.

          h-[100svh] (small viewport height, not dvh - a hero shouldn't
          resize itself while the user is mid-scroll as mobile browser
          chrome collapses) rather than a fixed pixel height per breakpoint
          - the negative margin above already cancels out the navbar's own
          in-flow height, so this makes the video fill exactly the first
          screenful on any device instead of stopping ~150-200px short of
          the fold, which read as the hero being "tucked up" into a band at
          the top rather than a full-bleed moment. min-h-[560px] guards the
          shortest real viewports (a landscape phone); lg:max-h-[860px]
          stops it growing unbounded on a very tall desktop window, where a
          hero taller than that starts to feel like its own page rather
          than an opener. */}
      <section className="relative -mt-[84px] h-[100svh] min-h-[560px] w-full lg:-mt-[97px] lg:max-h-[860px]">
        <HeroBanner className="absolute inset-0 h-full w-full" />

        {/* Scrim over the video - darkens the sky band (behind the
            headline/subcopy) and the sand band (behind the search bar),
            left fully clear through the middle so the Tower, pier and
            beach still read at full strength. A held plateau (0-50%) at
            full opacity, not a fade starting at 0% - a straight two-stop
            linear-gradient (an earlier version of this) is already
            substantially faded by the time it reaches the middle of its
            own range, which put the subcopy's second line - sitting well
            inside what looked like "the opaque zone" on paper - over the
            pier's own crossbeams at only ~10% scrim opacity, unreadable.
            The plateau's own end (50%) is past the actual measured bottom
            edge of the headline+subcopy block at every breakpoint. */}
        <div className="pointer-events-none absolute inset-0 z-20 bg-[linear-gradient(180deg,rgba(12,9,7,0.75)_0%,rgba(12,9,7,0.75)_50%,rgba(12,9,7,0)_62%,rgba(12,9,7,0)_66%,rgba(12,9,7,0.55)_100%)]" />

        {/* No visible headline in the hero itself (removed by request) -
            this sr-only h1 keeps the page's one real heading for SEO/
            accessibility (every page needs exactly one h1), reusing the
            same string already in this page's own <title>/meta
            description above rather than inventing separate copy. */}
        <h1 className="sr-only">{title}</h1>

        {/* The search bar floats low over the video - close to the bottom
            edge, but with margin on every side (this wrapper's own
            bottom offset and horizontal padding) so no corner of the
            card ever touches the video's own frame - rather than the
            earlier full-bleed band this replaced.

            Leaves room below it (bottom-28/sm:bottom-32, not the old
            bottom-3/sm:bottom-4 hugging the very edge) for the "Now
            covering" pill row now living in-hero at every breakpoint - see
            below - rather than in its own separate section after the
            hero, which is what used to make this bar tolerate sitting
            right at the bottom edge.

            Raised from bottom-24/sm:bottom-28 by the same 16px the pill
            row below was pushed up by (to clear the hero-to-page blend's
            own curve, see that row's comment) - moving only the pill row
            would have closed this gap by that same 16px instead, so both
            move together to keep it the width it was.

            lg: moves up further still and switches from centered-on-
            viewport to left-aligned within the same max-w-6xl/px-6
            container as the headline and navbar above, rather than
            centered independently of them. */}
        <div className="pointer-events-none absolute inset-x-0 bottom-28 z-40 flex justify-center px-4 sm:bottom-32 lg:inset-x-0 lg:bottom-32 lg:mx-auto lg:max-w-6xl lg:justify-start lg:px-6">
          {/* w-full max-w-4xl (not just letting the flex item shrink-wrap
              its content) so the bar actually grows to fill the width
              this row allows, rather than only ever rendering as wide as
              its fields' own natural size. */}
          <div className="pointer-events-auto w-full max-w-4xl lg:max-w-none">
            {/* The four section pills (Stays / Explore / Travel / Services,
                see src/lib/siteSections.ts) above the search panel. Stays
                shows pressed here: this search bar is the Stays search.
                Same dark-glass tokens as the search panel below so the two
                read as one attached unit. mx-auto max-w-4xl matches the
                search bar's own centred width, so at lg: the row's left
                edge lines up with the bar's. */}
            <SectionPills variant="hero" className="mx-auto mb-2 flex w-full max-w-4xl justify-center lg:justify-start" />
            <Suspense>
              <SearchBar liveUpdate={false} variant="hero" />
            </Suspense>
          </div>
        </div>

        {/* Mobile/tablet: "Now covering" pills sit inside the hero itself,
            just below the search bar - previously this lived in its own
            plain section after the hero (on the page's cream background),
            which read as a separate, lower-effort afterthought instead of
            part of the same premium video moment the search bar is in.

            Styling matches the reference the user shared: a champagne-gold
            accent (the label flanked by hairline rules, and a plain pin
            icon per pill in the same gold) against outlined, glassy pills
            rather than the solid white badges this used to be - the
            outlined treatment reads as sitting *in* the video rather than
            floating a light card on top of it.

            A single scrolling line at every width below lg, not wrapping
            to multiple rows at sm: (an earlier version of this did) - this
            block is anchored to the hero's bottom edge and grows upward as
            its own content gets taller, so a two-row wrap at tablet width
            pushed the "Now covering" label up far enough to collide with
            the search bar sitting right above it. A fixed single-line
            height keeps the gap between them predictable at every
            breakpoint down here.

            bottom-8/sm:bottom-10 (not bottom-4/bottom-6, this row's
            original offset from before the hero-to-page blend below
            existed) leaves clear headroom above the cream section's own
            -mt-5/-mt-6 rise - otherwise the two edges land within a few
            px of each other and the rounded curve visibly grazes this
            row's pill icons/text instead of tucking in cleanly beneath
            them. */}
        <div className="pointer-events-none absolute inset-x-0 bottom-8 z-30 flex flex-col items-center gap-2.5 px-6 sm:bottom-10 lg:hidden">
          <div className="flex w-full max-w-[220px] items-center gap-3">
            <span
              className="h-px flex-1 bg-gradient-to-r from-transparent to-amber-300/60"
              aria-hidden
            />
            <span className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.2em] text-amber-300">
              Now covering
            </span>
            <span
              className="h-px flex-1 bg-gradient-to-l from-transparent to-amber-300/60"
              aria-hidden
            />
          </div>
          {/* Auto-drifting marquee, not a manual swipe strip - the
              destination list is rendered twice back to back so
              translating the track by exactly one copy's width (-50%,
              see .animate-marquee in globals.css) loops seamlessly. The
              second copy is aria-hidden and untabbable so a screen reader
              or keyboard user only ever encounters each town once. */}
          <div className="relative w-full max-w-md overflow-hidden">
            <div className="flex w-max items-center gap-2 px-6 pb-1 animate-marquee">
              {[0, 1].map((copy) => (
                <div
                  key={copy}
                  className="flex shrink-0 items-center gap-2"
                  aria-hidden={copy === 1}
                >
                  {FYLDE_COAST_DESTINATIONS.map((destination) => (
                    <Link
                      key={destination.slug}
                      href={`/search?city=${encodeURIComponent(destination.searchCity)}`}
                      tabIndex={copy === 1 ? -1 : undefined}
                      className="focus-ring pointer-events-auto flex shrink-0 items-center gap-1.5 rounded-full border border-amber-200/30 bg-white/5 px-3.5 py-1.5 text-sm font-medium text-white/90 backdrop-blur-sm transition-all hover:-translate-y-0.5 hover:border-amber-200/60 hover:bg-white/10 active:scale-95 active:bg-white/10"
                    >
                      <MapPin className="h-3.5 w-3.5 shrink-0 text-amber-300" aria-hidden />
                      {destination.name}
                    </Link>
                  ))}
                </div>
              ))}
            </div>
            <div
              className="pointer-events-none absolute inset-y-0 left-0 w-6 bg-gradient-to-r from-black/50 to-transparent"
              aria-hidden
            />
            <div
              className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-black/50 to-transparent"
              aria-hidden
            />
          </div>
        </div>

        {/* Desktop-only: "Now covering" overlaps the hero's own bottom
            edge here - the exact same list stays in its original spot, in
            a bolder badge style, in-hero at <lg (see just above); this
            isn't a duplicate content addition, just where the same links
            render at each breakpoint.

            Deliberately plainer here than the pill/icon treatment above:
            six bordered, icon-carrying badges in a row read as a
            directory footer next to the search bar's own restraint - an
            inline index line (name, name, name) reads as an editorial
            "we cover these towns" note instead. */}
        <div className="pointer-events-none absolute inset-x-0 bottom-6 z-30 mx-auto hidden max-w-6xl px-6 lg:block">
          <div className="pointer-events-auto flex flex-wrap items-baseline gap-x-1.5 gap-y-1 text-sm">
            <span className="mr-1 font-medium text-white/60">Now covering</span>
            {FYLDE_COAST_DESTINATIONS.map((destination, i) => (
              <span key={destination.slug} className="flex items-baseline">
                <Link
                  href={`/search?city=${encodeURIComponent(destination.searchCity)}`}
                  className="focus-ring rounded-sm font-medium text-white/90 underline decoration-white/30 underline-offset-4 transition-colors hover:text-white hover:decoration-white/70"
                >
                  {destination.name}
                </Link>
                {i < FYLDE_COAST_DESTINATIONS.length - 1 && (
                  <span className="ml-1.5 text-white/30" aria-hidden>
                    &middot;
                  </span>
                )}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Rounded top + a small negative margin pulls this section up over
          the hero's own last few pixels, instead of the two meeting in a
          hard rectangular line - reads as one continuous page (a sheet
          rising over the video) rather than a video banner bolted onto a
          separate page below it. relative z-50 is required, not
          decorative: this div is a plain static sibling of the hero
          <section>, and everything inside that section is absolutely
          positioned with its own z-index (up to z-40, the search bar) -
          without a higher z-index of its own here, those layers would
          paint on top of this rounded edge instead of tucking behind it,
          even though they come earlier in the DOM. The overlap amount is
          deliberately small (and smaller again at lg: the desktop "Now
          covering" row is a plain text line, not a pill block, so it
          sits closer to the hero's true bottom edge than the mobile/
          tablet pill row does) so it never actually covers them, just
          softens the seam beneath.

          pb-8 only, not the pt-8/sm:pt-10 this used to also carry - that
          top padding existed to leave room for the "Now covering" strip
          that used to open this section; now that it lives inside the
          hero instead (see above), "Hand-picked stays" own mt-10 just
          below is the only top spacing this section needs. */}
      <div className="relative z-50 -mt-5 rounded-t-[28px] bg-background pt-px sm:-mt-6 sm:rounded-t-[36px] lg:-mt-3">
      <div className="mx-auto w-full max-w-6xl flex-1 px-6 pb-8">
        {/* Phones: a 2x2 grid split by hairlines - one down the middle, and
            one under each top-row item that stops short of it. sm and up:
            the original single row. */}
        <div className="mt-4 grid grid-cols-2 border-b border-border-subtle text-sm text-stone-600 sm:mt-8 sm:flex sm:flex-wrap sm:items-center sm:gap-x-6 sm:gap-y-2 sm:pb-6">
          {TRUST_STRIP.map(({ icon: Icon, label }, index) => (
            <div
              key={label}
              className={
                index % 2 === 0
                  ? "border-r border-border-subtle pr-4 sm:border-r-0 sm:pr-0"
                  : "pl-4 sm:pl-0"
              }
            >
              <span
                className={`flex items-center gap-2.5 whitespace-nowrap py-3 sm:gap-1.5 sm:py-0 ${
                  index < 2 ? "border-b border-border-subtle sm:border-b-0" : ""
                }`}
              >
                <Icon className="h-[18px] w-[18px] shrink-0 text-brand-600 sm:h-4 sm:w-4" aria-hidden />
                {label}
              </span>
            </div>
          ))}
        </div>

        {/* Large, image-led card rails (see LargeCardRail) for the four
            sections a picture actually helps with - stays, towns, travel
            and services, in the same order as the section pills - each
            showing one full card plus a peek of the next on phones and
            about two and a half on desktop. Everything after them keeps
            its existing, denser layout. */}
        <div className="mt-10">
          <h2 className="text-xl font-bold text-foreground sm:text-2xl">Hand-picked stays</h2>
          <p className="mt-1 text-sm text-stone-500">
            Hand-picked local places to stay, ready to book today.
          </p>
          <div className="mt-6">
            <Suspense fallback={<LargeCardRailSkeleton />}>
              <ListingsGrid searchParams={{}} showResultsView={false} />
            </Suspense>
          </div>
        </div>

        {/* Each town links to its own /destinations/[slug] landing page (see
            lib/destinations.ts). */}
        <Reveal className="mt-14">
          <h2 className="text-xl font-bold text-foreground sm:text-2xl">Explore the Fylde Coast</h2>
          <p className="mt-1 text-sm text-stone-500">
            Six towns we actually know - each with real local stays and its own Local Guide, not a
            search filter with a photo on it.
          </p>
          <div className="mt-6">
            <Suspense fallback={<LargeCardRailSkeleton />}>
              <ExploreDestinations variant="large" />
            </Suspense>
          </div>
        </Reveal>

        {/* One card per travel add-on category with a live offering.
            Renders nothing when none is live (same "don't show a promise
            with nothing behind it" rule every other conditional section on
            this page already follows). */}
        {travelOfferings.length > 0 && (
          <Reveal className="mt-14">
            <h2 className="text-xl font-bold text-foreground sm:text-2xl">Travel</h2>
            <p className="mt-1 text-sm text-stone-500">Getting here and getting around, added to your stay.</p>
            <div className="mt-6">
              <TravelAddonsSection offerings={travelOfferings} />
            </div>
          </Reveal>
        )}

        <Reveal className="mt-14">
          <h2 className="text-xl font-bold text-foreground sm:text-2xl">Services</h2>
          <p className="mt-1 text-sm text-stone-500">Everything FYStay offers beyond the stay itself.</p>
          <div className="mt-6">
            <LargeCardRail label="Services">
              {FYSTAY_SERVICES.map((service) => (
                <LargeCard
                  key={service.title}
                  href={service.href}
                  image={{ icon: service.icon, gradient: service.gradient }}
                  title={service.title}
                  description={service.description}
                  meta={service.cta}
                />
              ))}
            </LargeCardRail>
          </div>
        </Reveal>

        <div className="mt-14">
          <h2 className="text-xl font-bold text-foreground sm:text-2xl">Find your perfect stay</h2>
          <p className="mt-1 text-sm text-stone-500">
            Browse by what you&apos;re after, not just where you&apos;re going.
          </p>
          <div className="mt-6">
            <TripTypeCategories />
          </div>
        </div>

        <Suspense fallback={null}>
          <MarketplaceSections />
        </Suspense>

        <Reveal className="mt-14 border-t border-border-subtle pt-10">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-xl font-bold text-foreground sm:text-2xl">Why FYStay?</h2>
            <p className="mt-1 text-sm text-stone-500">
              FYStay is built around one coastline, not spread thin across the world - everything
              here is designed for booking a stay on the Fylde Coast, and nowhere else.
            </p>
          </div>
          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {TRUST_POINTS.map(({ icon: Icon, title, description }) => (
              <div
                key={title}
                className="flex flex-col gap-3 rounded-2xl border border-border-subtle bg-surface p-5 shadow-[var(--shadow-card)] transition-shadow duration-300 hover:shadow-[var(--shadow-card-hover)]"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-700">
                  <Icon className="h-5 w-5" aria-hidden />
                </span>
                <div>
                  <p className="text-sm font-semibold text-foreground">{title}</p>
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
                  List it on FYStay: local exposure, a local customer base, and one simple
                  dashboard to manage it all.
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

/**
 * A single honest fact ("N stays live today") rather than any invented
 * urgency or growth claim - only rendered once there's at least one real
 * stay to count, so an empty catalog never states "0 stays live" as if
 * that were a selling point. Its own query (not threaded down from
 * MarketplaceSections above) since a plain count is cheap and
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
