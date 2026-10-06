"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Building2, History, Landmark, Loader2, MapPin, SearchX, Sparkles } from "lucide-react";
import { cn } from "@/lib/cn";
import type { DestinationSuggestion, HotelSuggestion, LandmarkSuggestion } from "@/lib/searchSuggestions";
import { useAnchoredPortalPosition } from "@/lib/useAnchoredPortalPosition";

// Deliberately shorter than the search-results debounce (350ms): suggestions
// are a lightweight local query and should feel closer to instant as-you-type
// feedback, without firing a request on every single keystroke.
const SUGGEST_DEBOUNCE_MS = 200;
const RECENT_SEARCHES_KEY = "fystay:recent-destination-searches";
const MAX_RECENT_SEARCHES = 5;

type SelectPayload =
  | { type: "destination"; city: string }
  | { type: "landmark"; name: string; town: string }
  | { type: "hotel"; listingId: string; title: string };

type FlatItem =
  | { kind: "recent"; city: string }
  | { kind: "popular"; suggestion: DestinationSuggestion }
  | { kind: "destination"; suggestion: DestinationSuggestion }
  | { kind: "landmark"; suggestion: LandmarkSuggestion }
  | { kind: "hotel"; suggestion: HotelSuggestion };

function readRecentSearches(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENT_SEARCHES_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function saveRecentSearch(city: string) {
  try {
    const existing = readRecentSearches().filter((c) => c.toLowerCase() !== city.toLowerCase());
    const next = [city, ...existing].slice(0, MAX_RECENT_SEARCHES);
    window.localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(next));
  } catch {
    // localStorage can be unavailable (private browsing, disabled storage) -
    // recent searches are a nice-to-have, never worth breaking search over.
  }
}

export function DestinationAutocomplete({
  id,
  value,
  onChange,
  onSelect,
  className,
  triggerClassName,
  variant = "default",
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  onSelect: (payload: SelectPayload) => void;
  className?: string;
  /** Overrides the trigger label's own padding/sizing - see GuestCategoryPicker's identical prop. */
  triggerClassName?: string;
  /** "hero" swaps the closed trigger's icon/label/input to white, at every breakpoint - see SearchBar's own variant, which this mirrors for its tinted-glass-to-solid-pill treatment. The open dropdown panel is unaffected (always on a white surface, so its own text stays dark regardless). */
  variant?: "default" | "hero";
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errored, setErrored] = useState(false);
  const [popular, setPopular] = useState(true);
  const [destinations, setDestinations] = useState<DestinationSuggestion[]>([]);
  const [landmarks, setLandmarks] = useState<LandmarkSuggestion[]>([]);
  const [hotels, setHotels] = useState<HotelSuggestion[]>([]);
  const [recentSearches, setRecentSearches] = useState<string[]>(() => readRecentSearches());
  const [highlightedIndex, setHighlightedIndex] = useState(-1);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);
  const position = useAnchoredPortalPosition(containerRef, open);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      const target = e.target as Node;
      // The panel is portaled to document.body, so it's no longer a DOM
      // descendant of containerRef - it needs its own check here too.
      if (
        containerRef.current &&
        !containerRef.current.contains(target) &&
        !panelRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  function runSearch(query: string) {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(
      () => {
        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;
        const requestId = ++requestIdRef.current;

        setLoading(true);
        setErrored(false);

        fetch(`/api/search/suggestions?q=${encodeURIComponent(query)}`, {
          signal: controller.signal,
        })
          .then((res) => {
            if (!res.ok) throw new Error("Search suggestions request failed");
            return res.json();
          })
          .then(
            (data: {
              popular: boolean;
              destinations: DestinationSuggestion[];
              landmarks: LandmarkSuggestion[];
              hotels: HotelSuggestion[];
            }) => {
              // Guard against an older, slower request resolving after a
              // newer one, so the dropdown never flashes back to stale results.
              if (requestId !== requestIdRef.current) return;
              setPopular(data.popular);
              setDestinations(data.destinations ?? []);
              setLandmarks(data.landmarks ?? []);
              setHotels(data.hotels ?? []);
              setLoading(false);
            },
          )
          .catch((err) => {
            if (err instanceof DOMException && err.name === "AbortError") return;
            if (requestId !== requestIdRef.current) return;
            setErrored(true);
            setLoading(false);
            setDestinations([]);
            setLandmarks([]);
            setHotels([]);
          });
      },
      // No artificial delay for the very first open (empty query, popular
      // list) - only actual typed searches are debounced.
      query ? SUGGEST_DEBOUNCE_MS : 0,
    );
  }

  function handleFocus() {
    setOpen(true);
    setRecentSearches(readRecentSearches());
    runSearch(value.trim());
  }

  function handleChange(next: string) {
    onChange(next);
    setOpen(true);
    setHighlightedIndex(-1);
    runSearch(next.trim());
  }

  const flatItems: FlatItem[] = useMemo(() => {
    if (popular) {
      const items: FlatItem[] = [];
      for (const city of recentSearches) items.push({ kind: "recent", city });
      for (const suggestion of destinations) items.push({ kind: "popular", suggestion });
      return items;
    }
    return [
      ...destinations.map((suggestion): FlatItem => ({ kind: "destination", suggestion })),
      ...landmarks.map((suggestion): FlatItem => ({ kind: "landmark", suggestion })),
      ...hotels.map((suggestion): FlatItem => ({ kind: "hotel", suggestion })),
    ];
  }, [popular, recentSearches, destinations, landmarks, hotels]);

  function select(item: FlatItem) {
    if (item.kind === "recent") {
      onChange(item.city);
      onSelect({ type: "destination", city: item.city });
      saveRecentSearch(item.city);
    } else if (item.kind === "popular" || item.kind === "destination") {
      onChange(item.suggestion.city);
      onSelect({ type: "destination", city: item.suggestion.city });
      saveRecentSearch(item.suggestion.city);
    } else if (item.kind === "landmark") {
      onChange(item.suggestion.name);
      onSelect({ type: "landmark", name: item.suggestion.name, town: item.suggestion.town });
      saveRecentSearch(item.suggestion.name);
    } else {
      onChange(item.suggestion.label);
      onSelect({ type: "hotel", listingId: item.suggestion.id, title: item.suggestion.label });
    }
    setOpen(false);
    setHighlightedIndex(-1);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setOpen(true);
        runSearch(value.trim());
      }
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightedIndex((i) => (i + 1 >= flatItems.length ? 0 : i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightedIndex((i) => (i <= 0 ? flatItems.length - 1 : i - 1));
    } else if (e.key === "Enter") {
      if (highlightedIndex >= 0 && highlightedIndex < flatItems.length) {
        // Enter selects the highlighted suggestion rather than submitting an
        // incomplete/raw-text search - the surrounding <form> only sees a
        // submit event once nothing is highlighted (or the dropdown is shut).
        e.preventDefault();
        select(flatItems[highlightedIndex]);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
      setHighlightedIndex(-1);
    }
  }

  const activeId =
    highlightedIndex >= 0 && highlightedIndex < flatItems.length
      ? `${id}-option-${highlightedIndex}`
      : undefined;

  const showNoResults = open && !popular && !loading && !errored && flatItems.length === 0;
  const hasNothingToShow = !loading && !errored && !showNoResults && flatItems.length === 0;

  let itemIndex = -1;

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <label
        htmlFor={id}
        className={cn(
          "flex flex-1 cursor-text items-center gap-2.5 rounded-xl px-3 py-2.5 hover:bg-surface-muted sm:py-1.5",
          triggerClassName,
        )}
      >
        <MapPin
          className={cn("h-4 w-4 shrink-0 text-brand-600", variant === "hero" && "text-accent-400")}
          aria-hidden
        />
        <span className="min-w-0 flex-1">
          <span
            className={cn(
              "block text-[11px] font-semibold text-foreground",
              // Uppercase + tracked-out champagne-gold in hero, matching
              // the "NOW COVERING" label and this field's own icon just
              // above/left (already accent-400 in hero) - one small-caps
              // accent voice for every label floating over the video,
              // rather than this field alone reading as a plain white
              // form control dropped on top of it.
              variant === "hero" && "text-accent-400/90 uppercase tracking-wide",
            )}
          >
            Where
          </span>
          <input
            ref={inputRef}
            id={id}
            role="combobox"
            aria-expanded={open}
            aria-controls={`${id}-listbox`}
            aria-autocomplete="list"
            aria-activedescendant={activeId}
            autoComplete="off"
            value={value}
            onChange={(e) => handleChange(e.target.value)}
            onFocus={handleFocus}
            onKeyDown={handleKeyDown}
            // Short enough to render in full at the mobile 16px size this
            // field now uses (see the className below) - the longer
            // original wording used to fit at 14px but clipped once bumped
            // to 16px to stop iOS Safari's zoom-on-focus.
            placeholder="Blackpool, Lytham, Fleetwood…"
            // text-base below sm: see ui/Input.tsx - prevents iOS Safari's
            // auto-zoom-on-focus for any field with a computed font-size
            // under 16px. truncate: this field's own width varies a lot
            // (a full-size row here vs. the much narrower hero variant on
            // the homepage - see SearchBar.tsx), so the placeholder needs a
            // clean ellipsis rather than an abrupt hard clip when there
            // isn't room for it in full.
            className={cn(
              "focus-ring w-full truncate rounded-lg bg-transparent px-0 py-0 text-base text-foreground placeholder:text-stone-500 sm:text-sm",
              variant === "hero" && "text-white placeholder:text-white/70",
            )}
          />
        </span>
      </label>

      {open &&
        !hasNothingToShow &&
        position &&
        createPortal(
        <div
          ref={panelRef}
          id={`${id}-listbox`}
          role="listbox"
          aria-label="Destination and hotel suggestions"
          style={{ top: position.top + 8, left: position.left, width: position.width }}
          className="animate-dropdown-in absolute z-[60] max-h-[70vh] min-w-[280px] overflow-y-auto rounded-2xl border border-border-subtle bg-surface p-2 shadow-[var(--shadow-popover)]"
        >
          {loading && (
            <div className="flex items-center gap-2 px-3 py-3 text-sm text-stone-500">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Searching destinations and hotels…
            </div>
          )}

          {!loading && errored && (
            <div className="px-3 py-3 text-sm text-stone-500">
              Something went wrong loading suggestions. You can still type a destination and press
              Search.
            </div>
          )}

          {!loading && !errored && showNoResults && (
            <div className="flex flex-col items-center gap-1.5 px-3 py-6 text-center">
              <SearchX className="h-5 w-5 text-stone-300" aria-hidden />
              <p className="text-sm font-medium text-foreground">No destinations, places or hotels found</p>
              <p className="text-xs text-stone-500">Try a city, town, region or hotel name.</p>
            </div>
          )}

          {!loading && !errored && flatItems.length > 0 && (
            <ul className="flex flex-col gap-0.5">
              {popular && recentSearches.length > 0 && (
                <li className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-stone-500">
                  Recent searches
                </li>
              )}
              {flatItems.map((item) => {
                if (item.kind === "recent") {
                  itemIndex++;
                  const index = itemIndex;
                  return (
                    <SuggestionRow
                      key={`recent-${item.city}`}
                      id={`${id}-option-${index}`}
                      active={highlightedIndex === index}
                      icon={<History className="h-4 w-4 text-stone-400" aria-hidden />}
                      label={item.city}
                      onSelect={() => select(item)}
                      onHover={() => setHighlightedIndex(index)}
                    />
                  );
                }
                if (item.kind === "popular") {
                  itemIndex++;
                  const index = itemIndex;
                  return (
                    <FirstOfGroup key={`popular-${item.suggestion.id}`} show={index === recentSearches.length}>
                      <SuggestionRow
                        id={`${id}-option-${index}`}
                        active={highlightedIndex === index}
                        icon={<Sparkles className="h-4 w-4 text-stone-400" aria-hidden />}
                        label={item.suggestion.label}
                        sublabel={item.suggestion.sublabel}
                        onSelect={() => select(item)}
                        onHover={() => setHighlightedIndex(index)}
                      />
                    </FirstOfGroup>
                  );
                }
                if (item.kind === "destination") {
                  itemIndex++;
                  const index = itemIndex;
                  return (
                    <FirstOfGroup key={`destination-${item.suggestion.id}`} show={index === 0} label="Destinations">
                      <SuggestionRow
                        id={`${id}-option-${index}`}
                        active={highlightedIndex === index}
                        icon={<MapPin className="h-4 w-4 text-brand-600" aria-hidden />}
                        label={item.suggestion.label}
                        sublabel={item.suggestion.sublabel}
                        onSelect={() => select(item)}
                        onHover={() => setHighlightedIndex(index)}
                      />
                    </FirstOfGroup>
                  );
                }
                if (item.kind === "landmark") {
                  itemIndex++;
                  const index = itemIndex;
                  return (
                    <FirstOfGroup
                      key={`landmark-${item.suggestion.id}`}
                      show={index === destinations.length}
                      label="Places"
                    >
                      <SuggestionRow
                        id={`${id}-option-${index}`}
                        active={highlightedIndex === index}
                        icon={<Landmark className="h-4 w-4 text-brand-600" aria-hidden />}
                        label={item.suggestion.label}
                        sublabel={item.suggestion.sublabel}
                        onSelect={() => select(item)}
                        onHover={() => setHighlightedIndex(index)}
                      />
                    </FirstOfGroup>
                  );
                }
                itemIndex++;
                const index = itemIndex;
                return (
                  <FirstOfGroup
                    key={`hotel-${item.suggestion.id}`}
                    show={index === destinations.length + landmarks.length}
                    label="Hotels"
                  >
                    <SuggestionRow
                      id={`${id}-option-${index}`}
                      active={highlightedIndex === index}
                      icon={
                        item.suggestion.photo ? (
                          // eslint-disable-next-line @next/next/no-img-element -- tiny dropdown thumbnail, not worth next/image's optimization pipeline
                          <img
                            src={item.suggestion.photo}
                            alt=""
                            className="h-8 w-8 shrink-0 rounded-md object-cover"
                          />
                        ) : (
                          <Building2 className="h-4 w-4 text-brand-600" aria-hidden />
                        )
                      }
                      label={item.suggestion.label}
                      sublabel={item.suggestion.sublabel}
                      onSelect={() => select(item)}
                      onHover={() => setHighlightedIndex(index)}
                    />
                  </FirstOfGroup>
                );
              })}
            </ul>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}

function FirstOfGroup({
  show,
  label,
  children,
}: {
  show: boolean;
  label?: string;
  children: React.ReactNode;
}) {
  if (!show) return children;
  return (
    <>
      {label && (
        <li className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-stone-500 first:pt-0">
          {label}
        </li>
      )}
      {children}
    </>
  );
}

function SuggestionRow({
  id,
  active,
  icon,
  label,
  sublabel,
  onSelect,
  onHover,
}: {
  id: string;
  active: boolean;
  icon: React.ReactNode;
  label: string;
  sublabel?: string;
  onSelect: () => void;
  onHover: () => void;
}) {
  return (
    <li
      id={id}
      role="option"
      aria-selected={active}
      onMouseEnter={onHover}
      // onMouseDown (not onClick) fires before the input's onBlur, so the
      // dropdown's outside-click handler doesn't close it out from under us.
      onMouseDown={(e) => {
        e.preventDefault();
        onSelect();
      }}
      className={cn(
        "flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-3 py-2 text-left",
        active ? "bg-surface-muted" : "hover:bg-surface-muted",
      )}
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">{label}</span>
        {sublabel && <span className="block truncate text-xs text-stone-500">{sublabel}</span>}
      </span>
    </li>
  );
}
