"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * The homepage hero: a slow crossfade through four places, each with its
 * own label, headline and line - written for that place (what it's known
 * for, the kind of stay it suits), not a template - in the same layout. Photos are
 * the owner's own (public/images/hero/), with a 960px file for phones.
 *
 * It moves on every SLIDE_MS, pauses while the tab is hidden, and never
 * moves under prefers-reduced-motion. The dots choose a slide by hand, and
 * choosing one stops the rotation, so anyone who wants it still can have it
 * still (WCAG 2.2.2).
 *
 * Each slide links to its place's stays: the search page with "Where"
 * already filled in, the same way a guest would pick it from the
 * suggestions (FYStay's own town for Blackpool, Google's place - id, point
 * and area - for the others), leaving only the dates to choose.
 */
const SLIDES = [
  {
    key: "blackpool",
    eyebrow: "The Fylde Coast",
    lead: "Seaside nights in",
    place: "Blackpool",
    line: "Steps from the Tower, the piers and the Illuminations, in homes run by locals.",
    search: "city=Blackpool",
    // Keeps the Tower in frame on a narrow screen.
    position: "object-[82%_center]",
  },
  {
    key: "windermere",
    eyebrow: "The Lake District",
    lead: "Slow mornings in",
    place: "Windermere",
    line: "Cottages and lodges close to the water, the lake steamers and the fells.",
    search:
      "place=ChIJOQG-dEWTfEgReVu7ERYcf9E&placeLabel=Windermere&lat=54.380685&lng=-2.906785&bbox=54.360443,-2.923883,54.39041,-2.889561",
    position: "object-[62%_center]",
  },
  {
    key: "liverpool",
    eyebrow: "Merseyside",
    lead: "Weekends in",
    place: "Liverpool",
    line: "Waterfront apartments and Georgian townhouses near the docks, the music and the match.",
    search:
      "place=ChIJt2BwZIrfekgRAW4XP28E3EI&placeLabel=Liverpool&lat=53.408371&lng=-2.991573&bbox=53.311542,-3.01918,53.486211,-2.818",
    position: "object-[58%_center]",
  },
  {
    key: "manchester",
    eyebrow: "Greater Manchester",
    lead: "City breaks in",
    place: "Manchester",
    line: "Apartments and canal-side lofts in the Northern Quarter, Ancoats and beyond.",
    search:
      "place=ChIJ2_UmUkxNekgRqmv-BDgUvtk&placeLabel=Manchester&lat=53.480759&lng=-2.24263&bbox=53.365651,-2.300097,53.544588,-2.146828",
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
  const href = `/search?${slide.search}`;

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
        {/* The whole photo goes to the place's stays; the copy below is the
            keyboard and screen-reader link, so this one stays out of tab order. */}
        <Link href={href} aria-hidden tabIndex={-1} className="absolute inset-0" />
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(246,243,236,0.85)_0%,rgba(246,243,236,0.72)_40%,rgba(246,243,236,0.35)_62%,rgba(246,243,236,0)_78%)] sm:bg-[linear-gradient(90deg,rgba(246,243,236,0.86)_0%,rgba(246,243,236,0.55)_38%,rgba(246,243,236,0)_62%)]" />
      </div>

      <div className="pointer-events-none relative z-10 mx-auto w-full max-w-6xl px-6 pt-7 sm:pt-12 lg:pt-20">
        <Link
          key={slide.key}
          href={href}
          className="focus-ring pointer-events-auto block max-w-[18rem] rounded-lg animate-[hero-copy-in_700ms_ease-out] motion-reduce:animate-none min-[400px]:max-w-[19.5rem] sm:max-w-md lg:max-w-xl"
        >
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
          <span className="mt-2 inline-flex items-center gap-1 text-[13px] font-semibold text-brand-700 sm:mt-3 sm:text-sm">
            See stays in {slide.place}
            <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </span>
        </Link>
        <div className="pointer-events-auto mt-3 flex w-fit gap-1.5 sm:mt-5" role="group" aria-label="Choose a place">
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
