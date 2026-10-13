"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";

/**
 * The homepage hero: a slow crossfade through four places, each with its
 * own label, headline and line underneath in the same layout. Photos are
 * the owner's own (public/images/hero/), with a 960px file for phones.
 *
 * It moves on every SLIDE_MS, pauses while the tab is hidden, and never
 * moves under prefers-reduced-motion. The dots choose a slide by hand, and
 * choosing one stops the rotation, so anyone who wants it still can have it
 * still (WCAG 2.2.2).
 */
const SLIDES = [
  {
    key: "blackpool",
    eyebrow: "The Fylde Coast",
    lead: "Popular in",
    place: "Blackpool",
    line: "Holiday homes, apartments and guest houses from local hosts.",
    // Keeps the Tower in frame on a narrow screen.
    position: "object-[82%_center]",
  },
  {
    key: "windermere",
    eyebrow: "The Lake District",
    lead: "Popular in",
    place: "Windermere",
    line: "Lakeside cottages, lodges and guest houses from local hosts.",
    position: "object-[62%_center]",
  },
  {
    key: "liverpool",
    eyebrow: "Merseyside",
    lead: "Popular in",
    place: "Liverpool",
    line: "Waterfront apartments and city townhouses from local hosts.",
    position: "object-[58%_center]",
  },
  {
    key: "manchester",
    eyebrow: "Greater Manchester",
    lead: "Popular in",
    place: "Manchester",
    line: "City-centre apartments and canal-side lofts from local hosts.",
    position: "object-[72%_center]",
  },
] as const;

const SLIDE_MS = 6500;

export function HeroSlides() {
  const [index, setIndex] = useState(0);
  const [stopped, setStopped] = useState(false);

  useEffect(() => {
    if (stopped || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(() => {
      if (!document.hidden) setIndex((i) => (i + 1) % SLIDES.length);
    }, SLIDE_MS);
    return () => window.clearInterval(timer);
  }, [stopped]);

  const slide = SLIDES[index];

  return (
    <>
      <div className="absolute inset-0 overflow-hidden [mask-image:linear-gradient(to_top,transparent_0,#000_90px)] lg:[mask-image:linear-gradient(to_top,transparent_0,#000_180px)]">
        <div className="absolute inset-0 bg-ink" aria-hidden>
          {SLIDES.map((s, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={s.key}
              src={`/images/hero/${s.key}.jpg`}
              srcSet={`/images/hero/${s.key}-960.jpg 960w, /images/hero/${s.key}.jpg 1920w`}
              sizes="100vw"
              alt=""
              fetchPriority={i === 0 ? "high" : "low"}
              className={cn(
                "absolute inset-0 h-full w-full object-cover transition-opacity duration-[1400ms] ease-in-out motion-reduce:transition-none",
                s.position,
                i === index ? "opacity-100" : "opacity-0",
              )}
            />
          ))}
        </div>
        {/* A cream wash where the text sits keeps the dark headline readable
            on every photo. */}
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(246,243,236,0.85)_0%,rgba(246,243,236,0.72)_40%,rgba(246,243,236,0.35)_62%,rgba(246,243,236,0)_78%)] sm:bg-[linear-gradient(90deg,rgba(246,243,236,0.86)_0%,rgba(246,243,236,0.55)_38%,rgba(246,243,236,0)_62%)]" />
      </div>

      <div className="relative z-10 mx-auto w-full max-w-6xl px-6 pt-7 sm:pt-12 lg:pt-20">
        <div key={slide.key} className="max-w-[18rem] animate-[hero-copy-in_700ms_ease-out] motion-reduce:animate-none min-[400px]:max-w-[19.5rem] sm:max-w-md lg:max-w-xl">
          <p className="flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.22em] text-brand-700 sm:text-xs">
            <span aria-hidden className="h-[2px] w-8 rounded-full bg-brand-600" />
            {slide.eyebrow}
          </p>
          <h1 className="mt-2.5 text-[2.05rem] font-bold leading-[1.04] tracking-[-0.01em] text-foreground min-[400px]:text-[2.3rem] sm:mt-3 sm:text-[2.85rem] lg:text-[4.1rem]">
            {slide.lead} <span className="block text-brand-600">{slide.place}</span>
          </h1>
          <p className="mt-2.5 max-w-[16.5rem] text-pretty text-[13.5px] font-medium leading-snug text-foreground/85 sm:mt-4 sm:max-w-sm sm:text-base">
            {slide.line}
          </p>
        </div>
        <div className="mt-3 flex gap-1.5 sm:mt-5" role="group" aria-label="Choose a place">
          {SLIDES.map((s, i) => (
            <button
              key={s.key}
              type="button"
              onClick={() => {
                setStopped(true);
                setIndex(i);
              }}
              aria-label={s.place}
              aria-pressed={i === index}
              className="focus-ring -m-2 rounded-full p-2"
            >
              <span
                aria-hidden
                className={cn(
                  "block h-1.5 rounded-full transition-all duration-300",
                  i === index ? "w-5 bg-brand-600" : "w-1.5 bg-foreground/45",
                )}
              />
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
