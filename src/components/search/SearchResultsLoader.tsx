import { Skeleton } from "@/components/ui/Skeleton";
import { ListingCardSkeleton } from "@/components/ListingCardSkeleton";

const SKELETON_COUNT = 8;
const MAX_STAGGER_STEPS = 5;
const STAGGER_STEP_MS = 70;

/**
 * Suspense fallback for ListingsGrid on the /search results page. Mirrors
 * that component's own toolbar-row + grid shape exactly (results count,
 * filter/sort pills, view toggle, then the card grid) so swapping in the
 * real content never shifts layout - the "seamless" part of the brief.
 * Pure server-rendered markup, no "use client": the motion comes entirely
 * from CSS (see globals.css), so it appears the instant this streams in,
 * before hydration.
 */
export function SearchResultsLoader() {
  return (
    <div className="flex flex-col gap-5" aria-live="polite" aria-busy="true">
      <span className="sr-only">Searching for stays…</span>

      <div
        className="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle pb-4"
        aria-hidden
      >
        <div className="flex flex-wrap items-center gap-2">
          <Skeleton className="h-5 w-16" />
          <Skeleton className="h-9 w-20 rounded-full" />
          <Skeleton className="h-9 w-24 rounded-full" />
        </div>
        <Skeleton className="h-9 w-28 rounded-full" />
      </div>

      <div className="flex flex-col items-center gap-3 py-2 text-center">
        <p className="animate-search-caption-in font-serif text-lg italic text-stone-600">
          Finding your stay&hellip;
        </p>
        <div className="relative h-[3px] w-40 overflow-hidden rounded-full bg-brand-50">
          <span className="search-sweep" />
        </div>
      </div>

      <div
        className="grid grid-cols-1 gap-y-8 sm:grid-cols-3 sm:gap-x-6 sm:gap-y-10 lg:grid-cols-4"
        aria-hidden
      >
        {Array.from({ length: SKELETON_COUNT }).map((_, i) => (
          <div
            key={i}
            className="animate-search-reveal-in"
            style={{ animationDelay: `${Math.min(i, MAX_STAGGER_STEPS) * STAGGER_STEP_MS}ms` }}
          >
            <ListingCardSkeleton />
          </div>
        ))}
      </div>
    </div>
  );
}
