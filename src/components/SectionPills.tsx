"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { activeSiteSection, SITE_SECTIONS } from "@/lib/siteSections";

type Variant = "hero" | "default";

// Every pill has the same border width, padding and font weight in both
// states, so selecting one never changes its size (no layout shift). The
// pressed look is an inset shadow, a deeper background and a 1px drop;
// inactive pills keep a small raised shadow so they still read as buttons.
const PILL_BASE =
  "focus-ring inline-flex items-center rounded-full border px-3.5 py-1.5 text-sm font-medium whitespace-nowrap transition-[background-color,color,box-shadow,transform] duration-150 sm:px-4";

const PILL_STYLES: Record<Variant, { active: string; inactive: string }> = {
  // Over the homepage video: the same dark-glass tokens as the search panel
  // it sits on (bg-ink/*, border-white/*).
  hero: {
    active:
      "translate-y-px border-white/10 bg-ink/80 text-white shadow-[inset_0_2px_6px_rgba(0,0,0,0.55)] backdrop-blur-xl",
    inactive:
      "border-white/15 bg-white/10 text-white/85 shadow-[0_1px_2px_rgba(0,0,0,0.25)] backdrop-blur-xl hover:bg-white/20 hover:text-white",
  },
  // On the cream page background.
  default: {
    active:
      "translate-y-px border-brand-200 bg-brand-100 text-brand-800 shadow-[inset_0_2px_4px_rgba(48,26,19,0.16)]",
    inactive:
      "border-border-subtle bg-surface text-stone-700 shadow-[0_1px_2px_rgba(48,26,19,0.08)] hover:bg-brand-50 hover:text-foreground",
  },
};

/** The Stays / Explore / Travel / Services pills, with the current route's section shown pressed (aria-current="page"). */
export function SectionPills({ variant, className }: { variant: Variant; className?: string }) {
  const active = activeSiteSection(usePathname());
  const styles = PILL_STYLES[variant];

  return (
    <nav aria-label="Sections" className={className}>
      <ul className="flex gap-1.5">
        {SITE_SECTIONS.map((section) => {
          const isActive = section.key === active;
          return (
            <li key={section.key}>
              <Link
                href={section.href}
                aria-current={isActive ? "page" : undefined}
                className={cn(PILL_BASE, isActive ? styles.active : styles.inactive)}
              >
                {section.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * The pill row under the header on each section's own pages. Renders nothing
 * on the homepage (its hero has its own row) or outside the four sections.
 */
export function SectionPillsBar() {
  const pathname = usePathname();
  if (pathname === "/" || !activeSiteSection(pathname)) return null;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pt-4 sm:px-6">
      <SectionPills variant="default" className="flex justify-center sm:justify-start" />
    </div>
  );
}
