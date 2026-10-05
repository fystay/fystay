"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type TouchEvent } from "react";
import Image from "next/image";
import Link from "next/link";
import { ChevronLeft, ChevronRight, ImageOff, MapPin, Pause, Play, Sparkles, Star } from "lucide-react";
import { useFormattedPrice } from "@/components/CurrencyProvider";
import { SaveButton } from "@/components/SaveButton";
import { isOptimizableImage } from "@/lib/image";
import { cn } from "@/lib/cn";

/** How long each stay is showcased before moving on. */
export const SPOTLIGHT_SLIDE_MS = 6000;
const SWIPE_THRESHOLD_PX = 40;

export type SpotlightSlide = {
  promotionId: string;
  listingId: string;
  title: string;
  city: string;
  photo: string | null;
  pricePerNightCents: number;
  rating: number | null;
  reviewCount: number;
  bedrooms: number;
  maxGuests: number;
};

/** Tells FYStay a placement was shown or clicked (src/app/api/spotlight/events) - fire and forget. */
function reportSpotlightEvent(promotionId: string, type: "impression" | "click") {
  const body = JSON.stringify({ promotionId, type });
  try {
    if (navigator.sendBeacon?.("/api/spotlight/events", body)) return;
    void fetch("/api/spotlight/events", { method: "POST", body, keepalive: true }).catch(() => {});
  } catch {
    // Reporting must never get in the way of browsing.
  }
}

function subscribeReducedMotion(onChange: () => void) {
  const query = window.matchMedia("(prefers-reduced-motion: reduce)");
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}
function subscribeVisibility(onChange: () => void) {
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
}

function Price({ cents, className }: { cents: number; className?: string }) {
  return <span className={className}>{useFormattedPrice(cents)}</span>;
}

/**
 * The homepage's Spotlight stays as a showcase: one paid placement at a
 * time, large, moving on to the next every SPOTLIGHT_SLIDE_MS.
 *
 * - From lg: the featured stay fills most of the row, with every Spotlight
 *   stay listed beside it - the current one carries the progress bar, and
 *   any of them can be picked.
 * - Below lg: one tall, full-width card with story-style progress dashes;
 *   swipe for the next or previous stay, press and hold to pause.
 *
 * It moves on only while at least half of it is on screen, the tab is
 * visible, and nobody is pointing at, focused in or holding it - and never
 * by itself under prefers-reduced-motion, or once paused with its button
 * (WCAG 2.2.2). The current stay's progress bar is the timer: its
 * animationend moves the showcase on, so pausing the animation pauses
 * everything.
 *
 * Fairness to paying hosts: the server picks which stay opens the showcase
 * at random on every page view (`startIndex`), so every placement gets its
 * turn at the front. Each stay shown while the showcase is on screen, and
 * each click through, is reported for the host's view counts
 * (src/lib/spotlightStats.ts). Every stay is labelled "Promoted".
 */
export function SpotlightShowcase({
  slides,
  startIndex,
  savedListingIds,
  isLoggedIn,
}: {
  slides: SpotlightSlide[];
  startIndex: number;
  savedListingIds: string[];
  isLoggedIn: boolean;
}) {
  const count = slides.length;
  const rotates = count > 1;
  const [index, setIndex] = useState(startIndex);
  // Photos mounted so far: the current stay and its neighbours, kept once
  // loaded so the crossfade back to one never waits on the network.
  const [mounted, setMounted] = useState(() => new Set([startIndex, (startIndex + 1) % count, (startIndex - 1 + count) % count]));
  const [userPaused, setUserPaused] = useState(false);
  const [hovering, setHovering] = useState(false);
  const [focusWithin, setFocusWithin] = useState(false);
  const [holding, setHolding] = useState(false);
  const [inView, setInView] = useState(false);
  const reducedMotion = useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false,
  );
  const pageVisible = useSyncExternalStore(
    subscribeVisibility,
    () => document.visibilityState === "visible",
    () => true,
  );

  const autoplay = rotates && !reducedMotion && !userPaused;
  const playing = autoplay && inView && pageVisible && !hovering && !focusWithin && !holding;

  const sectionRef = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const reported = useRef(new Set<string>());

  const goTo = useCallback(
    (target: number) => {
      const next = (target + count) % count;
      setIndex(next);
      setMounted((current) => {
        const wanted = [next, (next + 1) % count, (next - 1 + count) % count];
        if (wanted.every((i) => current.has(i))) return current;
        return new Set([...current, ...wanted]);
      });
    },
    [count],
  );

  useEffect(() => {
    const node = sectionRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { threshold: 0.5 });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // A stay counts as seen once it's the one showing while the showcase is
  // on screen in a visible tab - once per page view (the server also counts
  // each visitor only once per placement in a while).
  const current = slides[index];
  useEffect(() => {
    if (!inView || !pageVisible || reported.current.has(current.promotionId)) return;
    reported.current.add(current.promotionId);
    reportSpotlightEvent(current.promotionId, "impression");
  }, [current.promotionId, inView, pageVisible]);

  // Keep the current stay visible in the desktop list without scrolling
  // the page itself.
  useEffect(() => {
    const list = listRef.current;
    const row = list?.children[index] as HTMLElement | undefined;
    if (!list || !row || list.scrollHeight <= list.clientHeight) return;
    if (row.offsetTop < list.scrollTop || row.offsetTop + row.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTo({ top: row.offsetTop - 8, behavior: reducedMotion ? "auto" : "smooth" });
    }
  }, [index, reducedMotion]);

  function handleTouchStart(event: TouchEvent) {
    touchStart.current = { x: event.touches[0].clientX, y: event.touches[0].clientY };
    setHolding(true);
  }
  function handleTouchEnd(event: TouchEvent) {
    setHolding(false);
    const start = touchStart.current;
    touchStart.current = null;
    if (!start || !rotates) return;
    const dx = event.changedTouches[0].clientX - start.x;
    const dy = event.changedTouches[0].clientY - start.y;
    if (Math.abs(dx) < SWIPE_THRESHOLD_PX || Math.abs(dx) < Math.abs(dy)) return;
    goTo(index + (dx < 0 ? 1 : -1));
  }

  // The progress bar for the current stay - the showcase's timer (see above).
  const progress = (className: string) =>
    autoplay ? (
      <span
        key={`${index}-progress`}
        className={cn("animate-spotlight-progress absolute inset-0", className)}
        style={{ animationDuration: `${SPOTLIGHT_SLIDE_MS}ms`, animationPlayState: playing ? "running" : "paused" }}
        onAnimationEnd={() => goTo(index + 1)}
      />
    ) : (
      <span className={cn("absolute inset-0", className)} />
    );

  return (
    <section
      ref={sectionRef}
      className="mt-10 sm:mt-14"
      aria-roledescription="carousel"
      aria-labelledby="spotlight-heading"
      onKeyDown={(event) => {
        if (!rotates) return;
        if (event.key === "ArrowRight") goTo(index + 1);
        else if (event.key === "ArrowLeft") goTo(index - 1);
      }}
      // Keyboard focus inside pauses it (so a stay doesn't change under
      // someone tabbing through); a mouse click on a stay in the list doesn't.
      onFocus={(event) => {
        if (event.target.matches(":focus-visible")) setFocusWithin(true);
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocusWithin(false);
      }}
    >
      <div className="mb-5 flex items-end justify-between gap-4 sm:mb-6">
        <div>
          <h2 id="spotlight-heading" className="flex items-center gap-2 text-xl font-bold text-foreground sm:text-2xl">
            <Sparkles className="h-5 w-5 text-brand-600" aria-hidden />
            Spotlight stays
          </h2>
          <p className="mt-1 text-sm text-stone-500">Featured by local hosts, who pay for these spots.</p>
        </div>
        {rotates && (
          <div className="flex shrink-0 items-center gap-1">
            {/* Phones swipe and have the progress dashes, so only pause is
                offered there; the counter and arrows join from sm. */}
            <span className="mr-1 hidden text-sm tabular-nums text-stone-500 sm:inline" aria-hidden>
              {index + 1} / {count}
            </span>
            <button
              type="button"
              onClick={() => goTo(index - 1)}
              className="focus-ring hidden h-9 w-9 items-center justify-center sm:flex rounded-full border border-border-subtle bg-surface text-stone-700 hover:bg-brand-50"
              aria-label="Previous Spotlight stay"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden />
            </button>
            {!reducedMotion && (
              <button
                type="button"
                onClick={() => setUserPaused((paused) => !paused)}
                className="focus-ring flex h-9 w-9 items-center justify-center rounded-full border border-border-subtle bg-surface text-stone-700 hover:bg-brand-50"
                aria-label={userPaused ? "Play Spotlight stays" : "Pause Spotlight stays"}
              >
                {userPaused ? <Play className="h-4 w-4" aria-hidden /> : <Pause className="h-4 w-4" aria-hidden />}
              </button>
            )}
            <button
              type="button"
              onClick={() => goTo(index + 1)}
              className="focus-ring hidden h-9 w-9 items-center justify-center sm:flex rounded-full border border-border-subtle bg-surface text-stone-700 hover:bg-brand-50"
              aria-label="Next Spotlight stay"
            >
              <ChevronRight className="h-4 w-4" aria-hidden />
            </button>
          </div>
        )}
      </div>

      <div className={cn("flex flex-col gap-6", rotates && "lg:flex-row")}>
        {/* The featured stay. */}
        <div
          className="relative isolate aspect-[4/5] max-h-[72svh] w-full overflow-hidden rounded-[24px] bg-ink shadow-[var(--shadow-popover)] sm:aspect-[16/10] lg:aspect-auto lg:h-[460px] lg:max-h-none lg:flex-1 lg:rounded-[28px]"
          // A mouse resting on it pauses; a phone's tap doesn't (it has no
          // "leave", so it would stay paused) - holding does that instead.
          onPointerEnter={(event) => event.pointerType === "mouse" && setHovering(true)}
          onPointerLeave={(event) => event.pointerType === "mouse" && setHovering(false)}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          onTouchCancel={() => setHolding(false)}
        >
          {slides.map((slide, i) => {
            const isCurrent = i === index;
            return (
              <div
                key={slide.promotionId}
                className={cn(
                  "absolute inset-0 transition-opacity duration-700 ease-out motion-reduce:transition-none",
                  isCurrent ? "z-[1] opacity-100" : "opacity-0",
                )}
                aria-hidden={!isCurrent}
              >
                {slide.photo && mounted.has(i) ? (
                  <Image
                    src={slide.photo}
                    alt=""
                    fill
                    sizes="(min-width: 1024px) 760px, 100vw"
                    priority={i === startIndex}
                    unoptimized={!isOptimizableImage(slide.photo)}
                    className={cn("object-cover", isCurrent && "animate-spotlight-drift")}
                  />
                ) : (
                  !slide.photo && (
                    <div className="flex h-full items-center justify-center text-white/50">
                      <ImageOff className="h-8 w-8" aria-hidden />
                    </div>
                  )
                )}
              </div>
            );
          })}

          {/* Legibility: shade only under the details at the bottom (and a
              little at the top behind the progress dashes). */}
          <div className="pointer-events-none absolute inset-0 z-[2] bg-[linear-gradient(180deg,rgba(28,16,10,0.35)_0%,rgba(28,16,10,0)_22%,rgba(28,16,10,0)_45%,rgba(28,16,10,0.78)_100%)]" />

          {rotates && (
            <div className="absolute inset-x-0 top-0 z-[4] flex gap-1.5 px-4 pt-4 lg:hidden" aria-hidden>
              {slides.map((slide, i) => (
                <span key={slide.promotionId} className="relative h-[3px] flex-1 overflow-hidden rounded-full bg-white/35">
                  {i < index && <span className="absolute inset-0 bg-white" />}
                  {i === index && progress("bg-white")}
                </span>
              ))}
            </div>
          )}

          <span
            className={cn(
              "absolute left-4 z-[4] rounded-md bg-ink/70 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-white backdrop-blur-sm lg:left-6 lg:top-6",
              rotates ? "top-9" : "top-4",
            )}
          >
            Promoted
          </span>
          <SaveButton
            key={current.listingId}
            listingId={current.listingId}
            initialSaved={savedListingIds.includes(current.listingId)}
            isLoggedIn={isLoggedIn}
            className={cn(
              "absolute right-4 z-[5] h-10 w-10 bg-white/80 shadow-[var(--shadow-card)] backdrop-blur-sm hover:bg-white active:scale-90 lg:right-6 lg:top-6",
              rotates ? "top-8" : "top-4",
            )}
          />

          <div
            role="group"
            aria-roledescription="slide"
            aria-label={`${index + 1} of ${count}`}
            aria-live={playing ? "off" : "polite"}
            className="absolute inset-x-0 bottom-0 z-[3] p-5 text-white sm:p-7 lg:p-8"
          >
            <div key={current.promotionId} className="animate-spotlight-rise">
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-white/85">
                <span className="flex items-center gap-1">
                  <MapPin className="h-3.5 w-3.5" aria-hidden />
                  {current.city}
                </span>
                {current.rating !== null ? (
                  <span className="flex items-center gap-1">
                    <Star className="h-3.5 w-3.5 fill-accent-500 text-accent-500" aria-hidden />
                    {current.rating.toFixed(1)}
                    <span className="text-white/70">({current.reviewCount})</span>
                  </span>
                ) : (
                  <span>New</span>
                )}
              </p>
              <h3 className="mt-2 max-w-xl font-serif text-[1.75rem] leading-[1.1] text-balance sm:text-4xl lg:text-[2.6rem]">
                {/* The whole card opens the stay: this link's ::after covers it. */}
                <Link
                  href={`/listings/${current.listingId}`}
                  onClick={() => reportSpotlightEvent(current.promotionId, "click")}
                  className="focus-ring rounded-sm after:absolute after:inset-0 after:z-[3] after:content-['']"
                >
                  {current.title}
                </Link>
              </h3>
              <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
                <p className="text-sm text-white/85">
                  {current.bedrooms} {current.bedrooms === 1 ? "bedroom" : "bedrooms"} · Sleeps {current.maxGuests}
                  <span className="mx-2 text-white/50">·</span>
                  <Price cents={current.pricePerNightCents} className="font-serif text-xl text-white" />{" "}
                  <span className="text-white/80">/ night</span>
                </p>
                <span
                  className="hidden rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-brand-800 shadow-sm sm:inline-block"
                  aria-hidden
                >
                  View stay
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Every Spotlight stay, from lg: pick one, or watch the bar. */}
        {rotates && (
          <ol
            ref={listRef}
            className="relative hidden max-h-[460px] w-[340px] shrink-0 flex-col gap-2 overflow-y-auto lg:flex [scrollbar-width:thin]"
            aria-label="All Spotlight stays"
          >
            {slides.map((slide, i) => {
              const isCurrent = i === index;
              return (
                <li key={slide.promotionId} className="flex min-h-[84px] flex-1">
                  <button
                    type="button"
                    onClick={() => goTo(i)}
                    aria-current={isCurrent ? "true" : undefined}
                    className={cn(
                      "focus-ring relative flex w-full items-center gap-3 overflow-hidden rounded-2xl border p-2.5 text-left transition-colors duration-300",
                      isCurrent
                        ? "border-border-subtle bg-surface shadow-[var(--shadow-card)]"
                        : "border-transparent hover:bg-surface/70",
                    )}
                  >
                    <span className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-surface-muted">
                      {slide.photo && (
                        <Image
                          src={slide.photo}
                          alt=""
                          fill
                          sizes="64px"
                          unoptimized={!isOptimizableImage(slide.photo)}
                          className="object-cover"
                        />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span
                        className={cn(
                          "block truncate text-sm font-semibold",
                          isCurrent ? "text-foreground" : "text-stone-700",
                        )}
                      >
                        {slide.title}
                      </span>
                      <span className="mt-0.5 block text-xs text-stone-500">{slide.city}</span>
                      <span className="mt-1 block text-xs text-stone-600">
                        <Price cents={slide.pricePerNightCents} className="font-serif text-sm text-brand-800" /> / night
                      </span>
                    </span>
                    {isCurrent && (
                      <span className="absolute inset-x-3 bottom-0 h-0.5 overflow-hidden rounded-full bg-brand-100" aria-hidden>
                        {progress("bg-brand-600")}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </section>
  );
}
