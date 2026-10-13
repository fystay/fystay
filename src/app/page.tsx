import { Suspense } from "react";
import type { Metadata } from "next";
import { SearchBar } from "@/components/SearchBar";
import { HeroBanner } from "@/components/HeroBanner";
import { LargeCardRailSkeleton } from "@/components/LargeCard";
import { HomeTowns } from "@/components/HomeTowns";
import { HomeServices } from "@/components/HomeServices";
import { BrandStatement } from "@/components/BrandStatement";
import { SpotlightStays } from "@/components/SpotlightStays";
import { LastMinuteDeals } from "@/components/LastMinuteDeals";
import { FYLDE_COAST_DESTINATIONS } from "@/lib/destinations";
import { SITE_NAME, SITE_URL, SUPPORT_EMAIL } from "@/lib/seo";

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

export default function Home() {
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
          the screen between the header (87px) and the tab bar (57px plus
          the home-indicator area), the card keeps 16px clear above the bar,
          and the hero takes whatever the card leaves, so the Fylde Coast stays visible behind the headline. From
          lg the hero is a fixed share of the window with the search bar
          straddling its foot.

          The hero runs edge to edge and dissolves into the cream page at
          the bottom (a mask on the media only). A warm grade sits on the
          real Blackpool footage, and a cream wash where the text sits keeps
          the dark headline readable on every frame. isolate keeps its
          layers' z-indexes inside the hero. */}
      <div className="flex min-h-[calc(100svh-88px-58px-env(safe-area-inset-bottom))] flex-col lg:block lg:min-h-0">
        <section className="relative isolate flex min-h-[230px] w-full flex-1 flex-col lg:h-[64svh] lg:max-h-[660px] lg:min-h-[520px] lg:flex-none">
          <div className="absolute inset-0 overflow-hidden [mask-image:linear-gradient(to_top,transparent_0,#000_90px)] lg:[mask-image:linear-gradient(to_top,transparent_0,#000_180px)]">
            {/* On phones the frame is zoomed toward the Tower so it stands
                beside the headline rather than as a speck on the horizon. */}
            <HeroBanner className="absolute inset-0 h-full w-full origin-[92%_40%] scale-[1.35] sm:scale-100" />
            <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,#f2b27e_0%,#f6c99c_45%,#e9a878_100%)] opacity-60 mix-blend-soft-light" />
            <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(246,243,236,0.8)_0%,rgba(246,243,236,0.5)_32%,rgba(246,243,236,0)_55%)] sm:bg-[linear-gradient(90deg,rgba(246,243,236,0.86)_0%,rgba(246,243,236,0.55)_38%,rgba(246,243,236,0)_62%)]" />
          </div>

          <div className="relative z-10 mx-auto w-full max-w-6xl px-6 pt-7 sm:pt-12 lg:pt-20">
            <div className="max-w-[18rem] min-[400px]:max-w-[19.5rem] sm:max-w-md lg:max-w-xl">
              <p className="flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.22em] text-brand-700 sm:text-xs">
                <span aria-hidden className="h-[2px] w-8 rounded-full bg-brand-600" />
                The Fylde Coast
              </p>
              <h1 className="mt-2.5 text-[2.05rem] font-bold leading-[1.04] tracking-[-0.01em] text-foreground min-[400px]:text-[2.3rem] sm:mt-3 sm:text-[2.85rem] lg:text-[4.1rem]">
                Popular on the <span className="block text-brand-600">Fylde Coast</span>
              </h1>
              <p className="mt-2.5 max-w-[16.5rem] text-pretty text-[13.5px] font-medium leading-snug text-foreground/85 sm:mt-4 sm:max-w-sm sm:text-base">
                Holiday homes, apartments and guest houses from local hosts.
              </p>
            </div>
          </div>
        </section>

        {/* The search card - the page's main control - rising a little into
            the hero's faded foot, with a small gap above the tab bar. */}
        <div className="relative z-10 mx-auto w-full max-w-6xl px-4 pb-4 sm:px-6 lg:pb-0">
          <div className="-mt-14 sm:-mt-20 lg:-mt-[112px]">
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
          <BrandStatement />
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
