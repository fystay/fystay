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
  watchIdWide,
  title,
  priceLabel,
  ctaLabel,
  ctaHref,
  ctaHrefPhone,
}: {
  /** The first screen on a phone: the bar appears once it has scrolled away. */
  watchId: string;
  /** The same, on a bigger screen (only one of the two is on screen at a time). */
  watchIdWide: string;
  title: string;
  priceLabel: string;
  ctaLabel: string;
  ctaHref: string;
  /** Where the button goes on a phone, where the booking card is at the top. */
  ctaHrefPhone: string;
}) {
  const [visible, setVisible] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);
  useReserveBottomSpace(barRef);

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const targets = [watchId, watchIdWide].map((id) => document.getElementById(id)).filter((el): el is HTMLElement => Boolean(el));
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        // A hidden section never intersects and has no size; only the one on screen decides.
        if (entry.boundingClientRect.height === 0) continue;
        setVisible(!entry.isIntersecting && entry.boundingClientRect.top < 0);
      }
    });
    targets.forEach((target) => observer.observe(target));
    return () => observer.disconnect();
  }, [watchId, watchIdWide]);

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
        {[
          { href: ctaHrefPhone, className: "sm:hidden" },
          { href: ctaHref, className: "hidden sm:inline-flex" },
        ].map(({ href, className }) => (
          <a
            key={href}
            href={href}
            className={cn("focus-ring inline-flex h-11 shrink-0 items-center rounded-xl bg-brand-700 px-5 text-sm font-semibold text-white shadow-sm hover:bg-brand-800", className)}
          >
            {ctaLabel}
          </a>
        ))}
      </div>
    </div>
  );
}
