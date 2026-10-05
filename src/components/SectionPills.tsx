"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { cn } from "@/lib/cn";
import { activeSiteSection, SITE_SECTIONS, type SiteSectionKey } from "@/lib/siteSections";

type Variant = "header" | "tabs";

// Plain text tabs that belong to the header rather than a boxed control
// sitting on it: no track, no border. The current section reads as pressed
// in - brand-coloured text on a soft brand tint with a faint inner shadow -
// with the brand underline beneath it; the rest are quiet text that darkens
// on hover. Same weight and padding in every state, so changing section
// never shifts the layout.
const ITEM_BASE =
  "focus-ring relative flex items-center justify-center whitespace-nowrap font-medium transition-[color,background-color,box-shadow] duration-200";

const ITEM_STYLES: Record<
  Variant,
  {
    base: string;
    active: string;
    inactive: string;
    underline: string;
    staticUnderline: string;
    inset: number;
  }
> = {
  // Desktop: inline in the header's centre, underline just under the text.
  header: {
    base: "rounded-lg px-3.5 py-2 text-sm",
    active: "bg-brand-50 text-brand-700 shadow-[inset_0_2px_4px_-2px_rgba(124,45,18,0.18)]",
    inactive: "text-stone-600 hover:bg-brand-50 hover:text-foreground",
    underline: "bottom-0.5 h-0.5 rounded-full",
    staticUnderline:
      "after:absolute after:inset-x-3.5 after:bottom-0.5 after:h-0.5 after:rounded-full after:bg-brand-600",
    inset: 14,
  },
  // Phones and tablets: the header's second row, four equal tabs whose
  // underline sits on the header's bottom edge - an app-style tab bar.
  tabs: {
    base: "w-full rounded-t-lg px-1 pb-3 pt-1.5 text-[15px]",
    active: "bg-brand-50/70 text-brand-700 shadow-[inset_0_2px_4px_-2px_rgba(124,45,18,0.16)]",
    inactive: "text-stone-500 hover:text-foreground",
    underline: "bottom-0 h-[3px] rounded-t-full",
    staticUnderline:
      "after:absolute after:inset-x-3 after:bottom-0 after:h-[3px] after:rounded-t-full after:bg-brand-600",
    inset: 12,
  },
};

/**
 * The Stays / Discover / Journeys / Services navigation, with the current
 * route's section marked (aria-current="page").
 *
 * The underline is one element that glides between tabs, and it moves the
 * moment a tab is pressed - not once the next page has loaded - so the tap
 * feels answered straight away while the page arrives behind it. That
 * pressed-but-not-yet-loaded state is remembered against the pathname it
 * was pressed on, so it gives way to the real section as soon as the route
 * changes (or stays put if the navigation never happens). aria-current
 * always follows the real route.
 */
export function SectionPills({ variant, className }: { variant: Variant; className?: string }) {
  const pathname = usePathname();
  const active = activeSiteSection(pathname);
  const [pressed, setPressed] = useState<{
    key: SiteSectionKey;
    on: string;
  } | null>(null);
  const shown = pressed && pressed.on === pathname ? pressed.key : active;
  const styles = ITEM_STYLES[variant];

  const rowRef = useRef<HTMLDivElement>(null);
  // Where the underline sits (null until measured on the client - until
  // then the shown tab draws its own static underline, so the server-
  // rendered page is never missing it), and whether it may animate: not
  // on its first placement, nor when it appears from no section at all.
  const [bar, setBar] = useState<{
    left: number;
    width: number;
    animate: boolean;
  } | null>(null);
  const previousShown = useRef<SiteSectionKey | null>(null);

  useEffect(() => {
    function place(animate: boolean) {
      // Found by data attribute rather than a ref on each Link, so the
      // links themselves are left exactly as Next renders them.
      const link = shown ? rowRef.current?.querySelector<HTMLElement>(`[data-section="${shown}"]`) : null;
      if (!link) return;
      setBar({ left: link.offsetLeft + styles.inset, width: link.offsetWidth - styles.inset * 2, animate });
    }
    // A frame later, not in a layout effect: measuring and re-rendering in
    // the same commit as hydration dropped presses made while the page was
    // still becoming interactive (the static underline covers that frame).
    const animate = previousShown.current !== null;
    previousShown.current = shown;
    const frame = requestAnimationFrame(() => place(animate));
    // Re-measure without animating when the row really resizes (viewport,
    // fonts) - not on the observer's initial callback, which would cut a
    // glide just started short.
    const row = rowRef.current;
    let rowWidth = row?.offsetWidth;
    const observer = new ResizeObserver(() => {
      if (row?.offsetWidth === rowWidth) return;
      rowWidth = row?.offsetWidth;
      place(false);
    });
    if (row) observer.observe(row);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [shown, styles.inset]);

  function handleClick(event: MouseEvent<HTMLAnchorElement>, key: SiteSectionKey) {
    // A new-tab/window click doesn't navigate this page.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    setPressed({ key, on: pathname });
  }

  const measured = bar !== null && shown !== null;

  return (
    <nav aria-label="Sections" className={className}>
      {/* relative here, not on the list: the links' offsetLeft (where the
          underline is placed) is measured against this box. */}
      <div ref={rowRef} className="relative">
        <ul className={cn(variant === "tabs" ? "grid grid-cols-4" : "flex items-center gap-1")}>
          {SITE_SECTIONS.map((section) => {
            const isShown = section.key === shown;
            return (
              <li key={section.key} className="flex">
                <Link
                  data-section={section.key}
                  href={section.href}
                  onClick={(event) => handleClick(event, section.key)}
                  aria-current={section.key === active ? "page" : undefined}
                  className={cn(
                    ITEM_BASE,
                    styles.base,
                    isShown ? styles.active : styles.inactive,
                    // The static underline, until the gliding one is measured.
                    isShown && !measured && styles.staticUnderline,
                  )}
                >
                  {section.label}
                </Link>
              </li>
            );
          })}
        </ul>
        {measured && (
          <span
            aria-hidden
            className={cn(
              "pointer-events-none absolute left-0 bg-brand-600 will-change-transform motion-reduce:transition-none",
              styles.underline,
              bar.animate && "transition-[transform,width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
            )}
            style={{ width: bar.width, transform: `translateX(${bar.left}px)` }}
          />
        )}
      </div>
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
