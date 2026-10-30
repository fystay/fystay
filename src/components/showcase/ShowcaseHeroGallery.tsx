"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import { cn } from "@/lib/cn";
import type { ShowcasePhoto } from "@/lib/showcase/types";

const SLIDE_MS = 5500;

/**
 * The listing page's lead photo: an arch (FYStay's stay-card shape) that
 * crossfades through the property's best photos, each with a small label.
 * Moves on by itself, holds while the tab is hidden, never moves under
 * reduced motion, and has a pause button and arrows (WCAG 2.2.2).
 */
export function ShowcaseHeroGallery({ photos }: { photos: ShowcasePhoto[] }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused || photos.length < 2 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(() => {
      if (!document.hidden) setIndex((i) => (i + 1) % photos.length);
    }, SLIDE_MS);
    return () => window.clearInterval(timer);
  }, [paused, photos.length]);

  const go = (step: number) => {
    setPaused(true);
    setIndex((i) => (i + step + photos.length) % photos.length);
  };
  const current = photos[index];

  return (
    <div className="relative mx-auto w-full max-w-md lg:max-w-none">
      <div
        className="relative aspect-[4/5] w-full overflow-hidden bg-surface-muted shadow-[var(--shadow-popover)] ring-1 ring-black/5 [border-top-left-radius:50%] [border-top-right-radius:50%] rounded-b-3xl"
        role="img"
        aria-label={current.alt}
      >
        {photos.map((p, i) => (
          <Image
            key={p.src}
            src={p.src}
            alt=""
            fill
            priority={i === 0}
            sizes="(min-width: 1024px) 460px, 90vw"
            className={cn(
              "object-cover transition-opacity duration-[1200ms] ease-in-out motion-reduce:transition-none",
              i === index ? "opacity-100" : "opacity-0",
            )}
          />
        ))}
        <div aria-hidden className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/45 to-transparent" />
        {current.label && (
          <span
            key={current.src}
            className="absolute bottom-5 left-1/2 -translate-x-1/2 animate-[hero-copy-in_600ms_ease-out] rounded-full bg-surface/90 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-800 backdrop-blur motion-reduce:animate-none"
          >
            {current.label}
          </span>
        )}
      </div>

      <div className="mt-4 flex items-center justify-center gap-3">
        <button type="button" onClick={() => go(-1)} aria-label="Previous photo" className="focus-ring rounded-full p-2 text-stone-500 hover:text-foreground">
          <ChevronLeft className="h-4 w-4" aria-hidden />
        </button>
        <div className="flex items-center gap-1.5" role="group" aria-label="Choose a photo">
          {photos.map((p, i) => (
            <button
              key={p.src}
              type="button"
              onClick={() => {
                setPaused(true);
                setIndex(i);
              }}
              aria-label={`Photo ${i + 1}`}
              aria-pressed={i === index}
              className="focus-ring -m-2 rounded-full p-2"
            >
              <span aria-hidden className={cn("block h-1.5 rounded-full transition-all duration-300", i === index ? "w-5 bg-brand-600" : "w-1.5 bg-stone-300")} />
            </button>
          ))}
        </div>
        <button type="button" onClick={() => go(1)} aria-label="Next photo" className="focus-ring rounded-full p-2 text-stone-500 hover:text-foreground">
          <ChevronRight className="h-4 w-4" aria-hidden />
        </button>
        <button
          type="button"
          onClick={() => setPaused((p) => !p)}
          aria-label={paused ? "Play the photos" : "Pause the photos"}
          className="focus-ring rounded-full p-2 text-stone-500 hover:text-foreground motion-reduce:hidden"
        >
          {paused ? <Play className="h-3.5 w-3.5" aria-hidden /> : <Pause className="h-3.5 w-3.5" aria-hidden />}
        </button>
      </div>
    </div>
  );
}
