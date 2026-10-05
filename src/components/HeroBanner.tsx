"use client";

import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
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
 * A pause button sits in the panel's top-right corner: moving content that
 * starts on its own and runs longer than five seconds needs a way to stop
 * it (WCAG 2.2.2, Pause, Stop, Hide).
 */
// A light contrast/saturation lift on both the video and its poster, so the
// footage doesn't read as flat, hazy drone-camera midday.
const GRADE_FILTER = "contrast(1.06) saturate(1.1)";

const POSTER = "/videos/hero-blackpool-pier-poster.jpg";
const SMALL_SCREEN = "(max-width: 640px)";

export function HeroBanner({ className }: { className?: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  // Follows the video's own play/pause events rather than assuming autoplay
  // worked - it can be blocked (iOS Low Power Mode, data saver), and then
  // the button should offer Play, not Pause.
  const [paused, setPaused] = useState(true);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- picking a source from the viewport, only knowable after mount
    setSrc(
      window.matchMedia(SMALL_SCREEN).matches
        ? "/videos/hero-blackpool-pier-mobile.mp4"
        : "/videos/hero-blackpool-pier.mp4",
    );
  }, []);

  function togglePlayback() {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) video.play().catch(() => {});
    else video.pause();
  }

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
          ref={videoRef}
          src={src}
          className="absolute inset-0 h-full w-full object-cover object-[100%_center]"
          style={{ filter: GRADE_FILTER }}
          poster={POSTER}
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          onPlay={() => setPaused(false)}
          onPause={() => setPaused(true)}
          aria-hidden
        />
      )}
      {/* A light warm wash, blended into the footage's own tones (not laid
          over them like coloured glass), so the scenery reads as this
          brand's own rather than generic coastal stock. page.tsx layers the
          legibility scrim over the whole panel on top of this. */}
      <div
        className="pointer-events-none absolute inset-0 bg-brand-600 mix-blend-soft-light"
        style={{ opacity: 0.18 }}
        aria-hidden
      />

      {src && (
        <button
          type="button"
          onClick={togglePlayback}
          aria-label={paused ? "Play background video" : "Pause background video"}
          className="focus-ring absolute right-3 top-3 z-40 flex h-9 w-9 items-center justify-center rounded-full border border-white/20 bg-ink/45 text-white/90 backdrop-blur-md transition-colors hover:bg-ink/65 hover:text-white sm:right-4 sm:top-4"
        >
          {paused ? <Play className="h-4 w-4" aria-hidden /> : <Pause className="h-4 w-4" aria-hidden />}
        </button>
      )}
    </div>
  );
}
