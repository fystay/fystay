import Link from "next/link";
import { Anchor, FerrisWheel, MapPin, TrainFront, Umbrella, Waves, Wind, type LucideIcon } from "lucide-react";
import { pageMetadata } from "@/lib/seo";
import { FYLDE_COAST_DESTINATIONS } from "@/lib/destinations";
import { DESTINATION_PHOTOS } from "@/lib/destinationPhotos";
import { cn } from "@/lib/cn";
import { prisma } from "@/lib/prisma";
import { bookableHostWhere } from "@/lib/stripeConnect";

export const metadata = pageMetadata({
  title: "Holiday Destinations on the Fylde Coast & in Lancashire",
  description:
    "Where to stay with FYStay: Blackpool, Lytham, St Annes, Poulton-le-Fylde, Fleetwood and Thornton-Cleveleys on the Fylde Coast, each with local stays and its own Local Guide - plus FYStay's first stays in North Lancashire.",
  path: "/destinations",
});

/** Each town's icon and gradient, shown when it has no photo yet (see DESTINATION_PHOTOS). */
const DESTINATION_ART: Record<string, { icon: LucideIcon; gradient: string }> = {
  blackpool: { icon: FerrisWheel, gradient: "from-brand-600 via-brand-700 to-brand-900" },
  lytham: { icon: Wind, gradient: "from-brand-500 to-ink" },
  "st-annes": { icon: Umbrella, gradient: "from-brand-400 to-brand-900" },
  "poulton-le-fylde": { icon: TrainFront, gradient: "from-amber-700 to-ink" },
  fleetwood: { icon: Anchor, gradient: "from-ink to-brand-950" },
  "thornton-cleveleys": { icon: Waves, gradient: "from-sky-500 to-brand-800" },
};

/** Fallback look for a town with no bespoke icon/gradient in DESTINATION_ART - none currently, since all six towns FYStay covers have their own, but kept so a future addition to destinations.ts fails gracefully rather than crashing this page. */
const FALLBACK_ART = { icon: MapPin, gradient: "from-stone-500 to-ink" };

// The "beyond the Fylde Coast" list below is read from live listings, so
// it's never built at deploy time (see scripts/ci/check-build-database-free.mjs).
export const dynamic = "force-dynamic";

/**
 * Towns with live, bookable stays that don't have their own destination
 * page yet (e.g. Carnforth in North Lancashire) - read from real listings,
 * so this page only ever names a place where a guest can actually book,
 * and an area graduates to its own page once it has enough stays and a
 * guide (docs/brand/fystay-brand.md, destination plan).
 */
async function townsBeyondTheFyldeCoast(): Promise<{ city: string; count: number }[]> {
  const coveredCities = FYLDE_COAST_DESTINATIONS.map((destination) => destination.searchCity);
  const groups = await prisma.listing
    .groupBy({
      by: ["city"],
      where: { published: true, suspendedAt: null, ...bookableHostWhere(), city: { notIn: coveredCities } },
      _count: { _all: true },
      orderBy: { city: "asc" },
    })
    .catch(() => []);
  return groups.map((group) => ({ city: group.city, count: group._count._all }));
}

export default async function DestinationsIndexPage() {
  const otherTowns = await townsBeyondTheFyldeCoast();
  return (
    <div className="mx-auto w-full max-w-6xl flex-1 px-6 py-12">
      <h1 className="text-2xl font-bold text-foreground sm:text-3xl">Where to stay with FYStay</h1>
      <p className="mt-2 max-w-2xl text-sm text-stone-500 sm:text-base">
        FYStay started on the Fylde Coast and is growing across Lancashire. Each town below has
        its own page with local stays and a Local Guide written for that town - not a generic
        city page.
      </p>

      <h2 className="mt-10 text-lg font-bold text-foreground sm:text-xl">The Fylde Coast</h2>
      <p className="mt-1 max-w-2xl text-sm text-stone-500">
        Blackpool&rsquo;s promenade, Lytham and St Annes&rsquo; two different seafronts,
        Poulton-le-Fylde&rsquo;s market square, Fleetwood&rsquo;s fishing port and
        Thornton-Cleveleys&rsquo; open coast.
      </p>

      <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3">
        {FYLDE_COAST_DESTINATIONS.map((destination) => {
          const art = DESTINATION_ART[destination.slug] ?? FALLBACK_ART;
          const Icon = art.icon;
          const photoSrc = DESTINATION_PHOTOS[destination.slug]?.tile;

          return (
            <Link
              key={destination.slug}
              href={`/destinations/${destination.slug}`}
              className={cn(
                "focus-ring group relative flex aspect-[4/3] flex-col justify-end overflow-hidden rounded-2xl bg-gradient-to-br p-5 shadow-[var(--shadow-card)] ring-1 ring-black/5 transition-all duration-300 hover:-translate-y-1.5 hover:shadow-[var(--shadow-card-hover)] active:scale-[0.98]",
                art.gradient,
              )}
            >
              {photoSrc ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={photoSrc}
                    alt=""
                    className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/15 to-transparent" />
                </>
              ) : (
                <Icon
                  className="absolute -right-4 -top-4 h-36 w-36 text-white/15 transition-transform duration-300 group-hover:scale-110 group-hover:rotate-6"
                  aria-hidden
                />
              )}
              <div className="relative">
                <p className="text-lg font-bold text-white sm:text-xl">{destination.name}</p>
                <p className="mt-1 line-clamp-2 text-xs text-white/85 sm:text-sm">
                  {destination.description}
                </p>
              </div>
            </Link>
          );
        })}
      </div>

      {otherTowns.length > 0 && (
        <section className="mt-12">
          <h2 className="text-lg font-bold text-foreground sm:text-xl">Beyond the Fylde Coast</h2>
          <p className="mt-1 max-w-2xl text-sm text-stone-500">
            FYStay&rsquo;s newest stays elsewhere in Lancashire. These towns get their own page
            and Local Guide as more local hosts join.
          </p>
          <ul className="mt-4 flex flex-wrap gap-2">
            {otherTowns.map(({ city, count }) => (
              <li key={city}>
                <Link
                  href={`/search?city=${encodeURIComponent(city)}`}
                  className="focus-ring inline-flex items-center gap-1.5 rounded-full border border-border-subtle bg-surface px-4 py-2 text-sm font-medium text-foreground hover:border-brand-300 hover:text-brand-700"
                >
                  <MapPin className="h-4 w-4 text-brand-600" aria-hidden />
                  {city}
                  <span className="text-stone-500">
                    · {count} stay{count === 1 ? "" : "s"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
