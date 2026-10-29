"use client";

import { Suspense, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { Logo } from "@/components/Logo";
import { SavedLink } from "@/components/SavedLink";
import { PAGE_SEARCH_ID, searchSummary } from "@/lib/searchSummary";
import { cn } from "@/lib/cn";

/**
 * True once the page's main search (PAGE_SEARCH_ID) has scrolled up out of
 * view. Pages without one never show the header's search pill.
 */
function usePageSearchScrolledAway(): boolean {
  const pathname = usePathname();
  const [away, setAway] = useState<{ on: string; away: boolean }>({ on: "", away: false });

  useEffect(() => {
    const target = document.getElementById(PAGE_SEARCH_ID);
    if (!target || typeof IntersectionObserver === "undefined") return;
    // Below the header (about 72px), and only once it's gone up, not down.
    const observer = new IntersectionObserver(
      ([entry]) => setAway({ on: pathname, away: !entry.isIntersecting && entry.boundingClientRect.top < 0 }),
      { rootMargin: "-72px 0px 0px 0px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [pathname]);

  return away.on === pathname && away.away;
}

/** Brings the page's main search back into view and puts the cursor in "Where". */
function openPageSearch() {
  const target = document.getElementById(PAGE_SEARCH_ID);
  if (!target) return;
  const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  target.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "center" });
  // The results page folds its search on phones (CollapsibleSearchBar).
  target.querySelector<HTMLElement>("[data-search-expand]")?.click();
  window.setTimeout(() => target.querySelector<HTMLElement>("input, button")?.focus({ preventScroll: true }), smooth ? 450 : 0);
}

function SearchPill({ className }: { className?: string }) {
  const { where, when, who } = searchSummary(useSearchParams());
  return (
    <button
      type="button"
      onClick={openPageSearch}
      aria-label={`Search stays: ${where ?? "anywhere"}, ${when}, ${who}`}
      className={cn(
        "focus-ring flex min-w-0 items-center gap-2.5 rounded-full border border-border-subtle bg-surface py-1.5 pl-4 pr-1.5 text-left shadow-[var(--shadow-card)] transition-shadow hover:shadow-[var(--shadow-card-hover)] animate-[hero-copy-in_250ms_ease-out] motion-reduce:animate-none",
        className,
      )}
    >
      {/* Phones: two short lines. Desktop: one line with dividers. */}
      <span className="min-w-0 flex-1 lg:flex lg:items-center lg:gap-3">
        <span className="block truncate text-sm font-semibold text-foreground">{where ?? "Where to?"}</span>
        <span aria-hidden className="hidden text-border-subtle lg:inline">|</span>
        <span className="block truncate text-xs text-stone-500 lg:text-sm lg:text-foreground">
          {when}
          <span className="lg:hidden"> · {who}</span>
        </span>
        <span aria-hidden className="hidden text-border-subtle lg:inline">|</span>
        <span className="hidden text-sm text-foreground lg:inline">{who}</span>
      </span>
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-600 text-white">
        <Search className="h-4 w-4" aria-hidden />
      </span>
    </button>
  );
}

/**
 * The header's contents: the logo on the left, the account button on the
 * right (it also holds "List your property"), with Saved just left of it.
 * Once the page's main search has scrolled away, a search pill
 * takes the centre (desktop) or the space beside the logo (phones), so a
 * guest can search from anywhere on the page - the only filled terracotta
 * control up here, as Search is below.
 */
export function HeaderBar({ account }: { account: ReactNode }) {
  const pill = usePageSearchScrolledAway();

  return (
    <div className="relative mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 sm:px-6 lg:py-4">
      <Link href="/" aria-label="FYStay home" className="focus-ring relative z-10 shrink-0 rounded-md">
        <Logo size="lg" withTagline />
      </Link>

      {/* Suspense: the pill reads the search params; the rest of the bar
          never waits for them. */}
      {pill && (
        <Suspense>
          <SearchPill className="flex-1 lg:hidden" />
        </Suspense>
      )}

      {pill && (
        <div className="pointer-events-none absolute inset-0 hidden items-center justify-center lg:flex">
          <Suspense>
            <SearchPill className="pointer-events-auto max-w-md" />
          </Suspense>
        </div>
      )}

      <div className="relative z-10 ml-auto flex shrink-0 items-center gap-4">
        <SavedLink />
        {account}
      </div>
    </div>
  );
}
