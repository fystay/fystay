"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { activeSiteSection, SITE_SECTIONS } from "@/lib/siteSections";

type Variant = "header" | "tabs";

// Plain text tabs that belong to the header rather than a boxed control
// sitting on it: no track, no border - the current section is marked by
// brand-coloured text and a brand underline, the rest are quiet text that
// darkens on hover. Same weight and padding in every state, so changing
// section never shifts the layout.
const ITEM_BASE =
  "focus-ring relative flex items-center justify-center whitespace-nowrap font-medium transition-colors duration-150 after:absolute after:rounded-full after:bg-brand-600 after:transition-opacity after:duration-150";

const ITEM_STYLES: Record<Variant, { base: string; active: string; inactive: string }> = {
  // Desktop: inline in the header's centre, underline just under the text.
  header: {
    base: "rounded-lg px-3.5 py-2 text-sm after:inset-x-3.5 after:bottom-0.5 after:h-0.5",
    active: "text-brand-700 after:opacity-100",
    inactive: "text-stone-600 after:opacity-0 hover:bg-brand-50 hover:text-foreground",
  },
  // Phones and tablets: the header's second row, four equal tabs whose
  // underline sits on the header's bottom edge - an app-style tab bar.
  tabs: {
    base: "w-full rounded-t-md px-1 pb-3 pt-1.5 text-[15px] after:inset-x-3 after:bottom-0 after:h-[3px] after:rounded-b-none",
    active: "text-brand-700 after:opacity-100",
    inactive: "text-stone-500 after:opacity-0 hover:text-foreground",
  },
};

/** The Stays / Explore / Travel / Services navigation, with the current route's section marked (aria-current="page"). */
export function SectionPills({ variant, className }: { variant: Variant; className?: string }) {
  const active = activeSiteSection(usePathname());
  const styles = ITEM_STYLES[variant];

  return (
    <nav aria-label="Sections" className={className}>
      <ul className={cn(variant === "tabs" ? "grid grid-cols-4" : "flex items-center gap-1")}>
        {SITE_SECTIONS.map((section) => {
          const isActive = section.key === active;
          return (
            <li key={section.key} className="flex">
              <Link
                href={section.href}
                aria-current={isActive ? "page" : undefined}
                className={cn(ITEM_BASE, styles.base, isActive ? styles.active : styles.inactive)}
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
 * The header's tab row below lg, on the homepage and each section's own
 * pages (from lg the same navigation sits inline in the header - see
 * Navbar). Renders nothing outside the four sections.
 */
export function SectionPillsBar() {
  const pathname = usePathname();
  if (!activeSiteSection(pathname)) return null;

  return (
    <div className="mx-auto w-full max-w-6xl px-3 sm:px-6 lg:hidden">
      <SectionPills variant="tabs" className="sm:max-w-md" />
    </div>
  );
}
