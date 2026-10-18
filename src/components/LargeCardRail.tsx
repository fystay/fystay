"use client";

import { Children, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { LARGE_CARD_SLOT_CLASS } from "@/components/LargeCard";

/**
 * A horizontally swipeable row of large, image-led cards (LargeCard,
 * ListingCard size="large"). Sized so the next card always peeks in:
 *
 * one full card plus about half of the next on phones, about two on
 * tablets and three and a third on desktop (see LARGE_CARD_SLOT_CLASS).
 *
 * Below lg the rail bleeds to the screen edges (-mx-6/px-6, matching the
 * page's own px-6 container) so the peeking card runs off the edge rather
 * than being clipped by the gutter. Scroll-snap keeps swipes landing on a
 * card. Prev/next arrows appear on desktop only, where there's no swipe,
 * and only while there's somewhere to scroll to.
 *
 * fullBleed (Spotlight, whose hosts pay to stand out): on phones each card
 * fills the page's width - one stay per screen, no half-card peeking, with
 * dots showing there are more. On desktop the rail runs to both screen edges
 * while its first card stays lined up with the content column.
 */
const RAIL_ROW_CLASS = "-mx-6 flex gap-4 px-6 pb-4 pt-1 lg:mx-0 lg:gap-6 lg:px-0";
// The space between the screen edge and the content column (max-w-6xl + px-6).
const FULL_BLEED_CLASS =
  "lg:[--rail-gutter:calc((100vw-min(100vw,72rem))/2+1.5rem)] lg:-mx-[var(--rail-gutter)]";
// gap-6 on phones matches the page's px-6, so the next card starts just off-screen.
const FULL_BLEED_ROW_CLASS = "gap-6 sm:gap-4 lg:gap-6 lg:px-[var(--rail-gutter)]";
const FULL_BLEED_SLOT_CLASS = "w-[calc(100vw-3rem)] max-w-none sm:w-[44vw] sm:max-w-[340px] lg:w-[30%] lg:max-w-none";

export function LargeCardRail({
  label,
  fullBleed = false,
  children,
}: {
  label: string;
  fullBleed?: boolean;
  children: ReactNode;
}) {
  const railRef = useRef<HTMLUListElement>(null);
  const [canPrev, setCanPrev] = useState(false);
  const [canNext, setCanNext] = useState(false);
  const [active, setActive] = useState(0);
  const items = Children.toArray(children);
  const slotClass = cn(LARGE_CARD_SLOT_CLASS, fullBleed && FULL_BLEED_SLOT_CLASS);

  const updateArrows = useCallback(() => {
    const rail = railRef.current;
    if (!rail) return;
    setCanPrev(rail.scrollLeft > 4);
    setCanNext(rail.scrollLeft + rail.clientWidth < rail.scrollWidth - 4);
    const slot = rail.querySelector("li");
    if (slot) setActive(Math.round(rail.scrollLeft / (slot.getBoundingClientRect().width + parseFloat(getComputedStyle(rail).columnGap))));
  }, []);

  useEffect(() => {
    updateArrows();
    const rail = railRef.current;
    if (!rail) return;
    rail.addEventListener("scroll", updateArrows, { passive: true });
    window.addEventListener("resize", updateArrows);
    return () => {
      rail.removeEventListener("scroll", updateArrows);
      window.removeEventListener("resize", updateArrows);
    };
  }, [updateArrows]);

  function scrollByCard(direction: 1 | -1) {
    const rail = railRef.current;
    const slot = rail?.querySelector("li");
    if (!rail || !slot) return;
    rail.scrollBy({ left: direction * (slot.getBoundingClientRect().width + 24), behavior: "smooth" });
  }

  return (
    <div
      className={cn("relative", fullBleed && FULL_BLEED_CLASS)}
      role="region"
      aria-roledescription="carousel"
      aria-label={label}
    >
      {/* The scroller is absolutely positioned, with this invisible copy of
          the first card giving the wrapper its height - the same fix
          ListingsCarousel documents: an in-flow row wider than the screen
          widens a phone's page-fit viewport and lets the whole page pan
          sideways. inert keeps the copy out of tab order and the a11y tree. */}
      <div aria-hidden inert className={cn(RAIL_ROW_CLASS, fullBleed && FULL_BLEED_ROW_CLASS, "invisible")}>
        <div className={slotClass}>{items[0]}</div>
      </div>
      <ul
        ref={railRef}
        className={cn(
          RAIL_ROW_CLASS,
          "absolute inset-x-0 top-0 snap-x snap-mandatory scroll-px-6 overflow-x-auto overscroll-x-contain [scrollbar-width:none] lg:scroll-px-0 [&::-webkit-scrollbar]:hidden",
          fullBleed && cn(FULL_BLEED_ROW_CLASS, "lg:scroll-px-[var(--rail-gutter)]"),
        )}
      >
        {items.map((item, i) => (
          <li key={i} className={cn(slotClass, "snap-start")}>
            {item}
          </li>
        ))}
      </ul>

      {fullBleed && items.length > 1 && (
        <div className="mt-1 flex justify-center gap-1.5 sm:hidden" aria-hidden>
          {items.map((_, i) => (
            <span
              key={i}
              className={cn("h-1.5 rounded-full transition-all", i === active ? "w-4 bg-foreground" : "w-1.5 bg-stone-300")}
            />
          ))}
        </div>
      )}

      {(canPrev || canNext) && (
        <>
          <RailArrow direction="prev" disabled={!canPrev} fullBleed={fullBleed} onClick={() => scrollByCard(-1)} />
          <RailArrow direction="next" disabled={!canNext} fullBleed={fullBleed} onClick={() => scrollByCard(1)} />
        </>
      )}
    </div>
  );
}

function RailArrow({
  direction,
  disabled,
  fullBleed,
  onClick,
}: {
  direction: "prev" | "next";
  disabled: boolean;
  fullBleed: boolean;
  onClick: () => void;
}) {
  const Icon = direction === "prev" ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={direction === "prev" ? "Previous" : "Next"}
      className={cn(
        "focus-ring absolute top-[38%] z-10 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-border-subtle bg-surface/95 text-foreground shadow-[var(--shadow-popover)] backdrop-blur-sm transition-opacity duration-200 hover:bg-surface disabled:pointer-events-none disabled:opacity-0 lg:flex",
        // On a full-bleed rail the arrows stay at the content column's edges.
        direction === "prev"
          ? fullBleed
            ? "left-[calc(var(--rail-gutter)-1.25rem)]"
            : "-left-5"
          : fullBleed
            ? "right-[calc(var(--rail-gutter)-1.25rem)]"
            : "-right-5",
      )}
    >
      <Icon className="h-5 w-5" aria-hidden />
    </button>
  );
}
