"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { BedDouble, CarFront, Compass, LayoutGrid, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { activeSiteSection, SITE_SECTIONS, type SiteSectionKey } from "@/lib/siteSections";
import { usePageBottomBarPresent, useReserveBottomSpace } from "@/hooks/useReserveBottomSpace";

type Variant = "header";

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
        <ul className="flex items-center gap-1">
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

const SECTION_ICONS: Record<SiteSectionKey, LucideIcon> = {
  stays: BedDouble,
  explore: Compass,
  travel: CarFront,
  services: LayoutGrid,
};

// Pages whose own fixed bottom bar takes the bottom edge from the first
// render (booking a listing or hotel, checkout, the hosting tools): the
// site bar isn't drawn there at all, so it never flashes in before the
// page's bar mounts. Any other page bar hides it once mounted (see
// usePageBottomBarPresent).
function pageOwnsBottomEdge(pathname: string): boolean {
  return (
    pathname.startsWith("/listings/") ||
    pathname.startsWith("/checkout/") ||
    /^\/hotels\/[^/]+\/[^/]+/.test(pathname) ||
    pathname.startsWith("/host/")
  );
}

/**
 * The four sections as a bottom tab bar below lg - in thumb reach on a
 * phone, on every page outside the sections too (with none selected), so
 * there's always the same way round the site. From lg the same navigation
 * sits inline in the header instead (see Navbar), so it's never offered
 * twice. It reserves its own height at the bottom of the page (content and
 * the footer stay clear of it, and the support button and cookie notice
 * sit above it), keeps out of the iPhone home indicator's area, and gives
 * way to a page's own bottom bar.
 */
export function SiteBottomNav() {
  const pathname = usePathname();
  const pageBarPresent = usePageBottomBarPresent();
  if (pageBarPresent || pageOwnsBottomEdge(pathname)) return null;
  return <SiteBottomNavBar pathname={pathname} />;
}

function SiteBottomNavBar({ pathname }: { pathname: string }) {
  const active = activeSiteSection(pathname);
  // Like the header tabs: the tapped tab lights up straight away, before
  // the next page has loaded; aria-current always follows the real route.
  const [pressed, setPressed] = useState<{ key: SiteSectionKey; on: string } | null>(null);
  const shown = pressed && pressed.on === pathname ? pressed.key : active;
  const barRef = useRef<HTMLElement>(null);
  useReserveBottomSpace(barRef, { pageBar: false });

  return (
    <nav
      ref={barRef}
      aria-label="Sections"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border-subtle bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur supports-[backdrop-filter]:bg-surface/85 lg:hidden"
    >
      <ul className="mx-auto grid max-w-md grid-cols-4">
        {SITE_SECTIONS.map((section) => {
          const Icon = SECTION_ICONS[section.key];
          const isShown = section.key === shown;
          return (
            <li key={section.key} className="flex">
              <Link
                href={section.href}
                aria-current={section.key === active ? "page" : undefined}
                onClick={(event) => {
                  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
                  setPressed({ key: section.key, on: pathname });
                }}
                className={cn(
                  "focus-ring relative flex min-h-14 w-full flex-col items-center justify-center gap-0.5 px-1 pb-1.5 pt-2 text-xs font-medium transition-colors",
                  isShown ? "text-brand-700" : "text-stone-500 hover:text-foreground",
                )}
              >
                {/* The selected tab's marker along the bar's top edge. */}
                <span
                  aria-hidden
                  className={cn(
                    "absolute inset-x-6 top-0 h-[3px] rounded-b-full bg-brand-600 transition-opacity",
                    isShown ? "opacity-100" : "opacity-0",
                  )}
                />
                <Icon className={cn("h-[22px] w-[22px]", isShown && "stroke-[2.25]")} aria-hidden />
                {section.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
