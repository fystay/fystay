"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { Search, SlidersHorizontal } from "lucide-react";
import { SearchBar } from "@/components/SearchBar";
import { PAGE_SEARCH_ID, searchSummary } from "@/lib/searchSummary";
import { cn } from "@/lib/cn";

/**
 * The results page's search. On a phone, once a place is chosen, it folds
 * into one line ("Blackpool · 16-19 Nov · 2 guests") so the stays start on
 * the first screen; tapping it opens the full search. From sm up the full
 * bar always shows.
 */
export function CollapsibleSearchBar() {
  const params = useSearchParams();
  const [open, setOpen] = useState(false);
  const { where, when, who } = searchSummary(params);
  const folded = Boolean(where) && !open;

  return (
    <div id={PAGE_SEARCH_ID}>
      {folded && (
        <button
          type="button"
          // The header's search pill opens this the same way (HeaderBar).
          data-search-expand
          onClick={() => setOpen(true)}
          aria-label={`Change search: ${where}, ${when}, ${who}`}
          className="focus-ring flex w-full items-center gap-3 rounded-full border border-border-subtle bg-surface px-4 py-3 text-left shadow-[var(--shadow-card)] sm:hidden"
        >
          <Search className="h-4 w-4 shrink-0 text-brand-700" aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-foreground">{where}</span>
            <span className="block truncate text-xs text-stone-500">
              {when} · {who}
            </span>
          </span>
          <SlidersHorizontal className="h-4 w-4 shrink-0 text-stone-500" aria-hidden />
        </button>
      )}
      <div className={cn(folded && "hidden sm:block")}>
        <SearchBar />
      </div>
    </div>
  );
}
