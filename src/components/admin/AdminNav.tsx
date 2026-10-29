"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { cn } from "@/lib/cn";

const ADMIN_LINKS = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/bookings", label: "Bookings" },
  { href: "/admin/listings", label: "Listings" },
  { href: "/admin/properties", label: "Add a property" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/promo-codes", label: "Promo codes" },
  { href: "/admin/promotions", label: "Spotlight" },
  { href: "/admin/extras", label: "Trip extras" },
  { href: "/admin/hotel-affiliate", label: "Hotel affiliate" },
  { href: "/admin/disputes", label: "Disputes" },
  { href: "/admin/review-reports", label: "Review reports" },
  { href: "/admin/support-tickets", label: "Support tickets" },
  { href: "/admin/local-data", label: "Local data" },
] as const;

/**
 * Cross-links between the admin-only pages, none of which are ever linked
 * from the site's own nav (an admin reaches them by URL, per the same
 * convention /admin/local-data already established) - without this, each
 * page was an island only reachable by typing its exact path.
 */
export function AdminNav({ active }: { active: (typeof ADMIN_LINKS)[number]["href"] }) {
  const navRef = useRef<HTMLElement>(null);

  // On phones the row scrolls sideways; bring the current page's tab into view.
  useEffect(() => {
    const tab = navRef.current?.querySelector<HTMLElement>('[aria-current="page"]');
    const nav = navRef.current;
    if (!tab || !nav) return;
    nav.scrollLeft = tab.offsetLeft - (nav.clientWidth - tab.offsetWidth) / 2;
  }, [active]);

  return (
    <nav
      ref={navRef}
      aria-label="Admin"
      className="-mx-4 flex gap-1.5 overflow-x-auto border-b border-border-subtle px-4 pb-3 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:gap-2 sm:overflow-visible sm:px-0 sm:pb-4 [&::-webkit-scrollbar]:hidden"
    >
      {ADMIN_LINKS.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          aria-current={link.href === active ? "page" : undefined}
          className={cn(
            "focus-ring shrink-0 whitespace-nowrap rounded-full px-3.5 py-2 sm:py-1.5 text-sm font-medium transition-colors",
            link.href === active
              ? "bg-brand-700 text-white"
              : "text-stone-600 hover:bg-surface-muted",
          )}
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
