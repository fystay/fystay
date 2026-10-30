"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import { cn } from "@/lib/cn";
import type { ShowcasePhoto } from "@/lib/showcase/types";

const SLIDE_MS = 6000;

/**
 * The listing page's hero background, the same way the homepage's works: the
 * property's best photos edge to edge, crossfading slowly, dissolving into
 * the page at the foot, with a cream wash on the text side so the headline
 * reads on any photo. Each photo carries a small label and there are dots,
 * arrows and a pause control. It never moves under reduced motion.
 */
export function ShowcaseHeroBackdrop({ photos }: { photos: ShowcasePhoto[] }) {
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
    <>
      <div className="absolute inset-0 -z-10 overflow-hidden [mask-image:linear-gradient(to_top,transparent_0,#000_90px)] lg:[mask-image:linear-gradient(to_top,transparent_0,#000_160px)]">
        <div className="absolute inset-0 bg-ink">
          {photos.map((p, i) => (
            <Image
              key={p.src}
              src={p.src}
              alt={i === index ? p.alt : ""}
              aria-hidden={i !== index}
              fill
              priority={i === 0}
              sizes="100vw"
              className={cn(
                "object-cover transition-opacity duration-[1400ms] ease-in-out motion-reduce:transition-none",
                p.position,
                i === index ? "opacity-100" : "opacity-0",
              )}
            />
          ))}
        </div>
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(240,238,230,0.92)_0%,rgba(240,238,230,0.88)_62%,rgba(240,238,230,0.4)_78%,rgba(240,238,230,0)_90%)] sm:bg-[linear-gradient(90deg,rgba(240,238,230,0.92)_0%,rgba(240,238,230,0.78)_40%,rgba(240,238,230,0.25)_58%,rgba(240,238,230,0)_70%)]" />
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-6 z-10 mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-6 sm:bottom-10">
        {current.label ? (
          <span
            key={current.src}
            className="animate-[hero-copy-in_600ms_ease-out] rounded-full bg-surface/90 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-800 backdrop-blur motion-reduce:animate-none"
          >
            {current.label}
          </span>
        ) : (
          <span />
        )}
        <div className="pointer-events-auto flex items-center gap-1 rounded-full bg-surface/90 px-2 py-1 backdrop-blur">
          <button type="button" onClick={() => go(-1)} aria-label="Previous photo" className="focus-ring rounded-full p-1.5 text-stone-600 hover:text-foreground">
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
                className="focus-ring -m-1.5 rounded-full p-2"
              >
                <span aria-hidden className={cn("block h-1.5 rounded-full transition-all duration-300", i === index ? "w-5 bg-brand-600" : "w-1.5 bg-stone-400")} />
              </button>
            ))}
          </div>
          <button type="button" onClick={() => go(1)} aria-label="Next photo" className="focus-ring rounded-full p-1.5 text-stone-600 hover:text-foreground">
            <ChevronRight className="h-4 w-4" aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => setPaused((p) => !p)}
            aria-label={paused ? "Play the photos" : "Pause the photos"}
            className="focus-ring rounded-full p-1.5 text-stone-600 hover:text-foreground motion-reduce:hidden"
          >
            {paused ? <Play className="h-3.5 w-3.5" aria-hidden /> : <Pause className="h-3.5 w-3.5" aria-hidden />}
          </button>
        </div>
      </div>
    </>
  );
}
