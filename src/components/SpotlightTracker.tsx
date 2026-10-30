"use client";

import { useEffect, useRef, type ReactNode } from "react";

/** Tells FYStay a placement was shown or clicked (src/app/api/spotlight/events) - fire and forget. */
export function reportSpotlightEvent(promotionId: string, type: "impression" | "click") {
  const body = JSON.stringify({ promotionId, type });
  try {
    if (navigator.sendBeacon?.("/api/spotlight/events", body)) return;
    void fetch("/api/spotlight/events", { method: "POST", body, keepalive: true }).catch(() => {});
  } catch {
    // Reporting must never get in the way of browsing.
  }
}

/**
 * Wraps a paid Spotlight card so its host's view and click counts keep
 * working (src/lib/spotlightStats.ts): one impression the first time at
 * least half the card is on screen, and a click when it's opened.
 */
export function SpotlightTracker({ promotionId, children }: { promotionId: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          reportSpotlightEvent(promotionId, "impression");
          observer.disconnect();
        }
      },
      { threshold: 0.5 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [promotionId]);

  return (
    <div
      ref={ref}
      onClickCapture={(event) => {
        if ((event.target as HTMLElement).closest("a")) reportSpotlightEvent(promotionId, "click");
      }}
    >
      {children}
    </div>
  );
}
