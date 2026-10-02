"use client";

import { Children, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * A horizontally swipeable row of large, image-led cards (LargeCard,
 * ListingCard size="large"). Sized so the next card always peeks in:
 *
 * - phones: each slot is 78vw, so with the 24px page gutter and a 16px gap
 *   one full card plus roughly 12-15% of the next is visible;
 * - sm (tablet): 58vw, about 1.5 cards;
 * - lg (desktop): 40% of the content width, about 2.5 cards.
 *
 * Below lg the rail bleeds to the screen edges (-mx-6/px-6, matching the
 * page's own px-6 container) so the peeking card runs off the edge rather
 * than being clipped by the gutter. Scroll-snap keeps swipes landing on a
 * card. Prev/next arrows appear on desktop only, where there's no swipe,
 * and only while there's somewhere to scroll to.
 */
const RAIL_ROW_CLASS = "-mx-6 flex gap-4 px-6 pb-4 pt-1 lg:mx-0 lg:gap-6 lg:px-0";
const SLOT_CLASS = "w-[78vw] max-w-[440px] shrink-0 sm:w-[58vw] lg:w-[40%] lg:max-w-none";

export function LargeCardRail({ label, children }: { label: string; children: ReactNode }) {
  const railRef = useRef<HTMLUListElement>(null);
  const [canPrev, setCanPrev] = useState(false);
  const [canNext, setCanNext] = useState(false);
  const items = Children.toArray(children);

  const updateArrows = useCallback(() => {
    const rail = railRef.current;
    if (!rail) return;
    setCanPrev(rail.scrollLeft > 4);
    setCanNext(rail.scrollLeft + rail.clientWidth < rail.scrollWidth - 4);
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
    <div className="relative" role="region" aria-roledescription="carousel" aria-label={label}>
      {/* The scroller is absolutely positioned, with this invisible copy of
          the first card giving the wrapper its height - the same fix
          ListingsCarousel documents: an in-flow row wider than the screen
          widens a phone's page-fit viewport and lets the whole page pan
          sideways. inert keeps the copy out of tab order and the a11y tree. */}
      <div aria-hidden inert className={cn(RAIL_ROW_CLASS, "invisible")}>
        <div className={SLOT_CLASS}>{items[0]}</div>
      </div>
      <ul ref={railRef} className={cn(RAIL_ROW_CLASS, "absolute inset-x-0 top-0 snap-x snap-mandatory scroll-px-6 overflow-x-auto overscroll-x-contain [scrollbar-width:none] lg:scroll-px-0 [&::-webkit-scrollbar]:hidden")}>
        {items.map((item, i) => (
          <li key={i} className={cn(SLOT_CLASS, "snap-start")}>
            {item}
          </li>
        ))}
      </ul>

      {(canPrev || canNext) && (
        <>
          <RailArrow direction="prev" disabled={!canPrev} onClick={() => scrollByCard(-1)} />
          <RailArrow direction="next" disabled={!canNext} onClick={() => scrollByCard(1)} />
        </>
      )}
    </div>
  );
}

function RailArrow({
  direction,
  disabled,
  onClick,
}: {
  direction: "prev" | "next";
  disabled: boolean;
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
        direction === "prev" ? "-left-5" : "-right-5",
      )}
    >
      <Icon className="h-5 w-5" aria-hidden />
    </button>
  );
}
