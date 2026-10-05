"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { format } from "date-fns";
import type { DateRange } from "react-day-picker";
import { ArrowRight, Loader2, Search } from "lucide-react";
import { cn } from "@/lib/cn";
import { parseGuestParam, type GuestCounts } from "@/lib/search";
import { GuestCategoryPicker } from "@/components/GuestCategoryPicker";
import { SearchDateRangeField } from "@/components/SearchDateRangeField";
import { DestinationAutocomplete } from "@/components/DestinationAutocomplete";

// How long to wait after the last change before auto-searching, so typing
// a city or clicking +/- on guests a few times in a row doesn't fire a
// request per keystroke/click.
const SEARCH_DEBOUNCE_MS = 350;

// A search always lands on the dedicated results page, matching how other
// booking sites separate the marketing homepage from search results.
const SEARCH_RESULTS_PATH = "/search";

function parseDateParam(value: string | null): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

// Every param key SearchBar itself owns - used both to build a fresh query
// from scratch (an explicit Search submission) and, in the live-update
// effect below, to detect which of the *current* URL's params actually
// changed without disturbing anything SearchBar doesn't know about (sort,
// view, filters, page - see that effect's own comment).
const SEARCHBAR_OWNED_PARAMS = [
  "city",
  "near",
  "checkIn",
  "checkOut",
  "adults",
  "children",
  "infants",
  "pets",
] as const;

function buildSearchQuery(
  city: string,
  range: DateRange | undefined,
  guestCounts: GuestCounts,
  nearLandmark?: string | null,
): string {
  const params = new URLSearchParams();
  if (city) params.set("city", city);
  if (nearLandmark) params.set("near", nearLandmark);
  if (range?.from) params.set("checkIn", format(range.from, "yyyy-MM-dd"));
  if (range?.to) params.set("checkOut", format(range.to, "yyyy-MM-dd"));
  if (guestCounts.adults !== 1) params.set("adults", String(guestCounts.adults));
  if (guestCounts.children > 0) params.set("children", String(guestCounts.children));
  if (guestCounts.infants > 0) params.set("infants", String(guestCounts.infants));
  if (guestCounts.pets > 0) params.set("pets", String(guestCounts.pets));
  return params.toString();
}

export function SearchBar({
  liveUpdate = true,
  variant = "default",
  className,
}: {
  liveUpdate?: boolean;
  /** Extra classes for the outer card, merged last (e.g. the homepage's wider, raised bar). */
  className?: string;
  /**
   * "hero" is a smaller, translucent/frosted read of the exact same bar -
   * used only floating over the homepage hero video, where a full-size
   * opaque card would cover most of the footage behind it. "default" (the
   * /search page's own copy) is completely unchanged.
   */
  variant?: "default" | "hero";
} = {}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isSearching, startTransition] = useTransition();

  const [city, setCity] = useState(searchParams.get("city") ?? "");
  // Set only when the "Where" field's selection was a specific hotel/property
  // from the autocomplete dropdown, so Search can route straight to that
  // listing instead of a city-filtered results page. Any further free typing
  // clears it, since the field no longer reflects that exact selection.
  const [selectedListingId, setSelectedListingId] = useState<string | null>(null);
  // Set only when the "Where" field's selection was a specific named place
  // (e.g. "Blackpool Pleasure Beach") rather than a whole town - carries
  // through to the results page as ?near=, which scopes results to that
  // place's town and sorts them by real distance to it (see ListingsGrid
  // and listingSearch.ts's "distance_asc"). Cleared by any further typing,
  // same as selectedListingId, since the field no longer reflects it.
  const [nearLandmark, setNearLandmark] = useState<string | null>(searchParams.get("near"));
  const [range, setRange] = useState<DateRange | undefined>(() => {
    const from = parseDateParam(searchParams.get("checkIn"));
    const to = parseDateParam(searchParams.get("checkOut"));
    return from || to ? { from, to } : undefined;
  });
  const [guestCounts, setGuestCounts] = useState<GuestCounts>({
    adults: parseGuestParam(searchParams.get("adults") ?? undefined, 1) || 1,
    children: parseGuestParam(searchParams.get("children") ?? undefined, 0),
    infants: parseGuestParam(searchParams.get("infants") ?? undefined, 0),
    pets: parseGuestParam(searchParams.get("pets") ?? undefined, 0),
  });

  // On the results page, search live as fields change, debounced, so
  // results update without waiting for an explicit "Search" click - the
  // results grid's own Suspense fallback (a skeleton) is what shows the
  // "searching" state. On the homepage this is disabled (liveUpdate=false):
  // typing there shouldn't navigate away to the results page on every
  // keystroke, only an explicit Search press should. Also skipped while a
  // specific hotel/property is selected: the field holds that hotel's name
  // rather than a real city, so a city-filtered auto-search would find
  // nothing - Search instead routes straight to that listing.
  useEffect(() => {
    if (!liveUpdate || selectedListingId) return;

    // Merge into the *current* URL's params rather than building a fresh
    // one from just SearchBar's own fields - the results page also carries
    // ?sort=/&view=/&page=/filter params SearchBar knows nothing about, and
    // an earlier version of this effect silently dropped all of them a few
    // hundred ms after every /search load (any of those existing was
    // already enough to make this effect's from-scratch query differ from
    // the real one). Only reset ?page= when a field SearchBar actually owns
    // changed - a genuinely new search invalidates whatever page of the
    // old result set the guest was on; sort/view/filters carry over
    // untouched either way.
    const params = new URLSearchParams(searchParams.toString());
    const ownedQuery = new URLSearchParams(buildSearchQuery(city, range, guestCounts, nearLandmark));
    let ownedChanged = false;
    for (const key of SEARCHBAR_OWNED_PARAMS) {
      const nextValue = ownedQuery.get(key);
      if (nextValue !== params.get(key)) ownedChanged = true;
      if (nextValue === null) params.delete(key);
      else params.set(key, nextValue);
    }
    if (!ownedChanged) return;
    params.delete("page");
    const nextQuery = params.toString();

    const timeout = setTimeout(() => {
      startTransition(() => {
        router.push(`${SEARCH_RESULTS_PATH}?${nextQuery}`, { scroll: false });
      });
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- router/searchParams/startTransition are stable
  }, [city, range, guestCounts, selectedListingId, nearLandmark, liveUpdate]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // Guards against Enter-key resubmission in browsers that don't already
    // block implicit submission via a disabled submit button.
    if (isSearching) return;
    startTransition(() => {
      if (selectedListingId) {
        router.push(`/listings/${selectedListingId}`);
      } else {
        router.push(`${SEARCH_RESULTS_PATH}?${buildSearchQuery(city, range, guestCounts, nearLandmark)}`);
      }
    });
  }

  function handleCityChange(next: string) {
    setCity(next);
    setSelectedListingId(null);
    setNearLandmark(null);
  }

  const isHero = variant === "hero";

  return (
    <form
      onSubmit={handleSubmit}
      className={cn(
        // The outer shape carries most of the "premium" weight here: a
        // generous rounded card, a soft resting shadow that lifts on
        // hover, and a brand-teal focus ring when any field inside is
        // focused - so the whole bar reads as one cohesive, interactive
        // surface rather than four unrelated inputs sitting next to each
        // other. rounded-2xl - the same large-card radius Card.tsx and
        // every other big surface on the site now share - rather than a
        // stadium/full pill once there's room (this used to flatten into
        // one at sm+, and at this bar's actual single-row height a radius
        // as large as 28px is close enough to half that height to still
        // read as one anyway): a full pill is the single most recognizable
        // "Airbnb search bar" silhouette, and this platform's own
        // considered, tighter curve reads as a deliberate design rather
        // than a borrowed one, without changing anything about the bar's
        // actual layout or fields.
        // relative: the search-in-progress sweep below is absolutely
        // positioned against this form, not any one field inside it.
        "relative mx-auto flex w-full flex-col gap-1 rounded-2xl border shadow-[var(--shadow-card)] transition-shadow duration-200 hover:shadow-[var(--shadow-popover)] focus-within:shadow-[var(--shadow-popover)] focus-within:ring-2 focus-within:ring-brand-600/25 sm:flex-row sm:items-stretch sm:gap-0",
        isHero
          ? // Frosted glass rather than the solid card below: this is the
            // one instance of SearchBar that floats directly over the hero
            // video, so it needs to read as "part of the video" - see-
            // through - rather than a full-size opaque control sitting on
            // top of it. A heavier blur (xl, not md) turns the footage
            // behind it into a soft wash of its own colour rather than a
            // legible miniature of the video, which is what actually makes
            // it feel cut from the same material as the scene instead of a
            // sheet of glass laid over a photo. Lower bg/border opacity
            // and a softer, closer shadow (than the default variant's
            // harder drop shadow) keep it looking like it's resting in the
            // scene rather than floating above it.  A genuinely floating
            // card - rounded on every corner, with margin on every side
            // (the wrapper's own padding in page.tsx, not just its
            // position) - so no edge or corner ever touches the video's
            // own frame. Wide (up to the same max-w-4xl the default
            // variant below uses) rather than the narrow box this
            // replaced - a short, horizontal bar reads as "search bar", a
            // small square box over the video didn't.
            // Tinted dark glass, not light - a light frosted pane (an
            // earlier version of this) puts the field text's own contrast
            // at the mercy of whatever's directly behind it in the video at
            // a given moment, which on the sand-colored lower half of the
            // frame washed the placeholder/value text out to near-
            // illegibility. A dark tint reads as glass regardless of what's
            // playing behind it, so the white text every field uses (see
            // the variant="hero" prop threaded into each of the three
            // fields below, applied at every breakpoint now rather than
            // only from lg: up) stays legible everywhere. bg-ink/* (the
            // same warm espresso-brown as the wordmark and every shadow on
            // this site - see globals.css) rather than a neutral black, so
            // this still reads as part of this site's warm palette instead
            // of a generic dark-UI slab. lg: only deepens the same tint
            // toward fully solid - one continuous treatment across
            // breakpoints, not two different personalities - the corner
            // radius included: a fixed rounded-2xl rather than flattening
            // into a full pill at lg:, matching the default variant's own
            // move away from that shape above.
            //
            // gap-1/p-1.5 below sm: (not gap-0.5/p-1, which this used to
            // carry at every breakpoint) - the hero fields' own touch
            // targets get more breathing room on mobile below (see their
            // triggerClassName props), and this bar's own outer spacing
            // needed to grow slightly along with them rather than leaving
            // the extra padding looking cramped against a tighter card.
            // sm:/lg: revert to the original tighter values, since desktop
            // hero is mouse-driven and was already comfortable.
            "w-full gap-1 rounded-2xl border-white/15 bg-ink/40 p-1.5 shadow-[0_8px_24px_-12px_rgba(0,0,0,0.4)] backdrop-blur-xl sm:max-w-4xl sm:gap-0.5 sm:p-1 lg:border-white/10 lg:bg-ink/80 lg:p-1.5 lg:shadow-[0_16px_36px_-18px_rgba(48,26,19,0.55)]"
          : "max-w-4xl border-border-subtle bg-surface p-2 sm:p-2",
        className,
      )}
    >
      {/* Ambient "search in progress" sweep - the same soft brand/accent
          shimmer already used for the results-page loading state (see
          globals.css's .search-sweep), reused here rather than inventing a
          second loading language, so pressing Search feels like the start
          of that same motion instead of a jump-cut into it. Its own
          overflow-hidden (not the form's) clips it to the bar's shape
          without touching the form itself - the date/guest popovers below
          are positioned relative to their own field, and clipping *this*
          element only never affects them. pointer-events-none/aria-hidden:
          purely decorative, and the button's own spinner + "Searching…"
          text (below) remain the actual accessible status. z-0, with the
          real content given z-10 just below - so the shimmer plays behind
          the fields' own text/icons rather than smearing across them,
          reading as a glow under the glass rather than a wipe over it. */}
      {isSearching && (
        <div aria-hidden className="pointer-events-none absolute inset-0 z-0 overflow-hidden rounded-2xl">
          <div className="search-sweep opacity-70" />
        </div>
      )}

      <div
        className={cn(
          "relative z-10 flex flex-1 flex-col divide-y divide-border-subtle sm:flex-row sm:divide-y-0 sm:divide-x sm:divide-border-subtle",
          isHero && "divide-white/10",
        )}
      >
        <DestinationAutocomplete
          id="search-city"
          value={city}
          onChange={handleCityChange}
          onSelect={(payload) => {
            if (payload.type === "destination") {
              setCity(payload.city);
              setSelectedListingId(null);
              setNearLandmark(null);
            } else if (payload.type === "landmark") {
              setCity(payload.town);
              setSelectedListingId(null);
              setNearLandmark(payload.name);
            } else {
              setCity(payload.title);
              setSelectedListingId(payload.listingId);
              setNearLandmark(null);
            }
          }}
          className="sm:flex-[1.15]"
          triggerClassName={isHero ? "px-3 py-2.5 sm:px-2 sm:py-1" : undefined}
          variant={isHero ? "hero" : "default"}
        />

        {/* Wider than the other segments: it holds two labelled sub-fields
            (Check-in/Check-out) rather than one. Each of these keeps its
            own full-width row on a stacked mobile layout, deliberately -
            both fields' popovers position themselves relative to their
            own trigger's width, so squeezing them into a narrower shared
            row (tried in an earlier pass) pushed the calendar and guest
            panels partly off-screen on a phone. */}
        <SearchDateRangeField
          range={range}
          onChange={setRange}
          className="sm:flex-[1.6]"
          triggerClassName={isHero ? "px-3 py-2.5 sm:px-2 sm:py-1" : undefined}
          variant={isHero ? "hero" : "default"}
        />

        <GuestCategoryPicker
          value={guestCounts}
          onChange={setGuestCounts}
          requireDoneToConfirm
          className="flex-1"
          // [&>svg]: recolors just this trigger's own icon to match the
          // teal used by the Where/Check-in fields, without touching
          // GuestCategoryPicker's markup - it's also used, unstyled, by the
          // listing page's booking widget, which this change shouldn't
          // affect at all. isHero's override (higher-specificity, later in
          // the stylesheet, so it wins over the plain rule above) applies
          // at every breakpoint, matching the tinted-glass-at-every-size
          // treatment above rather than only from lg: up.
          triggerClassName={cn(
            "[&>svg]:text-brand-600",
            isHero && "[&>svg]:text-accent-400",
            isHero ? "px-3 py-2.5 sm:px-2 sm:py-1" : "px-3 py-2.5 sm:py-1.5",
          )}
          variant={isHero ? "hero" : "default"}
        />
      </div>

      <button
        type="submit"
        disabled={isSearching}
        aria-busy={isSearching}
        aria-label={isHero ? (isSearching ? "Searching…" : "Search") : undefined}
        className={cn(
          // rounded-xl (the same radius every other button on the site
          // uses, see ui/Button.tsx), not rounded-full - a wide pill-
          // shaped submit button is its own small piece of the "Airbnb
          // search bar" silhouette. lg: below is the one legitimate
          // exception: once this collapses into a small square icon-only
          // button, it should actually be circular, not a rounded square.
          // relative z-10: stays above the search-in-progress sweep above,
          // same reason as the field row.
          "relative z-10 flex w-full items-center justify-center gap-2 rounded-xl font-semibold text-white shadow-sm transition-all duration-150 hover:bg-brand-800 hover:shadow-md active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-90 disabled:active:scale-100 sm:w-auto sm:shrink-0 focus-ring",
          isHero
            ? // At lg: this collapses from the pill-with-label below into a
              // circular icon-only button (the mockup's arrow button) - the
              // label is still there for a screen reader (aria-label above)
              // and for every breakpoint below lg, just visually hidden.
              // bg-brand-500 (not a freehand hex) so this reads as the same
              // accent color as the rest of the site rather than a
              // one-off amber picked to match a reference screenshot -
              // brand-500 is this design system's own version of that
              // exact terracotta.
              "bg-brand-700/90 px-4 py-1 text-xs sm:ml-1 sm:py-1 lg:aspect-square lg:h-11 lg:w-11 lg:shrink-0 lg:rounded-full lg:bg-brand-500 lg:px-0 lg:py-0 lg:hover:bg-brand-600"
            : "mt-1 bg-brand-700 px-6 py-3.5 text-sm sm:ml-1 sm:mt-0 sm:py-3",
        )}
      >
        {isSearching ? (
          <Loader2 className={cn("animate-spin", isHero ? "h-3.5 w-3.5" : "h-4 w-4")} aria-hidden />
        ) : (
          <>
            <Search className={cn(isHero ? "h-3.5 w-3.5 lg:hidden" : "h-4 w-4")} aria-hidden />
            {isHero && <ArrowRight className="hidden h-4 w-4 lg:block" aria-hidden />}
          </>
        )}
        <span aria-live="polite" className={isHero ? "lg:hidden" : undefined}>
          {isSearching ? "Searching…" : "Search"}
        </span>
      </button>
    </form>
  );
}
