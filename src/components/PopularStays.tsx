"use client";

import { useMemo, useState } from "react";
import { ListingsCarousel } from "@/components/ListingsCarousel";
import type { ListingCardData } from "@/components/ListingCard";
import { cn } from "@/lib/cn";

export type PopularStaysFilter = { key: string; label: string; listingIds: string[] };

/**
 * The homepage's one browse row of stays (headed "Explore the Fylde Coast"):
 * the most popular stays, with buttons to narrow it to a town or to sea
 * views (it replaces separate "Popular in <town>" and "Beach stays" rows,
 * which showed the same stays over and over, and the town cards, which the
 * Discover section covers). Filters and their stays are worked out on the
 * server (see PopularStaysSection in src/app/page.tsx); each stay is sent
 * once and filters refer to it by id. Switching filter swaps the row in
 * place - no navigation.
 */
export function PopularStays({
  listings,
  filters,
  savedListingIds,
  isLoggedIn,
}: {
  listings: ListingCardData[];
  filters: PopularStaysFilter[];
  savedListingIds: string[];
  isLoggedIn: boolean;
}) {
  const [active, setActive] = useState(filters[0].key);
  const byId = useMemo(() => new Map(listings.map((listing) => [listing.id, listing])), [listings]);
  const saved = useMemo(() => new Set(savedListingIds), [savedListingIds]);
  const filter = filters.find((candidate) => candidate.key === active) ?? filters[0];
  const shown = filter.listingIds.flatMap((id) => byId.get(id) ?? []);

  return (
    <>
      {filters.length > 1 && (
        // Out of flow inside a fixed-height wrapper, like NowCovering, so a
        // row of buttons wider than a phone can't widen the page.
        <div className="relative mb-6 h-10">
          <div
            role="group"
            aria-label="Show stays in"
            className="absolute inset-x-0 top-0 -mx-6 flex gap-2 overflow-x-auto px-6 pb-1 [scrollbar-width:none] lg:mx-0 lg:flex-wrap lg:px-0 [&::-webkit-scrollbar]:hidden"
          >
            {filters.map((candidate) => {
              const isActive = candidate.key === filter.key;
              return (
                <button
                  key={candidate.key}
                  type="button"
                  onClick={() => setActive(candidate.key)}
                  aria-pressed={isActive}
                  className={cn(
                    "focus-ring h-9 shrink-0 whitespace-nowrap rounded-full border px-4 text-sm font-medium transition-colors duration-200",
                    isActive
                      ? "border-brand-700 bg-brand-700 text-white"
                      : "border-border-subtle bg-surface text-stone-700 hover:border-brand-200 hover:bg-brand-50",
                  )}
                >
                  {candidate.label}
                </button>
              );
            })}
          </div>
        </div>
      )}
      {/* Keyed by filter, so a new selection starts the row from its first stay. */}
      <ListingsCarousel key={filter.key} listings={shown} savedListingIds={saved} isLoggedIn={isLoggedIn} />
    </>
  );
}
