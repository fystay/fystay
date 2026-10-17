"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { MapPin } from "lucide-react";
import { FYLDE_COAST_DESTINATIONS } from "@/lib/destinations";

/** Popular Lake District towns and villages, after the Fylde Coast towns. */
const LAKE_DISTRICT_TOWNS = ["Windermere", "Bowness-on-Windermere", "Ambleside", "Grasmere", "Keswick", "Coniston", "Glenridding"];

/** The cities in the homepage hero, after the Lake District. */
const CITIES = ["Liverpool", "Manchester"];

/** Each pill opens search for that town (dates still to pick). */
const COVERED_TOWNS = [
  ...FYLDE_COAST_DESTINATIONS.map((destination) => ({ name: destination.name, searchCity: destination.searchCity })),
  ...[...LAKE_DISTRICT_TOWNS, ...CITIES].map((name) => ({ name, searchCity: name })),
];

/** How long one full lap of the list takes when it drifts by itself. */
const LAP_SECONDS = 60;
/** After a touch ends, how long to let a swipe's momentum settle before drifting again. */
const TOUCH_RESUME_MS = 1200;

/**
 * The towns FYStay covers - the Fylde Coast, popular Lake District towns,
 * then Liverpool and Manchester - as pills that each open that town's
 * search results. Sits directly under the homepage search panel, drifting slowly through every
 * town. Pointing at it (or touching it, or tabbing into it) stops the
 * drift and it can be swiped or scrolled either way by hand; letting go
 * picks the drift up again from wherever it was left. A mouse can drag it. The edges fade out
 * rather than cutting pills off mid-word.
 *
 * It's a real horizontal scroller (scrollbar hidden), moved by
 * requestAnimationFrame rather than a CSS animation, so manual scrolling
 * and the drift share one position. The list is rendered twice back to back;
 * whenever the position passes one copy's width in either direction it
 * jumps by exactly that width, which looks identical, so the strip never
 * runs out. The second copy is aria-hidden and untabbable, so a screen
 * reader or keyboard user meets each town once. Under prefers-reduced-motion
 * it never drifts - it's a plain swipeable strip.
 *
 * The scroller is absolutely positioned inside a fixed-height wrapper, the
 * same fix ListingsCarousel documents: an in-flow row wider than the screen
 * widens a phone's page-fit viewport and lets the whole page pan sideways.
 */
export function NowCovering() {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const copyRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const scroller = scrollerRef.current;
    const copy = copyRef.current;
    if (!scroller || !copy) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let hovered = false;
    let touching = false;
    let focused = false;
    let touchTimer: ReturnType<typeof setTimeout> | undefined;
    // Start a pixel in, so a swipe backwards from the very start still
    // registers as a scroll (and wraps round to the end).
    scroller.scrollLeft = 1;
    let position = scroller.scrollLeft;
    let last = performance.now();
    let frame = 0;
    const held = () => hovered || touching || focused;

    // Keep the position within one copy's width - the jump is invisible
    // because both copies are identical.
    function wrap() {
      const width = copy!.offsetWidth;
      if (width <= 0) return;
      if (scroller!.scrollLeft >= width) scroller!.scrollLeft -= width;
      else if (scroller!.scrollLeft <= 0 && held()) scroller!.scrollLeft += width;
    }

    function tick(now: number) {
      const elapsed = Math.min(now - last, 100);
      last = now;
      if (!held() && !reducedMotion) {
        const width = copy!.offsetWidth;
        position += (width / LAP_SECONDS) * (elapsed / 1000);
        if (position >= width) position -= width;
        scroller!.scrollLeft = Math.max(position, 1);
      }
      frame = requestAnimationFrame(tick);
    }

    function onScroll() {
      // Only a person's scroll moves the shared position; the drift's own
      // (whole-pixel) writes would otherwise round it to a standstill.
      if (!held()) return;
      wrap();
      position = scroller!.scrollLeft;
    }
    const onEnter = () => (hovered = true);
    const onLeave = () => {
      hovered = false;
      position = scroller.scrollLeft;
    };
    const onTouchStart = () => {
      clearTimeout(touchTimer);
      touching = true;
    };
    const onTouchEnd = () => {
      clearTimeout(touchTimer);
      touchTimer = setTimeout(() => {
        touching = false;
        position = scroller.scrollLeft;
      }, TOUCH_RESUME_MS);
    };
    // A mouse can drag the strip too (touchpads and touch screens scroll it
    // natively); a drag never also opens the pill it started on.
    let drag: { x: number; scroll: number; moved: boolean } | null = null;
    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType !== "mouse" || event.button !== 0) return;
      drag = { x: event.clientX, scroll: scroller.scrollLeft, moved: false };
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!drag) return;
      const dx = event.clientX - drag.x;
      if (Math.abs(dx) > 4) drag.moved = true;
      if (drag.moved) scroller.scrollLeft = drag.scroll - dx;
    };
    const onPointerUp = () => {
      if (drag?.moved) {
        // Swallow the click that ends a drag (and only that one).
        const swallow = (e: MouseEvent) => e.preventDefault();
        scroller.addEventListener("click", swallow, { capture: true, once: true });
        setTimeout(() => scroller.removeEventListener("click", swallow, { capture: true }), 0);
      }
      drag = null;
    };
    const onFocusIn = () => (focused = true);
    const onFocusOut = () => {
      focused = false;
      position = scroller.scrollLeft;
    };

    scroller.addEventListener("scroll", onScroll, { passive: true });
    scroller.addEventListener("mouseenter", onEnter);
    scroller.addEventListener("mouseleave", onLeave);
    scroller.addEventListener("touchstart", onTouchStart, { passive: true });
    scroller.addEventListener("touchend", onTouchEnd);
    scroller.addEventListener("touchcancel", onTouchEnd);
    scroller.addEventListener("focusin", onFocusIn);
    scroller.addEventListener("focusout", onFocusOut);
    scroller.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(touchTimer);
      scroller.removeEventListener("scroll", onScroll);
      scroller.removeEventListener("mouseenter", onEnter);
      scroller.removeEventListener("mouseleave", onLeave);
      scroller.removeEventListener("touchstart", onTouchStart);
      scroller.removeEventListener("touchend", onTouchEnd);
      scroller.removeEventListener("touchcancel", onTouchEnd);
      scroller.removeEventListener("focusin", onFocusIn);
      scroller.removeEventListener("focusout", onFocusOut);
      scroller.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, []);

  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-brand-700">Now covering</p>
      <div className="relative mt-1.5 h-11">
        <div
          ref={scrollerRef}
          className="absolute inset-x-0 top-0 -mx-6 overflow-x-auto overscroll-x-contain [mask-image:linear-gradient(90deg,transparent,#000_24px,#000_calc(100%-24px),transparent)] [scrollbar-width:none] lg:mx-0 lg:[mask-image:linear-gradient(90deg,transparent,#000_40px,#000_calc(100%-40px),transparent)] [&::-webkit-scrollbar]:hidden"
        >
          <div className="flex w-max py-1">
            {[0, 1].map((copy) => (
              <ul
                key={copy}
                ref={copy === 0 ? copyRef : undefined}
                aria-hidden={copy === 1 || undefined}
                // pr-2 matches gap-2, so both copies are the same width and the loop has no seam.
                className="flex shrink-0 gap-2 pr-2"
              >
                {COVERED_TOWNS.map((town) => (
                  <li key={town.name} className="shrink-0">
                    <Link
                      href={`/search?city=${encodeURIComponent(town.searchCity)}`}
                      tabIndex={copy === 1 ? -1 : undefined}
                      draggable={false}
                      className="focus-ring flex h-9 items-center gap-1.5 whitespace-nowrap rounded-full border border-border-subtle bg-surface px-3.5 text-sm font-medium text-stone-700 shadow-[var(--shadow-card)] transition-colors hover:border-brand-200 hover:bg-brand-50 hover:text-foreground active:bg-brand-50"
                    >
                      <MapPin className="h-3.5 w-3.5 shrink-0 text-brand-600" aria-hidden />
                      {town.name}
                    </Link>
                  </li>
                ))}
              </ul>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
