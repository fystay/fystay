"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { CircleUserRound, Home, Menu } from "lucide-react";
import { cn } from "@/lib/cn";
import { useNavTone } from "@/components/NavTone";

/**
 * A single trigger that opens a dropdown with Log in / Sign up, replacing
 * two separate top-right links - one control reads as calmer and more
 * considered than a permanently-visible pair of competing CTAs.
 */
/** Pages that are themselves the login/sign-up flow - never sent back to. */
const AUTH_PAGES = ["/login", "/register", "/forgot-password", "/reset-password"];

export function GuestMenu() {
  const pathname = usePathname();
  const router = useRouter();
  const isHero = useNavTone() === "hero";
  // Logging in or signing up from the menu returns the guest to the page
  // they were on (with its query, e.g. a listing's selected dates) rather
  // than the homepage. The href carries the path for no-JS/new-tab use;
  // the click handler adds the live query string.
  const returnable = pathname && !AUTH_PAGES.some((page) => pathname.startsWith(page)) && pathname !== "/";
  function authHref(page: "/login" | "/register", path: string = pathname ?? "/") {
    return returnable ? `${page}?callbackUrl=${encodeURIComponent(path)}` : page;
  }
  function goToAuth(page: "/login" | "/register") {
    return (event: React.MouseEvent<HTMLAnchorElement>) => {
      setOpen(false);
      if (!returnable || event.metaKey || event.ctrlKey || event.shiftKey) return;
      event.preventDefault();
      router.push(authHref(page, `${window.location.pathname}${window.location.search}`));
    };
  }

  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  useEffect(() => {
    if (open) {
      menuRef.current?.querySelector<HTMLElement>("a")?.focus();
    }
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="guest-menu-panel"
        aria-label="Account menu"
        className={cn(
          "focus-ring flex items-center gap-2 rounded-xl border border-transparent bg-brand-600 py-2 pl-3 pr-1.5 text-white hover:bg-brand-700 active:bg-brand-800",
          // Over the homepage video: the same quiet glass as the section
          // control, so the hero's one solid brand-coloured button is Search.
          isHero && "border-white/25 bg-white/10 backdrop-blur-md hover:bg-white/20 active:bg-white/25",
        )}
      >
        <Menu className="h-4 w-4" />
        <CircleUserRound className="h-7 w-7 text-white/90" strokeWidth={1.5} />
      </button>

      <div
        ref={menuRef}
        id="guest-menu-panel"
        // Closed, it's only faded out (so it can animate open) - inert keeps its
        // links out of the tab order and away from screen readers until then.
        inert={!open}
        className={cn(
          "absolute right-0 z-20 mt-2 w-52 origin-top-right overflow-hidden rounded-xl border border-border-subtle bg-surface shadow-[var(--shadow-popover)]",
          "transition-all duration-150",
          open ? "scale-100 opacity-100" : "pointer-events-none scale-95 opacity-0",
        )}
      >
        {/* Same brand-terracotta-to-amber gradient already used as the
            decorative top bar on BookingWidget/CheckoutForm - a thin
            accent here ties this menu into that same visual language
            instead of reading as a plain, unbranded system dropdown. */}
        <div
          className="h-1 w-full bg-gradient-to-r from-brand-600 via-brand-400 to-accent-400"
          aria-hidden
        />
        <div className="max-h-[70vh] overflow-y-auto p-1.5">
          {/* Account actions only: the four sections are the tab row under the
              header on every page (see SectionPillsBar), so they aren't
              repeated here. */}
          <Link
            href={authHref("/register")}
            onClick={goToAuth("/register")}
            className="block rounded-lg px-3 py-2.5 text-sm font-semibold text-brand-700 hover:bg-brand-50 hover:text-brand-800"
          >
            Sign up
          </Link>
          <Link
            href={authHref("/login")}
            onClick={goToAuth("/login")}
            className="block rounded-lg px-3 py-2.5 text-sm text-stone-700 hover:bg-brand-50"
          >
            Log in
          </Link>
          <div className="my-1 border-t border-border-subtle" />
          <Link
            href="/host"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium text-brand-700 hover:bg-brand-50"
          >
            <Home className="h-4 w-4" aria-hidden />
            List your property
          </Link>
        </div>
      </div>
    </div>
  );
}
