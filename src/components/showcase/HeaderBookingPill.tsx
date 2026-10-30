"use client";

import { useEffect } from "react";
import { setHeaderPill, type HeaderPillContent } from "@/lib/headerPill";

/**
 * Shows the listing's price and dates in the site header once the booking
 * card (or, on a wide screen, the hero's button) has scrolled up out of view,
 * and takes it away again when it's back. Renders nothing itself.
 */
export function HeaderBookingPill({ watchIds, pill }: { watchIds: string[]; pill: HeaderPillContent }) {
  const { title, subtitle, cta, href } = pill;

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const targets = watchIds.map((id) => document.getElementById(id)).filter((el): el is HTMLElement => Boolean(el));
    const content = { title, subtitle, cta, href };
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        // A target that's hidden at this screen size has no size and never decides.
        if (entry.boundingClientRect.height === 0) continue;
        setHeaderPill(!entry.isIntersecting && entry.boundingClientRect.top < 0 ? content : null);
      }
    });
    targets.forEach((target) => observer.observe(target));
    return () => {
      observer.disconnect();
      setHeaderPill(null);
    };
  }, [watchIds, title, subtitle, cta, href]);

  return null;
}
