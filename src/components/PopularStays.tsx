"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, MapPin } from "lucide-react";
import { ListingsCarousel } from "@/components/ListingsCarousel";
import type { ListingCardData } from "@/components/ListingCard";
import { SectionHeader } from "@/components/SectionHeader";
import type { ExploreFilter } from "@/lib/marketplace";
import { cn } from "@/lib/cn";

// Fades the end(s) of the filter row that have more buttons past them.
// Literal classes so Tailwind picks them up.
const EDGE_FADE = {
  none: "",
  end: "[mask-image:linear-gradient(to_right,#000_calc(100%-64px),transparent)]",
  start: "[mask-image:linear-gradient(to_left,#000_calc(100%-64px),transparent)]",
  both: "[mask-image:linear-gradient(to_right,transparent,#000_64px,#000_calc(100%-64px),transparent)]",
};

/**
 * The homepage's one browse row of stays (headed "Explore the Fylde Coast"):
 * the most popular stays, with buttons to narrow it by the kind of stay or
 * by town (it replaces separate "Popular in <town>" and "Beach stays" rows,
 * which showed the same stays over and over, the "Find your perfect stay"
 * tiles, and the town cards, which the Discover section covers). Filters
 * and their stays are worked out on the server (see PopularStaysSection in
 * src/app/page.tsx); each stay is sent once and filters refer to it by id.
 * Switching filter swaps the row in place - no navigation - and updates
 * the header's "See all" link to the same filter on the results page.
 *
 * The selection lives in the homepage's own URL (?stays=), set with
 * replaceState so it adds no history entry: going Back from the results
 * page (or a stay) returns to the filter the guest left on, whether the
 * page comes back from the router's cache or is rendered afresh (the
 * server reads the same parameter, so there's no flash of "All" first).
 */
export function PopularStays({
  title,
  subtitle,
  listings,
  filters,
  savedListingIds,
  isLoggedIn,
}: {
  title: string;
  subtitle: string;
  listings: ListingCardData[];
  filters: ExploreFilter[];
  savedListingIds: string[];
  isLoggedIn: boolean;
}) {
  // replaceState keeps useSearchParams in step (see the Next.js linking guide).
  const active = useSearchParams().get("stays") ?? filters[0].key;
  const byId = useMemo(() => new Map(listings.map((listing) => [listing.id, listing])), [listings]);
  const saved = useMemo(() => new Set(savedListingIds), [savedListingIds]);
  const filter = filters.find((candidate) => candidate.key === active) ?? filters[0];
  const shown = filter.listingIds.flatMap((id) => byId.get(id) ?? []);

  // Which ends of the filter row have more buttons past them. Measured after
  // hydration (useEffect + a frame, never during it), so clicks made while
  // the page becomes interactive aren't dropped.
  const scroller = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState({ start: false, end: false });
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const start = el.scrollLeft > 4;
        const end = el.scrollLeft + el.clientWidth < el.scrollWidth - 4;
        setMore((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));
      });
    };
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    const resize = new ResizeObserver(measure);
    resize.observe(el);
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener("scroll", measure);
      resize.disconnect();
    };
  }, []);
  const fade = more.start && more.end ? "both" : more.start ? "start" : more.end ? "end" : "none";
  function select(key: string) {
    const url = new URL(window.location.href);
    if (key === filters[0].key) url.searchParams.delete("stays");
    else url.searchParams.set("stays", key);
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }

  // A filter chosen before this visit (Back from the results page) may sit
  // past the edge of the row - bring it into view once, after hydration.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const pressed = scroller.current?.querySelector<HTMLElement>('[aria-pressed="true"]');
      const row = scroller.current;
      if (!pressed || !row || pressed.offsetLeft + pressed.offsetWidth <= row.clientWidth) return;
      row.scrollTo({ left: pressed.offsetLeft - 48, behavior: "instant" });
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  const slide = (direction: 1 | -1) =>
    scroller.current?.scrollBy({ left: direction * scroller.current.clientWidth * 0.6, behavior: "smooth" });

  return (
    <>
      <SectionHeader
        title={title}
        subtitle={subtitle}
        link={{ href: filter.href, label: filter.seeAllLabel, shortLabel: "See all" }}
      />
      {filters.length > 1 && (
        // One line at every size, scrolling sideways when it doesn't fit.
        // Out of flow inside a fixed-height wrapper, like NowCovering, so a
        // row of buttons wider than the screen can't widen the page.
        <div className="relative mb-6 h-10">
          <div
            ref={scroller}
            role="group"
            aria-label="Filter stays"
            className={cn(
              "absolute inset-x-0 top-0 -mx-6 flex gap-2 overflow-x-auto scroll-smooth px-6 pb-1 [scrollbar-width:none] lg:mx-0 lg:px-0 [&::-webkit-scrollbar]:hidden",
              EDGE_FADE[fade],
            )}
          >
            {filters.map((candidate, index) => {
              const isActive = candidate.key === filter.key;
              const startsTowns = candidate.group === "town" && filters[index - 1]?.group === "kind";
              return (
                <Fragment key={candidate.key}>
                  {startsTowns && <span aria-hidden className="mx-1 h-5 w-px shrink-0 self-center bg-stone-300" />}
                  <button
                    type="button"
                    onClick={() => select(candidate.key)}
                    aria-pressed={isActive}
                    className={cn(
                      "focus-ring inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-4 text-sm font-medium transition-colors duration-200",
                      isActive
                        ? "border-brand-700 bg-brand-700 text-white"
                        : "border-border-subtle bg-surface text-stone-700 hover:border-brand-200 hover:bg-brand-50",
                    )}
                  >
                    {/* Towns carry a pin, so the two groups read apart at a glance. */}
                    {candidate.group === "town" && (
                      <MapPin
                        className={cn("-ml-0.5 h-3.5 w-3.5 shrink-0", isActive ? "text-white/80" : "text-brand-600")}
                        aria-hidden
                      />
                    )}
                    {candidate.label}
                  </button>
                </Fragment>
              );
            })}
          </div>
          {/* Mouse helpers on desktop; touch swipes and keyboard focus scroll
              the row by themselves, so these stay out of the tab order. */}
          {more.start && (
            <button
              type="button"
              tabIndex={-1}
              aria-hidden
              onClick={() => slide(-1)}
              className="absolute left-0 top-0 hidden h-9 w-9 items-center justify-center rounded-full border border-border-subtle bg-surface text-stone-700 shadow-[var(--shadow-card)] transition-colors hover:bg-brand-50 lg:flex"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          )}
          {more.end && (
            <button
              type="button"
              tabIndex={-1}
              aria-hidden
              onClick={() => slide(1)}
              className="absolute right-0 top-0 hidden h-9 w-9 items-center justify-center rounded-full border border-border-subtle bg-surface text-stone-700 shadow-[var(--shadow-card)] transition-colors hover:bg-brand-50 lg:flex"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          )}
        </div>
      )}
      {/* Keyed by filter, so a new selection starts the row from its first stay. */}
      <ListingsCarousel key={filter.key} listings={shown} savedListingIds={saved} isLoggedIn={isLoggedIn} />
    </>
  );
}
