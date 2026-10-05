import Link from "next/link";
import { MapPin } from "lucide-react";
import { FYLDE_COAST_DESTINATIONS } from "@/lib/destinations";
import { cn } from "@/lib/cn";

/**
 * The towns FYStay covers, as pills that each open that town's search
 * results. Sits directly under the homepage search panel, as a slow,
 * continuous drift through every town (.animate-marquee in globals.css),
 * paused while a pointer is over it or a pill has keyboard focus. The edges
 * fade out rather than cutting pills off mid-word.
 *
 * The list is rendered twice back to back so translating the track by
 * exactly one copy's width (-50%) loops seamlessly; the second copy is
 * aria-hidden and untabbable, so a screen reader or keyboard user meets each
 * town once. Under prefers-reduced-motion nothing moves: the second copy
 * goes and the row becomes a plain swipeable strip.
 *
 * The track is absolutely positioned inside a fixed-height wrapper, the same
 * fix ListingsCarousel documents: an in-flow row wider than the screen
 * widens a phone's page-fit viewport and lets the whole page pan sideways.
 */
export function NowCovering() {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-brand-700">Now covering</p>
      <div className="relative mt-1.5 h-11">
        <div className="absolute inset-x-0 top-0 -mx-6 overflow-hidden [mask-image:linear-gradient(90deg,transparent,#000_24px,#000_calc(100%-24px),transparent)] motion-reduce:overflow-x-auto motion-reduce:[scrollbar-width:none] lg:mx-0 lg:[mask-image:linear-gradient(90deg,transparent,#000_40px,#000_calc(100%-40px),transparent)] motion-reduce:[&::-webkit-scrollbar]:hidden">
          <div className="animate-marquee flex w-max py-1">
            {[0, 1].map((copy) => (
              <ul
                key={copy}
                aria-hidden={copy === 1 || undefined}
                className={cn(
                  // pr-2 matches gap-2, so both copies are the same width and the loop has no seam.
                  "flex shrink-0 gap-2 pr-2",
                  copy === 1 && "motion-reduce:hidden",
                )}
              >
                {FYLDE_COAST_DESTINATIONS.map((destination) => (
                  <li key={destination.slug} className="shrink-0">
                    <Link
                      href={`/search?city=${encodeURIComponent(destination.searchCity)}`}
                      tabIndex={copy === 1 ? -1 : undefined}
                      className="focus-ring flex h-9 items-center gap-1.5 whitespace-nowrap rounded-full border border-border-subtle bg-surface px-3.5 text-sm font-medium text-stone-700 shadow-[var(--shadow-card)] transition-colors hover:border-brand-200 hover:bg-brand-50 hover:text-foreground active:bg-brand-50"
                    >
                      <MapPin className="h-3.5 w-3.5 shrink-0 text-brand-600" aria-hidden />
                      {destination.name}
                    </Link>
                  </li>
                ))}
              </ul>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
