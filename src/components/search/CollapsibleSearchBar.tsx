"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { format } from "date-fns";
import { Search, SlidersHorizontal } from "lucide-react";
import { SearchBar } from "@/components/SearchBar";
import { parseStayDate } from "@/lib/stayDates";
import { parseGuestParam } from "@/lib/search";
import { cn } from "@/lib/cn";

/** "16-19 Nov", "30 Nov - 2 Dec", or null without both dates. */
function dateSummary(checkIn: string | null, checkOut: string | null): string | null {
  const from = checkIn ? parseStayDate(checkIn) : null;
  const to = checkOut ? parseStayDate(checkOut) : null;
  if (!from || !to) return null;
  return from.getMonth() === to.getMonth()
    ? `${format(from, "d")}-${format(to, "d MMM")}`
    : `${format(from, "d MMM")} - ${format(to, "d MMM")}`;
}

/**
 * The results page's search. On a phone, once a place is chosen, it folds
 * into one line ("Blackpool · 16-19 Nov · 2 guests") so the stays start on
 * the first screen; tapping it opens the full search. From sm up the full
 * bar always shows.
 */
export function CollapsibleSearchBar() {
  const params = useSearchParams();
  const [open, setOpen] = useState(false);
  const where = params.get("city") ?? params.get("placeLabel") ?? params.get("near");
  const folded = Boolean(where) && !open;

  const guests =
    parseGuestParam(params.get("adults") ?? undefined, 1) + parseGuestParam(params.get("children") ?? undefined, 0);
  const when = dateSummary(params.get("checkIn"), params.get("checkOut")) ?? "Add dates";
  const who = `${guests} guest${guests === 1 ? "" : "s"}`;

  return (
    <>
      {folded && (
        <button
          type="button"
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
    </>
  );
}
