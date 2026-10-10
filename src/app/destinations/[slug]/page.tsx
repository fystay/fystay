import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { ListingsGrid } from "@/components/search/ListingsGrid";
import { ListingsGridSkeleton } from "@/components/ListingCardSkeleton";
import { LocalGuide } from "@/components/LocalGuide";
import { TownHero } from "@/components/TownHero";
import { FYLDE_COAST_DESTINATIONS, type FyldeCoastDestination } from "@/lib/destinations";
import { LOCAL_GUIDES } from "@/lib/localGuide";
import { TOWN_HERO_CONTENT } from "@/lib/townHero";
import { loadConciergeSources } from "@/lib/localData/concierge";
import { pageMetadata, SITE_URL } from "@/lib/seo";

/**
 * Looks up the listing a guest arrived from (via the "Read the full X Local
 * Guide" link on a listing page, which appends ?from=<listingId>) so the
 * guide below can show real distances from that specific property rather
 * than nothing. A fresh, authoritative lookup rather than trusting raw
 * coordinates in the URL - a stale or tampered `from` value just falls
 * back to the guide's default, non-location-aware behaviour.
 */
async function findOriginListing(listingId: string | undefined) {
  if (!listingId) return null;
  const listing = await prisma.listing
    .findUnique({
      where: { id: listingId, published: true },
      select: { title: true, latitude: true, longitude: true },
    })
    .catch(() => null);
  if (!listing || listing.latitude === null || listing.longitude === null) return null;
  return { title: listing.title, latitude: listing.latitude, longitude: listing.longitude };
}

type SearchParams = Record<string, string | string[] | undefined>;

function findDestination(slug: string): FyldeCoastDestination | undefined {
  return FYLDE_COAST_DESTINATIONS.find((destination) => destination.slug === slug);
}

function parseDateParam(value: string | string[] | undefined): Date | null {
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

// One real, indexable page per town instead of everything funnelling
// through the noindexed /search?city= results page - the exact gap
// destinations.ts was written to fill (see its doc comment), so a search
// for "accommodation in Blackpool" has a dedicated, crawlable URL to rank
// rather than a filtered view of the homepage's own listings.
export function generateStaticParams() {
  return FYLDE_COAST_DESTINATIONS.map((destination) => ({ slug: destination.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const destination = findDestination(slug);
  if (!destination) return {};

  // "{intent} in {town}, Fylde Coast · FYStay" (docs/brand/fystay-brand.md).
  // Lytham and St Annes keep separate pages but are searched for together,
  // so both name the combined town too.
  const title = `Holiday Accommodation in ${destination.name}, Fylde Coast`;
  const lythamStAnnes = destination.slug === "lytham" || destination.slug === "st-annes";
  const description = `${destination.description} Find your stay in ${destination.name}${lythamStAnnes ? " (Lytham St Annes)" : ""}: independent holiday homes, apartments and guest houses from local hosts, with the full price shown before you book.`;

  return pageMetadata({ title, description, path: `/destinations/${destination.slug}` });
}

export default async function DestinationPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const [{ slug }, resolvedSearchParams] = await Promise.all([params, searchParams]);
  const destination = findDestination(slug);
  if (!destination) notFound();

  const fromParam = resolvedSearchParams.from;
  const hasGuide = Boolean(LOCAL_GUIDES[destination.slug]);
  const [fromListing, conciergeSources] = await Promise.all([
    findOriginListing(typeof fromParam === "string" ? fromParam : undefined),
    hasGuide
      ? loadConciergeSources(destination.slug)
      : Promise.resolve({ weather: null, places: [], editorial: [], events: [] }),
  ]);

  const checkIn = parseDateParam(resolvedSearchParams.checkIn);
  const checkOut = parseDateParam(resolvedSearchParams.checkOut);
  const heroContent = TOWN_HERO_CONTENT[destination.slug];

  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: SITE_URL },
      {
        "@type": "ListItem",
        position: 2,
        name: destination.name,
        item: `${SITE_URL}/destinations/${destination.slug}`,
      },
    ],
  };

  return (
    <div className="mx-auto w-full max-w-6xl flex-1 px-6 py-6">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd).replace(/</g, "\\u003c") }}
      />

      <nav aria-label="Breadcrumb" className="text-sm text-stone-500">
        <Link href="/" className="hover:text-brand-700 hover:underline">
          Home
        </Link>
        <span className="mx-1.5">/</span>
        <span className="text-foreground">{destination.name}</span>
      </nav>

      {heroContent && (
        <TownHero
          destination={destination}
          hero={heroContent}
          weather={conciergeSources.weather}
          exploreHref="#quick-discovery"
        />
      )}

      <div className="mt-8">
        <h2 className="text-xl font-bold text-foreground sm:text-2xl">Accommodation in {destination.name}</h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-stone-600">{destination.description}</p>

        <div className="mt-6">
          <Suspense fallback={<ListingsGridSkeleton />}>
            <ListingsGrid
              searchParams={{ ...resolvedSearchParams, city: destination.searchCity }}
              showResultsView
            />
          </Suspense>
        </div>
      </div>

      <LocalGuide
        destination={destination}
        fromListing={fromListing}
        conciergeSources={conciergeSources}
        checkIn={checkIn}
        checkOut={checkOut}
      />
    </div>
  );
}
