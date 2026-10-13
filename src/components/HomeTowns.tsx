import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { FYLDE_COAST_DESTINATIONS } from "@/lib/destinations";
import { DESTINATION_PHOTOS } from "@/lib/destinationPhotos";
import { DESTINATION_ART, FALLBACK_ART } from "@/components/destinationArt";
import { cn } from "@/lib/cn";

/** A few words on each town's character, in the card's small caps line. */
const TOWN_TAGLINES: Record<string, string> = {
  blackpool: "Seaside vibes & iconic views",
  lytham: "Coastal charm & boutique stays",
  "st-annes": "Sandy beach & seafront gardens",
  "poulton-le-fylde": "Market town & rail links",
  fleetwood: "Waterfront & local life",
  "thornton-cleveleys": "Open coast & promenade walks",
};

/**
 * The homepage's town cards, each opening that town's page (its stays and
 * Local Guide). Real photography where FYStay has it (DESTINATION_PHOTOS),
 * otherwise the same icon-and-gradient art as /destinations - never a
 * stand-in stock photo of another place. A swipeable row on phones and
 * tablets (the next card peeks in), a grid from lg.
 *
 * The row is out of flow inside a fixed-height wrapper below lg, the same
 * fix ListingsCarousel documents: an in-flow row wider than
 * the screen widens a phone's page-fit viewport.
 */
export function HomeTowns() {
  return (
    <section aria-labelledby="home-towns-heading">
      <span aria-hidden className="block h-[3px] w-10 rounded-full bg-brand-600" />
      <h2 id="home-towns-heading" className="mt-3 text-2xl font-bold text-foreground sm:text-3xl">
        Popular on the Fylde Coast
      </h2>
      <p className="mt-1 text-sm text-stone-500 sm:text-base">Handpicked places, loved by visitors.</p>

      <div className="relative mt-5 h-[156px] min-[400px]:h-[172px] sm:h-[200px] lg:h-auto">
        <ul className="absolute inset-x-0 top-0 -mx-6 flex snap-x snap-mandatory scroll-px-6 gap-3 overflow-x-auto px-6 pb-2 [scrollbar-width:none] sm:gap-4 lg:static lg:mx-0 lg:grid lg:grid-cols-3 lg:gap-6 lg:overflow-visible lg:px-0 [&::-webkit-scrollbar]:hidden">
          {FYLDE_COAST_DESTINATIONS.map((destination) => {
            const art = DESTINATION_ART[destination.slug] ?? FALLBACK_ART;
            const Icon = art.icon;
            const photo = DESTINATION_PHOTOS[destination.slug]?.tile;
            return (
              <li key={destination.slug} className="w-[40%] shrink-0 snap-start min-[400px]:w-[38%] sm:w-[30%] lg:w-auto">
                <Link
                  href={`/destinations/${destination.slug}`}
                  className={cn(
                    "focus-ring group relative flex h-[148px] flex-col justify-end overflow-hidden rounded-2xl bg-gradient-to-br p-3 shadow-[var(--shadow-card)] ring-1 ring-black/5 transition-shadow duration-300 hover:shadow-[var(--shadow-card-hover)] min-[400px]:h-[164px] sm:h-[192px] sm:p-4 lg:h-auto lg:aspect-[16/10] lg:p-5",
                    art.gradient,
                  )}
                >
                  {photo ? (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={photo}
                        alt=""
                        loading="lazy"
                        className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/25 to-transparent" />
                    </>
                  ) : (
                    <Icon className="absolute -right-3 -top-3 h-24 w-24 text-white/15 sm:h-32 sm:w-32" aria-hidden />
                  )}
                  <div className="relative flex items-end justify-between gap-1">
                    <div className="min-w-0">
                      <p className="font-serif text-base font-bold leading-tight text-white min-[400px]:text-lg lg:text-2xl">
                        {destination.name}
                      </p>
                      <p className="mt-1 text-[9.5px] font-medium uppercase leading-snug tracking-[0.08em] text-white/90 min-[400px]:text-[10px] lg:text-xs">
                        {TOWN_TAGLINES[destination.slug]}
                      </p>
                    </div>
                    <ArrowRight className="mb-0.5 h-4 w-4 shrink-0 text-white transition-transform group-hover:translate-x-0.5 lg:h-5 lg:w-5" aria-hidden />
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
