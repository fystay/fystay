import Image from "next/image";
import Link from "next/link";
import { Anchor, FerrisWheel, TrainFront, Umbrella, Waves, Wind, type LucideIcon } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { cn } from "@/lib/cn";
import { isOptimizableImage } from "@/lib/image";
import { FYLDE_COAST_DESTINATIONS } from "@/lib/destinations";
import { DESTINATION_PHOTOS } from "@/lib/destinationPhotos";
import { LargeCard } from "@/components/LargeCard";
import { LargeCardRail } from "@/components/LargeCardRail";

export const DESTINATION_ART: Record<string, { icon: LucideIcon; gradient: string }> = {
  blackpool: { icon: FerrisWheel, gradient: "from-brand-600 via-brand-700 to-brand-900" },
  lytham: { icon: Wind, gradient: "from-brand-500 to-ink" },
  "st-annes": { icon: Umbrella, gradient: "from-brand-400 to-brand-900" },
  "poulton-le-fylde": { icon: TrainFront, gradient: "from-amber-700 to-ink" },
  fleetwood: { icon: Anchor, gradient: "from-ink to-brand-950" },
  "thornton-cleveleys": { icon: Waves, gradient: "from-sky-500 to-brand-800" },
};

/**
 * Every town FYStay covers, not a curated subset - since the 2026 local-
 * knowledge push cut the roster down to six deliberately-chosen towns (see
 * destinations.ts), there's no longer a "the best four" to lead with
 * versus a long tail to hide; featuring all six is what makes the
 * homepage's coverage claim genuinely checkable at a glance.
 */
const FEATURED_SLUGS = FYLDE_COAST_DESTINATIONS.map((d) => d.slug);

export function ExploreDestinationsSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 sm:gap-6">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="skeleton-shimmer aspect-[4/3] w-full rounded-2xl sm:aspect-[5/4]" />
      ))}
    </div>
  );
}

function DestinationTile({
  name,
  href,
  icon: Icon,
  gradient,
  subtitle,
  photoSrc,
}: {
  name: string;
  href: string;
  icon: LucideIcon;
  gradient: string;
  subtitle: string;
  /** Real, licensed photography for this town, if any - see DESTINATION_PHOTOS. */
  photoSrc?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "focus-ring group relative flex aspect-[4/3] flex-col justify-end overflow-hidden rounded-2xl bg-gradient-to-br p-4 shadow-[var(--shadow-card)] ring-1 ring-black/5 transition-all duration-300 hover:-translate-y-1.5 hover:shadow-[var(--shadow-card-hover)] active:scale-[0.98] sm:aspect-[16/11] sm:p-6",
        gradient,
      )}
    >
      {photoSrc ? (
        <>
          <Image
            src={photoSrc}
            alt=""
            fill
            sizes="(min-width: 1024px) 400px, (min-width: 640px) 50vw, 100vw"
            unoptimized={!isOptimizableImage(photoSrc)}
            className="object-cover transition-transform duration-500 group-hover:scale-110"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/15 to-transparent" />
        </>
      ) : (
        <Icon
          className="absolute -right-4 -top-4 h-32 w-32 text-white/15 transition-transform duration-300 group-hover:scale-110 group-hover:rotate-6 sm:h-40 sm:w-40"
          aria-hidden
        />
      )}
      <div className="relative">
        <p className="text-base font-bold text-white sm:text-xl">{name}</p>
        <p className="mt-0.5 text-xs text-white/85 sm:text-sm">{subtitle}</p>
      </div>
    </Link>
  );
}

/**
 * A geographic index of the towns FYStay covers. Each tile links to that
 * town's dedicated /destinations/[slug] landing page rather than the
 * noindexed /search?city= results view, so the homepage's own internal
 * links point at a real, indexable, "Accommodation in {town}"-titled page
 * search engines can actually rank. Fetches its own listing counts (one
 * grouped count query) rather than taking them as a prop, matching how the
 * other independent homepage sections (FeaturedHero, MarketplaceSections)
 * each own their own data below their Suspense boundary in page.tsx.
 */
export async function ExploreDestinations({ variant = "grid" }: { variant?: "grid" | "large" } = {}) {
  const counts = await prisma.listing.groupBy({
    by: ["city"],
    where: { published: true },
    _count: { _all: true },
  });
  const countByCity = new Map(counts.map((row) => [row.city, row._count._all]));

  const featured = FYLDE_COAST_DESTINATIONS.filter((d) => FEATURED_SLUGS.includes(d.slug));
  const subtitleFor = (searchCity: string) => {
    const count = countByCity.get(searchCity) ?? 0;
    return count > 0 ? `${count} stay${count === 1 ? "" : "s"} to explore` : "Coming soon";
  };

  // The homepage's large-card rail (see LargeCardRail): the same towns,
  // links and counts as the grid, plus each town's one-line description.
  if (variant === "large") {
    return (
      <LargeCardRail label="Explore the Fylde Coast">
        {featured.map((destination) => {
          const art = DESTINATION_ART[destination.slug];
          const photoSrc = DESTINATION_PHOTOS[destination.slug]?.tile;
          return (
            <LargeCard
              key={destination.slug}
              href={`/destinations/${destination.slug}`}
              image={photoSrc ? { photoSrc } : { icon: art.icon, gradient: art.gradient }}
              title={destination.name}
              description={destination.description}
              meta={subtitleFor(destination.searchCity)}
            />
          );
        })}
      </LargeCardRail>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 sm:gap-6">
      {featured.map((destination) => {
        const art = DESTINATION_ART[destination.slug];
        return (
          <DestinationTile
            key={destination.slug}
            name={destination.name}
            href={`/destinations/${destination.slug}`}
            icon={art.icon}
            gradient={art.gradient}
            subtitle={subtitleFor(destination.searchCity)}
            photoSrc={DESTINATION_PHOTOS[destination.slug]?.tile}
          />
        );
      })}
    </div>
  );
}
