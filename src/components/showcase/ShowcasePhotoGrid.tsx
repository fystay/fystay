"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { cn } from "@/lib/cn";
import type { ShowcasePhoto } from "@/lib/showcase/types";

/**
 * A grid of the property's photos in FYStay's editorial frame (square
 * corners, terracotta rule). Tapping one opens it large, with the owner's
 * description of it, arrows and the keyboard to move along.
 */
export function ShowcasePhotoGrid({ photos: shown, more = [], className }: { photos: ShowcasePhoto[]; more?: ShowcasePhoto[]; className?: string }) {
  const photos = [...shown, ...more];
  const [open, setOpen] = useState<number | null>(null);
  const close = useCallback(() => setOpen(null), []);
  const step = useCallback((by: number) => setOpen((i) => (i === null ? i : (i + by + photos.length) % photos.length)), [photos.length]);

  useEffect(() => {
    if (open === null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
      if (event.key === "ArrowRight") step(1);
      if (event.key === "ArrowLeft") step(-1);
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, close, step]);

  return (
    <>
      <ul className={cn("grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4", className)}>
        {shown.map((p, i) => (
          <li key={p.src} className={cn(i === 0 && "col-span-2 row-span-2")}>
            <button
              type="button"
              onClick={() => setOpen(i)}
              aria-label={`Open photo: ${p.alt}`}
              className="focus-ring group relative block h-full w-full overflow-hidden border-b-[3px] border-brand-500 bg-surface-muted shadow-[var(--shadow-card)] ring-1 ring-black/5"
            >
              <div className={cn("relative w-full", i === 0 ? "aspect-[4/3] lg:aspect-auto lg:h-full lg:min-h-[22rem]" : "aspect-[4/3]")}>
                <Image
                  src={p.src}
                  alt={p.alt}
                  fill
                  sizes={i === 0 ? "(min-width: 1024px) 560px, 100vw" : "(min-width: 1024px) 280px, 50vw"}
                  className="object-cover transition-transform duration-500 group-hover:scale-105"
                />
              </div>
            </button>
          </li>
        ))}
      </ul>

      {more.length > 0 && (
        <button
          type="button"
          onClick={() => setOpen(0)}
          className="focus-ring mt-5 inline-flex h-11 items-center rounded-xl border border-border-subtle px-5 text-sm font-semibold text-foreground hover:bg-surface-muted"
        >
          View all {photos.length} photos
        </button>
      )}

      {open !== null && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Photo viewer"
          className="fixed inset-0 z-[90] flex flex-col items-center justify-center gap-4 bg-ink/95 p-4"
          onClick={close}
        >
          <button type="button" onClick={close} aria-label="Close" className="focus-ring absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20">
            <X className="h-5 w-5" aria-hidden />
          </button>
          <div className="relative h-[70svh] w-full max-w-4xl" onClick={(e) => e.stopPropagation()}>
            <Image src={photos[open].src} alt={photos[open].alt} fill sizes="(min-width: 1024px) 896px, 100vw" className="object-contain" />
          </div>
          <p className="max-w-2xl text-center text-sm text-white/85" onClick={(e) => e.stopPropagation()}>
            {photos[open].alt}
          </p>
          <div className="flex items-center gap-4" onClick={(e) => e.stopPropagation()}>
            <button type="button" onClick={() => step(-1)} aria-label="Previous photo" className="focus-ring rounded-full bg-white/10 p-2 text-white hover:bg-white/20">
              <ChevronLeft className="h-5 w-5" aria-hidden />
            </button>
            <span className="text-xs tabular-nums text-white/70">
              {open + 1} / {photos.length}
            </span>
            <button type="button" onClick={() => step(1)} aria-label="Next photo" className="focus-ring rounded-full bg-white/10 p-2 text-white hover:bg-white/20">
              <ChevronRight className="h-5 w-5" aria-hidden />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
