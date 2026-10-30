"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { useReserveBottomSpace } from "@/hooks/useReserveBottomSpace";

/**
 * Once the page's first screen has scrolled away, a bar keeps the price and
 * the way to choose dates within reach. It's the listing page's own bottom
 * bar, so the site's cookie notice and support button stack around it.
 */
export function ShowcaseStickyBar({
  watchId,
  title,
  priceLabel,
  ctaLabel,
  ctaHref,
}: {
  /** The element whose leaving the screen reveals the bar. */
  watchId: string;
  title: string;
  priceLabel: string;
  ctaLabel: string;
  ctaHref: string;
}) {
  const [visible, setVisible] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);
  useReserveBottomSpace(barRef);

  useEffect(() => {
    const target = document.getElementById(watchId);
    if (!target || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setVisible(!entry.isIntersecting && entry.boundingClientRect.top < 0));
    observer.observe(target);
    return () => observer.disconnect();
  }, [watchId]);

  return (
    <div
      ref={barRef}
      className={cn(
        "fixed inset-x-0 bottom-0 z-30 border-t border-border-subtle bg-surface/95 px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 backdrop-blur transition-transform duration-300 motion-reduce:transition-none",
        visible ? "translate-y-0" : "pointer-events-none translate-y-full",
      )}
      inert={!visible}
    >
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="truncate font-serif text-lg leading-tight text-foreground">{title}</p>
          <p className="text-sm text-stone-600">{priceLabel}</p>
        </div>
        <a
          href={ctaHref}
          className="focus-ring inline-flex h-11 shrink-0 items-center rounded-xl bg-brand-700 px-5 text-sm font-semibold text-white shadow-sm hover:bg-brand-800"
        >
          {ctaLabel}
        </a>
      </div>
    </div>
  );
}
