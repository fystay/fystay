"use client";

import { cn } from "@/lib/cn";
import { useNavTone } from "@/components/NavTone";

const sizeClasses = {
  sm: "text-2xl",
  md: "text-3xl",
  lg: "text-4xl",
  xl: "text-5xl",
};

export function Logo({
  size = "md",
  withTagline = false,
  taglineClassName,
  className,
}: {
  size?: keyof typeof sizeClasses;
  withTagline?: boolean;
  /** Overrides the tagline's own size/spacing - the default (text-sm) suits
   * the footer's roomier logo block, but a sticky navbar shown on every
   * page needs it noticeably smaller so the header doesn't grow taller
   * site-wide. */
  taglineClassName?: string;
  className?: string;
}) {
  const tone = useNavTone();
  const isHero = tone === "hero";

  return (
    <span className={cn("inline-flex flex-col", className)}>
      <span
        className={cn(
          // tracking-tight pulls DM Serif Display's fairly generous default
          // spacing in so "FY" and "Stay" read as one fused wordmark rather
          // than two adjacent words - font-normal guards against the
          // browser synthesizing a bolder weight than the single 400 the
          // font actually ships.
          "font-[family-name:var(--font-logo)] font-normal leading-none tracking-tight",
          sizeClasses[size],
        )}
      >
        <span className="text-brand-600">FY</span>
        <span className={cn("text-[var(--color-ink)]", isHero && "text-white")}>Stay</span>
      </span>
      {withTagline && (
        <span
          className={cn(
            // Sized to match the "FYStay" wordmark's own rendered width at
            // this component's "sm" size (the only size any caller
            // currently pairs with a tagline) - "Apartments · B&Bs · Lodges"
            // is roughly 3x the character count of "FYStay", so fitting it
            // into the same width needs a font size this much smaller, not
            // just a token step down like text-sm/text-xs.
            //
            // States what's actually on the marketplace (three real
            // property-type categories, not a mood line) - "Your stay,
            // your way" said nothing a visitor couldn't already guess from
            // "FYStay" itself.
            "mt-1.5 flex items-center gap-1 font-[family-name:var(--font-logo)] text-[7px] uppercase tracking-wide",
            taglineClassName,
          )}
        >
          <span className={cn("text-[var(--color-ink)]", isHero && "text-white/90")}>Apartments</span>
          <span className={cn("text-stone-400", isHero && "text-white/40")} aria-hidden>
            &middot;
          </span>
          <span className={cn("text-[var(--color-ink)]", isHero && "text-white/90")}>B&amp;Bs</span>
          <span className={cn("text-stone-400", isHero && "text-white/40")} aria-hidden>
            &middot;
          </span>
          <span className={cn("text-[var(--color-ink)]", isHero && "text-white/90")}>Lodges</span>
        </span>
      )}
    </span>
  );
}
