"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { HERO_SLIDES, type HeroSlideKey } from "@/lib/heroSlides";
import type { HeroStay } from "@/lib/heroStays";
import { formatPrice } from "@/lib/format";
import { reportSpotlightEvent } from "@/components/SpotlightTracker";

const SLIDE_MS = 6500;

/**
 * The homepage hero: a slow crossfade through the places in slideKeys (those
 * with live stays - see src/lib/heroSlides.ts), the first slide alone if
 * none. The place name leads the heading (for search engines and screen
 * readers as much as for the eye), with a 960px photo for phones.
 *
 * It moves on every SLIDE_MS, pauses while the tab is hidden, and never
 * moves under prefers-reduced-motion. The dots choose a slide by hand, and
 * choosing one stops the rotation, so anyone who wants it still can have it
 * still (WCAG 2.2.2). One place: no rotation and no dots.
 */
export function HeroSlides({ slideKeys, stays = [] }: { slideKeys: HeroSlideKey[]; stays?: HeroStay[] }) {
  // Paid Spotlight stays, when there are any with a hero-worthy photo, take
  // the hero (labelled Promoted); otherwise it's the places below.
  if (stays.length > 0) return <HeroStays stays={stays} />;
  return <HeroPlaces slideKeys={slideKeys} />;
}

function HeroPlaces({ slideKeys }: { slideKeys: HeroSlideKey[] }) {
  const shown = HERO_SLIDES.filter((s) => slideKeys.includes(s.key));
  const slides = shown.length > 0 ? shown : HERO_SLIDES.slice(0, 1);
  const [index, setIndex] = useState(0);
  const [stopped, setStopped] = useState(false);

  useEffect(() => {
    if (stopped || slides.length < 2 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(() => {
      if (!document.hidden) setIndex((i) => (i + 1) % slides.length);
    }, SLIDE_MS);
    return () => window.clearInterval(timer);
  }, [stopped, slides.length]);

  const slide = slides[index];
  const href = `/search?${slide.search}`;

  return (
    <>
      <div className="absolute inset-0 overflow-hidden [mask-image:linear-gradient(to_top,transparent_0,#000_90px)] lg:[mask-image:linear-gradient(to_top,transparent_0,#000_180px)]">
        <div className="absolute inset-0 bg-ink" aria-hidden>
          {slides.map((s, i) => (
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
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(240,238,230,0.85)_0%,rgba(240,238,230,0.72)_40%,rgba(240,238,230,0.35)_62%,rgba(240,238,230,0)_78%)] sm:bg-[linear-gradient(90deg,rgba(240,238,230,0.86)_0%,rgba(240,238,230,0.55)_38%,rgba(240,238,230,0)_62%)]" />
      </div>

      <div className="pointer-events-none relative z-10 mx-auto w-full max-w-6xl px-6 pt-7 sm:pt-12 lg:pt-20">
        <Link
          key={slide.key}
          href={href}
          className="focus-ring pointer-events-auto block max-w-[18rem] rounded-lg animate-[hero-copy-in_700ms_ease-out] motion-reduce:animate-none min-[400px]:max-w-[19.5rem] sm:max-w-md lg:max-w-xl"
        >
          <h1>
            <span className="flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.22em] text-brand-700 sm:text-xs">
              <span aria-hidden className="h-[2px] w-8 rounded-full bg-brand-600" />
              {slide.place}
              {/* The region would wrap on a phone; the place says enough there. */}
              <span aria-hidden className="hidden text-brand-700/60 sm:inline">·</span>
              <span className="hidden font-medium sm:inline">{slide.region}</span>
            </span>
            <span className="mt-2.5 block text-[2.05rem] font-bold leading-[1.04] tracking-[-0.01em] text-foreground min-[400px]:text-[2.3rem] sm:mt-3 sm:text-[2.85rem] lg:text-[4.1rem]">
              {slide.lead} <span className="block text-brand-600">{slide.accent}</span>
            </span>
          </h1>
          <span className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-brand-700 sm:mt-5 sm:text-base">
            See stays in {slide.place}
            <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </span>
        </Link>
        {slides.length > 1 && (
          <div className="pointer-events-auto mt-3 flex w-fit gap-1.5 sm:mt-5" role="group" aria-label="Choose a place">
            {slides.map((s, i) => (
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
        )}
      </div>
    </>
  );
}

/**
 * The hero as paid Spotlight stays: the stay's own photo, a "Promoted" label
 * (UK rules on paid placement), its name, town and price, and one link to it.
 * Rotates and pauses like the places hero; each stay's host gets the same
 * view and click counts as a Spotlight card (src/lib/spotlightStats.ts).
 */
function HeroStays({ stays }: { stays: HeroStay[] }) {
  const [index, setIndex] = useState(0);
  const [stopped, setStopped] = useState(false);

  useEffect(() => {
    if (stopped || stays.length < 2 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(() => {
      if (!document.hidden) setIndex((i) => (i + 1) % stays.length);
    }, SLIDE_MS);
    return () => window.clearInterval(timer);
  }, [stopped, stays.length]);

  const stay = stays[index];

  // Each stay's first showing counts as one view for its host.
  const [seen, setSeen] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (seen.has(stay.promotionId)) return;
    reportSpotlightEvent(stay.promotionId, "impression");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- remembers that this stay's view was reported
    setSeen((previous) => new Set(previous).add(stay.promotionId));
  }, [stay.promotionId, seen]);

  const href = `/listings/${stay.listingId}`;

  return (
    <>
      <div className="absolute inset-0 overflow-hidden [mask-image:linear-gradient(to_top,transparent_0,#000_90px)] lg:[mask-image:linear-gradient(to_top,transparent_0,#000_180px)]">
        <div className="absolute inset-0 bg-ink">
          {stays.map((s, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={s.promotionId}
              src={s.photo}
              alt={i === index ? `${s.title}, ${s.city}` : ""}
              aria-hidden={i !== index}
              fetchPriority={i === 0 ? "high" : "low"}
              className={cn(
                "absolute inset-0 h-full w-full object-cover transition-opacity duration-[1400ms] ease-in-out motion-reduce:transition-none",
                i === index ? "opacity-100" : "opacity-0",
              )}
            />
          ))}
        </div>
        <Link
          href={href}
          aria-hidden
          tabIndex={-1}
          onClick={() => reportSpotlightEvent(stay.promotionId, "click")}
          className="absolute inset-0"
        />
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(240,238,230,0.85)_0%,rgba(240,238,230,0.72)_40%,rgba(240,238,230,0.35)_62%,rgba(240,238,230,0)_78%)] sm:bg-[linear-gradient(90deg,rgba(240,238,230,0.86)_0%,rgba(240,238,230,0.55)_38%,rgba(240,238,230,0)_62%)]" />
      </div>

      <div className="pointer-events-none relative z-10 mx-auto w-full max-w-6xl px-6 pt-7 sm:pt-12 lg:pt-20">
        <Link
          key={stay.promotionId}
          href={href}
          onClick={() => reportSpotlightEvent(stay.promotionId, "click")}
          className="focus-ring pointer-events-auto block max-w-[18rem] rounded-lg animate-[hero-copy-in_700ms_ease-out] motion-reduce:animate-none min-[400px]:max-w-[19.5rem] sm:max-w-md lg:max-w-xl"
        >
          <h1>
            <span className="flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.22em] text-brand-700 sm:text-xs">
              <span aria-hidden className="h-[2px] w-8 rounded-full bg-brand-600" />
              Spotlight stay
              <span aria-hidden className="text-brand-700/60">·</span>
              {/* The paid-placement label, quiet but always there. */}
              <span className="font-medium">Promoted</span>
            </span>
            <span className="mt-2.5 block line-clamp-3 text-[2.05rem] font-bold leading-[1.04] tracking-[-0.01em] text-foreground min-[400px]:text-[2.3rem] sm:mt-3 sm:text-[2.85rem] lg:text-[3.6rem]">
              {stay.title}
            </span>
          </h1>
          <span className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-brand-700 sm:mt-5 sm:text-base">
            {stay.city} · From {formatPrice(stay.priceFromCents)} a night
            <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </span>
        </Link>
        {stays.length > 1 && (
          <div className="pointer-events-auto mt-3 flex w-fit gap-1.5 sm:mt-5" role="group" aria-label="Choose a stay">
            {stays.map((s, i) => (
              <button
                key={s.promotionId}
                type="button"
                onClick={() => {
                  setStopped(true);
                  setIndex(i);
                }}
                aria-label={s.title}
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
        )}
      </div>
    </>
  );
}
