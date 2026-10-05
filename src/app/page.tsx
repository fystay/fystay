import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  CalendarCheck,
  Compass,
  Home as HomeIcon,
  Lock,
  MapPin,
  MessageCircle,
  ShieldCheck,
  Star,
  Users,
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
import { NowCovering } from "@/components/NowCovering";
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
      {/* The homepage opens as one continuous destination-first sequence:
          the video hero (headline at the bottom), then the search panel
          straddling the seam, the trust row, and the towns covered, then
          the discovery rails. The headline, search and everything below
          share the header's max-w-6xl grid, so they line up with the logo.

          -mt-[84px]/lg:-mt-[97px] pulls the hero up under the transparent
          navbar (NavbarChrome); those match the navbar's measured height at
          each breakpoint and need to move with it if it changes. The hero
          fills most of the first screen without taking all of it (svh so it
          doesn't resize as mobile browser chrome collapses), so the search
          panel is visible on landing.

          The headline block is bottom-anchored with padding that clears the
          cream sheet's 24px rise (and on lg, the search bar pulled a further
          36px up over the seam). */}
      <section className="relative -mt-[84px] flex h-[60svh] min-h-[480px] w-full flex-col justify-end lg:-mt-[97px] lg:h-[76svh] lg:max-h-[760px] lg:min-h-[600px]">
        <HeroBanner className="absolute inset-0 h-full w-full" />

        {/* Scrim: a band at the top so the navbar and section control stay
            legible, clear through the middle so the Tower and pier read at
            full strength, then a deepening band at the bottom behind the
            headline. From lg a soft wash from the left also sits behind the
            left-aligned headline. Same warm near-black throughout. */}
        <div className="pointer-events-none absolute inset-0 z-20 bg-[linear-gradient(180deg,rgba(12,9,7,0.65)_0%,rgba(12,9,7,0.3)_28%,rgba(12,9,7,0)_42%,rgba(12,9,7,0.5)_68%,rgba(12,9,7,0.85)_100%)]" />
        <div className="pointer-events-none absolute inset-0 z-20 hidden bg-[linear-gradient(90deg,rgba(12,9,7,0.4)_0%,rgba(12,9,7,0)_55%)] lg:block" />

        {/* Below lg the section control sits directly under the header's
            logo (from lg it moves into the header itself - see Navbar). The
            offset matches the navbar height the -mt above cancels. */}
        <div className="absolute inset-x-0 top-[84px] z-30 mx-auto max-w-6xl px-6 lg:hidden">
          <SectionPills variant="hero" className="flex justify-center" />
        </div>

        <div className="relative z-30 mx-auto w-full max-w-6xl px-6 pb-12 [text-shadow:0_1px_16px_rgba(12,9,7,0.35)] lg:pb-[84px]">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-white/85 sm:text-xs">
            <MapPin className="h-3.5 w-3.5 shrink-0 text-brand-500" aria-hidden />
            Fylde Coast specialists
          </p>
          <h1 className="mt-3 max-w-2xl text-[2rem] leading-[1.08] text-balance text-white min-[400px]:text-[2.2rem] sm:text-5xl lg:text-[3.5rem]">
            Find your stay on the Fylde Coast
          </h1>
          <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-white/85 sm:text-lg">
            Apartments, cottages and guest houses from Fleetwood to Lytham, each listed by a host
            who lives here.
          </p>
        </div>
      </section>

      {/* The cream sheet rises over the hero's last 24px with a rounded top,
          so the page reads as one surface sliding up over the video rather
          than a banner bolted onto a separate page. relative z-50 is
          required: it lets the search bar inside it paint over the hero
          (whose own layers go up to z-30) where the two overlap on lg. */}
      <div className="relative z-50 -mt-6 rounded-t-[28px] bg-background pt-px sm:rounded-t-[36px]">
      <div className="mx-auto w-full max-w-6xl flex-1 px-6 pb-8">
        {/* The search panel: the solid search card (the same variant the
            /search page uses), the same fields and search logic as before.
            On phones it sits on the cream just below the video. From lg
            it's a single-row bar the full width of the page grid, raised
            and pulled up to sit across the seam. */}
        <div className="relative -mx-2 mt-5 sm:mx-0 lg:-mt-9">
          <Suspense>
            <SearchBar liveUpdate={false} className="max-w-none lg:shadow-[var(--shadow-popover)]" />
          </Suspense>
        </div>

        {/* Trust row: read in the same glance as the search, as quiet
            icon-and-text items rather than cards - a 2x2 grid on phones,
            one divided row from lg. */}
        <ul
          aria-label="Why book with FYStay"
          className="mt-5 grid grid-cols-2 gap-x-4 gap-y-4 lg:mt-6 lg:grid-cols-4 lg:gap-0 lg:divide-x lg:divide-border-subtle"
        >
          {TRUST_STRIP.map(({ icon: Icon, label, detail }) => (
            <li key={label} className="flex items-start gap-2.5 lg:px-6 lg:first:pl-1">
              <Icon className="mt-0.5 h-[18px] w-[18px] shrink-0 text-brand-600" aria-hidden />
              <div className="min-w-0">
                <p className="text-[13px] font-semibold leading-snug text-foreground sm:text-sm">{label}</p>
                <p className="mt-0.5 text-xs leading-snug text-stone-500 sm:text-[13px]">{detail}</p>
              </div>
            </li>
          ))}
        </ul>

        <div className="mt-7 border-t border-border-subtle pt-5 lg:mt-8">
          <NowCovering />
        </div>

        {/* Discovery: stays, then towns, then trip types - each a swipeable
            rail or compact grid under one consistent header row, spaced as
            one sequence rather than separate pages. */}
        <section className="mt-10 sm:mt-14">
          <SectionHeader
            title="Hand-picked stays"
            subtitle="Hand-picked local places to stay, ready to book today."
            link={{ href: "/search", label: "View all" }}
          />
          <Suspense fallback={<LargeCardRailSkeleton />}>
            <ListingsGrid searchParams={{}} showResultsView={false} />
          </Suspense>
        </section>

        {/* Each town links to its own /destinations/[slug] landing page (see
            lib/destinations.ts). */}
        <Reveal className="mt-10 sm:mt-14">
          <SectionHeader
            title="Explore the Fylde Coast"
            subtitle="Six towns we actually know, each with real local stays and its own Local Guide."
            link={{ href: "/destinations", label: "All towns" }}
          />
          <Suspense fallback={<LargeCardRailSkeleton />}>
            <ExploreDestinations variant="large" />
          </Suspense>
        </Reveal>

        <section className="mt-10 sm:mt-14">
          <SectionHeader
            title="Find your perfect stay"
            subtitle="Browse by what you're after, not just where you're going."
          />
          <TripTypeCategories />
        </section>

        {/* One card per travel add-on category with a live offering.
            Renders nothing when none is live (same "don't show a promise
            with nothing behind it" rule every other conditional section on
            this page already follows). */}
        {travelOfferings.length > 0 && (
          <Reveal className="mt-10 sm:mt-14">
            <SectionHeader title="Travel" subtitle="Getting here and getting around, added to your stay." />
            <TravelAddonsSection offerings={travelOfferings} />
          </Reveal>
        )}

        <Reveal className="mt-10 sm:mt-14">
          <SectionHeader
            title="Services"
            subtitle="Everything FYStay offers beyond the stay itself."
            link={{ href: "/services", label: "All services" }}
          />
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
        </Reveal>

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

/** One header row for every homepage discovery section: title and subtitle, with an optional "View all"-style link on the right. */
function SectionHeader({
  title,
  subtitle,
  link,
}: {
  title: string;
  subtitle: string;
  link?: { href: string; label: string };
}) {
  return (
    <div className="mb-5 sm:mb-6">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-xl font-bold text-foreground sm:text-2xl">{title}</h2>
        {link && (
          <Link
            href={link.href}
            className="focus-ring flex shrink-0 items-center gap-1 rounded-sm text-sm font-medium text-brand-700 hover:text-brand-800"
          >
            {link.label}
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        )}
      </div>
      <p className="mt-1 text-sm text-stone-500">{subtitle}</p>
    </div>
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
