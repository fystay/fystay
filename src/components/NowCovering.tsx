import Link from "next/link";
import { MapPin } from "lucide-react";
import { FYLDE_COAST_DESTINATIONS } from "@/lib/destinations";

/**
 * The towns FYStay covers, as pills that each open that town's search
 * results. Sits directly under the homepage search panel. Phones: one
 * swipeable line that bleeds to the screen edges. lg: all six fit, so the
 * row wraps in place instead.
 *
 * Below lg the scroller is absolutely positioned inside a fixed-height
 * wrapper, the same fix ListingsCarousel documents: an in-flow row wider
 * than the screen widens a phone's page-fit viewport and lets the whole
 * page pan sideways.
 */
export function NowCovering() {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-brand-700">Now covering</p>
      <div className="relative mt-1.5 h-11 lg:h-auto">
        <ul className="absolute inset-x-0 top-0 -mx-6 flex gap-2 overflow-x-auto overscroll-x-contain px-6 py-1 [scrollbar-width:none] lg:static lg:mx-0 lg:flex-wrap lg:overflow-visible lg:px-0 [&::-webkit-scrollbar]:hidden">
          {FYLDE_COAST_DESTINATIONS.map((destination) => (
            <li key={destination.slug} className="shrink-0">
              <Link
                href={`/search?city=${encodeURIComponent(destination.searchCity)}`}
                className="focus-ring flex h-9 items-center gap-1.5 whitespace-nowrap rounded-full border border-border-subtle bg-surface px-3.5 text-sm font-medium text-stone-700 shadow-[var(--shadow-card)] transition-colors hover:border-brand-200 hover:bg-brand-50 hover:text-foreground active:bg-brand-50"
              >
                <MapPin className="h-3.5 w-3.5 shrink-0 text-brand-600" aria-hidden />
                {destination.name}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
