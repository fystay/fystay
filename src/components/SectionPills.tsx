"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { useNavTone } from "@/components/NavTone";
import { activeSiteSection, SITE_SECTIONS } from "@/lib/siteSections";

type Variant = "hero" | "default";

// One segmented control rather than four free-standing pills: a single
// track holds all four sections and the current one sits on a raised
// "thumb", so the row reads as one navigation system that belongs to the
// header. Every item is the same width (equal grid columns) and the same
// padding in both states, so changing section never shifts the layout.
const TRACK_STYLES: Record<Variant, string> = {
  // Over the homepage video: the same warm dark glass as the scrim behind it.
  hero: "border-white/10 bg-ink/40 backdrop-blur-md",
  // On the cream page and the opaque header.
  default: "border-border-subtle bg-brand-50",
};

const ITEM_BASE =
  "focus-ring flex items-center justify-center rounded-[9px] px-2 py-1.5 text-[13px] font-medium whitespace-nowrap transition-[background-color,color,box-shadow] duration-150 min-[360px]:text-sm sm:px-4";

const ITEM_STYLES: Record<Variant, { active: string; inactive: string }> = {
  hero: {
    active: "bg-white text-ink shadow-[0_1px_3px_rgba(0,0,0,0.3)]",
    inactive: "text-white/85 hover:bg-white/10 hover:text-white",
  },
  default: {
    active: "bg-surface text-foreground shadow-[0_1px_2px_rgba(48,26,19,0.12),0_0_0_1px_rgba(48,26,19,0.06)]",
    inactive: "text-stone-600 hover:bg-surface/70 hover:text-foreground",
  },
};

/**
 * The Stays / Explore / Travel / Services navigation, with the current
 * route's section shown selected (aria-current="page"). The variant follows
 * the header's tone (light over the homepage video) unless one is given.
 * Full width with four equal tabs on phones, sized to its content from sm.
 */
export function SectionPills({ variant, className }: { variant?: Variant; className?: string }) {
  const active = activeSiteSection(usePathname());
  const tone = useNavTone();
  const resolved = variant ?? (tone === "hero" ? "hero" : "default");
  const styles = ITEM_STYLES[resolved];

  return (
    <nav aria-label="Sections" className={className}>
      <ul
        className={cn(
          "grid w-full grid-cols-4 gap-0.5 rounded-xl border p-[3px] sm:inline-grid sm:w-auto",
          TRACK_STYLES[resolved],
        )}
      >
        {SITE_SECTIONS.map((section) => {
          const isActive = section.key === active;
          return (
            <li key={section.key} className="flex">
              <Link
                href={section.href}
                aria-current={isActive ? "page" : undefined}
                className={cn(ITEM_BASE, "w-full", isActive ? styles.active : styles.inactive)}
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
 * The section row under the header on phones and tablets, on the homepage
 * and each section's own pages. From lg the same control sits inside the
 * header (see Navbar), so this hides there. Renders nothing outside the
 * four sections.
 */
export function SectionPillsBar() {
  const pathname = usePathname();
  if (!activeSiteSection(pathname)) return null;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pt-3 sm:px-6 sm:pt-4 lg:hidden">
      <SectionPills variant="default" className="flex justify-center sm:justify-start" />
    </div>
  );
}
