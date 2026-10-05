"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";

/**
 * The homepage's hero backdrop: real, licensed aerial footage of
 * Blackpool's beach, pier and Tower (self-hosted under public/videos/ - see
 * DESTINATION_PHOTOS.ts for the same "real, licensed media only" rule this
 * codebase already applies to every other photo), muted, looped and
 * autoplaying so it reads as ambient scenery behind the headline and
 * search, never the thing competing with them.
 *
 * Exactly one encode is ever downloaded: a ~1MB 854x480 file for screens
 * up to 640px wide, a ~2MB 1280x720 one above that. The choice is made here
 * with matchMedia rather than <source media="...">, which Chromium doesn't
 * reliably honour for video - phones were fetching the small file and then
 * playing (and downloading) the large one as well. Until a source is
 * chosen, and permanently under prefers-reduced-motion (which never loads
 * a video at all), the still poster frame shows instead.
 *
 * No play/pause control, by product decision: the footage plays and loops
 * continuously as ambient scenery. Visitors who've asked their device to
 * reduce motion get the still frame instead (above), which is the
 * accessibility safeguard that remains.
 */
// A light contrast/saturation lift on both the video and its poster, so the
// footage doesn't read as flat, hazy drone-camera midday.
const GRADE_FILTER = "contrast(1.06) saturate(1.1)";

const POSTER = "/videos/hero-blackpool-pier-poster.jpg";
const SMALL_SCREEN = "(max-width: 640px)";

export function HeroBanner({ className }: { className?: string }) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- picking a source from the viewport, only knowable after mount
    setSrc(
      window.matchMedia(SMALL_SCREEN).matches
        ? "/videos/hero-blackpool-pier-mobile.mp4"
        : "/videos/hero-blackpool-pier.mp4",
    );
  }, []);

  return (
    <div className={cn("relative overflow-hidden bg-ink", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={POSTER}
        alt=""
        className="absolute inset-0 h-full w-full object-cover object-[100%_center]"
        style={{ filter: GRADE_FILTER }}
        aria-hidden
      />
      {src && (
        <video
          src={src}
          className="absolute inset-0 h-full w-full object-cover object-[100%_center]"
          style={{ filter: GRADE_FILTER }}
          poster={POSTER}
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          aria-hidden
        />
      )}
      {/* A light warm wash, blended into the footage's own tones (not laid
          over them like coloured glass), so the scenery reads as this
          brand's own rather than generic coastal stock. page.tsx layers the
          legibility scrim over the whole panel on top of this. */}
      <div
        className="pointer-events-none absolute inset-0 bg-brand-600 mix-blend-soft-light"
        style={{ opacity: 0.3 }}
        aria-hidden
      />
    </div>
  );
}
