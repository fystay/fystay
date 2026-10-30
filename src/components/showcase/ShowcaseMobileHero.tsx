"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { Pause, Play } from "lucide-react";
import { cn } from "@/lib/cn";
import type { ShowcasePhoto } from "@/lib/showcase/types";

const SLIDE_MS = 5000;

/**
 * A phone's first screen is the place itself: a big, swipeable photo from the
 * top of the page, each one labelled, with dots and a pause control. It moves
 * on by itself (never under reduced motion, and a swipe or tap stops it).
 * The booking card rises over its foot (see ListingShowcase).
 */
export function ShowcaseMobileHero({
  photos,
  title,
}: {
  photos: ShowcasePhoto[];
  /** Shown over the foot of the photo (above the booking card that rises over it). */
  title?: { name: string; place: string };
}) {
  const trackRef = useRef<HTMLUListElement>(null);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  const scrollTo = useCallback((i: number) => {
    const track = trackRef.current;
    if (!track) return;
    track.scrollTo({ left: i * track.clientWidth, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, []);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const onScroll = () => setIndex(Math.round(track.scrollLeft / track.clientWidth));
    track.addEventListener("scroll", onScroll, { passive: true });
    return () => track.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (paused || photos.length < 2 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(() => {
      if (document.hidden) return;
      const next = ((trackRef.current ? Math.round(trackRef.current.scrollLeft / trackRef.current.clientWidth) : 0) + 1) % photos.length;
      scrollTo(next);
    }, SLIDE_MS);
    return () => window.clearInterval(timer);
  }, [paused, photos.length, scrollTo]);

  const current = photos[Math.min(index, photos.length - 1)];

  return (
    <div className="relative sm:hidden">
      <ul
        ref={trackRef}
        onTouchStart={() => setPaused(true)}
        className="flex aspect-[6/7] w-full snap-x snap-mandatory overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        aria-label="Photos of the property"
      >
        {photos.map((p, i) => (
          <li key={p.src} className="relative h-full w-full shrink-0 snap-start">
            <Image src={p.src} alt={p.alt} fill priority={i === 0} sizes="100vw" className={cn("object-cover", p.position)} />
          </li>
        ))}
      </ul>
      <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-black/30 to-transparent" aria-hidden />
      {title && (
        <>
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-3/5 bg-gradient-to-t from-black/70 via-black/30 to-transparent" aria-hidden />
          <div className="pointer-events-none absolute inset-x-5 bottom-[4.75rem] text-white [text-shadow:0_1px_12px_rgba(0,0,0,0.4)]">
            <p className="font-serif text-[2.1rem] font-bold leading-[1.05]">{title.name}</p>
            <p className="mt-1 text-xs font-semibold uppercase tracking-[0.18em] text-white/85">{title.place}</p>
          </div>
        </>
      )}
      <div className="pointer-events-none absolute inset-x-4 top-4 flex items-start justify-between gap-3">
        {current.label ? (
          <span className="rounded-full bg-surface/90 px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-800 backdrop-blur">
            {current.label}
          </span>
        ) : (
          <span />
        )}
        <div className="pointer-events-auto flex items-center gap-2 rounded-full bg-ink/65 px-3 py-2 backdrop-blur">
          <div className="flex items-center gap-1.5" role="group" aria-label="Choose a photo">
            {photos.map((p, i) => (
              <button
                key={p.src}
                type="button"
                onClick={() => {
                  setPaused(true);
                  scrollTo(i);
                }}
                aria-label={`Photo ${i + 1}`}
                aria-pressed={i === index}
                className="focus-ring -m-1.5 rounded-full p-2"
              >
                <span aria-hidden className={cn("block h-1.5 rounded-full transition-all duration-300", i === index ? "w-5 bg-white" : "w-1.5 bg-white/55")} />
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setPaused((p) => !p)}
            aria-label={paused ? "Play the photos" : "Pause the photos"}
            className="focus-ring rounded-full p-1 text-white motion-reduce:hidden"
          >
            {paused ? <Play className="h-3.5 w-3.5" aria-hidden /> : <Pause className="h-3.5 w-3.5" aria-hidden />}
          </button>
        </div>
      </div>
    </div>
  );
}
