import { Suspense } from "react";
import type { Metadata } from "next";
import { SearchBar } from "@/components/SearchBar";
import { HeroSlides } from "@/components/HeroBanner";
import { LargeCardRailSkeleton } from "@/components/LargeCard";
import { HomeTowns } from "@/components/HomeTowns";
import { HomeServices } from "@/components/HomeServices";
import { SpotlightStays } from "@/components/SpotlightStays";
import { LastMinuteDeals } from "@/components/LastMinuteDeals";
import { FYLDE_COAST_DESTINATIONS } from "@/lib/destinations";
import { SITE_NAME, SITE_URL, SUPPORT_EMAIL } from "@/lib/seo";
import { HERO_SLIDES, type HeroSlideKey } from "@/lib/heroSlides";
import { PAGE_SEARCH_ID } from "@/lib/searchSummary";
import { locationWhere, matchesLocation, parseBrowseRequest } from "@/lib/searchRequest";
import { bookableHostWhere } from "@/lib/stripeConnect";
import { prisma } from "@/lib/prisma";

// Brand first on the homepage alone (absolute, so the "· FYStay" template
// doesn't repeat it), then the regional searches it should answer - see
// docs/brand/fystay-brand.md for the title convention.
const title = "FYStay | Holiday Stays in Blackpool & the Fylde Coast, Lancashire";
const description =
  "Find your stay with FYStay: independent holiday homes, apartments and guest houses from local hosts in Blackpool and on the Fylde Coast, Lancashire. Full price shown before you book.";

// Per-user and database-backed throughout (auth() and live stays in
// SpotlightStays and LastMinuteDeals), so the page was already rendered per request - this
// just stops `next build` from starting its database queries before
// discovering that. Same reasoning as sitemap.ts.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { absolute: title },
  description,
  alternates: { canonical: SITE_URL },
  openGraph: { title, description, url: SITE_URL, type: "website" },
  twitter: { card: "summary_large_image", title, description },
};

/**
 * The hero's places that have at least one live stay, found the same way
 * the search its slide links to would find them - so a slide never leads
 * to an empty page. If none has, HeroSlides shows the first (Blackpool).
 */
async function liveHeroSlideKeys(): Promise<HeroSlideKey[]> {
  const live = await Promise.all(
    HERO_SLIDES.map(async (slide) => {
      const location = parseBrowseRequest(new URLSearchParams(slide.search))?.location;
      if (!location) return false;
      const listings = await prisma.listing
        .findMany({
          where: { published: true, suspendedAt: null, ...bookableHostWhere(), ...locationWhere(location) },
          select: { latitude: true, longitude: true, city: true },
        })
        .catch(() => []);
      return listings.some((listing) => matchesLocation(location, listing));
    }),
  );
  return HERO_SLIDES.filter((_, i) => live[i]).map((slide) => slide.key);
}

export default async function Home() {
  const heroSlideKeys = await liveHeroSlideKeys();
  // WebSite + SearchAction tells Google this site has an internal search it
  // can offer directly in results (a "sitelinks search box"), targeting the
  // real /search?city= URL the homepage's own search bar already uses -
  // not a hypothetical endpoint. Organization's areaServed is the same
  // named-town list as the homepage's town cards, so this only ever states places FYStay actually covers.
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
        slogan: "For Your Stay",
        // The towns with their own pages - not "Lancashire" as a whole,
        // which would claim coverage FYStay's listings don't back yet.
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
      {/* Phones: the first screen is the header, the hero and the search
          card, which sits just above the bottom tab bar - the wrapper fills
          the screen between the header (69px) and the tab bar (57px plus
          the home-indicator area), the card keeps 16px clear above the bar,
          and the hero takes whatever the card leaves, so the photo stays visible behind the headline. From
          lg the hero is a fixed share of the window with the search bar
          straddling its foot.

          The hero runs edge to edge and dissolves into the cream page at
          the bottom (a mask on the photos only), crossfading through the
          places with live stays (HeroSlides). isolate keeps its layers' z-indexes inside
          the hero. */}
      <div className="flex min-h-[calc(100svh-70px-58px-env(safe-area-inset-bottom))] flex-col lg:block lg:min-h-0">
        <section className="relative isolate flex min-h-[230px] w-full flex-1 flex-col lg:h-[64svh] lg:max-h-[660px] lg:min-h-[520px] lg:flex-none">
          <HeroSlides slideKeys={heroSlideKeys} />
        </section>

        {/* The search card - the page's main control - rising a little into
            the hero's faded foot, 16px clear of the tab bar. Sticky below lg
            so it's never under the bar when something above takes more room
            than the wrapper allows for (the Preview banner, larger text): it
            rises over the hero instead, and scrolls away normally. */}
        <div className="sticky bottom-[calc(57px+env(safe-area-inset-bottom))] z-10 mx-auto w-full max-w-6xl px-4 pb-4 sm:px-6 lg:relative lg:bottom-auto lg:pb-0">
          <div id={PAGE_SEARCH_ID} className="-mt-14 sm:-mt-20 lg:-mt-[112px]">
            <Suspense>
              <SearchBar liveUpdate={false} className="max-w-none shadow-[var(--shadow-popover)]" />
            </Suspense>
          </div>
        </div>
      </div>

      <div className="relative z-10 bg-background">
        <div className="mx-auto w-full max-w-6xl flex-1 px-6 pb-12">
          {/* The main attractions: Spotlight stays (paid placements, labelled,
              then guests' favourites) and genuine last-minute deals. */}
          <Suspense fallback={<RailSkeleton />}>
            <SpotlightStays />
          </Suspense>
          <Suspense fallback={null}>
            <LastMinuteDeals />
          </Suspense>

          <HomeTowns />
          <HomeServices />
        </div>
      </div>
    </>
  );
}

/** Spotlight's shape while its stays load, so nothing below jumps when they arrive. */
function RailSkeleton() {
  return (
    <section className="mt-10 sm:mt-14" aria-hidden>
      <div className="skeleton-shimmer h-3 w-32 rounded" />
      <div className="skeleton-shimmer mt-3 h-7 w-56 max-w-full rounded" />
      <div className="mt-6">
        <LargeCardRailSkeleton />
      </div>
    </section>
  );
}
