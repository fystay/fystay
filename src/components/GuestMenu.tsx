"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Home, UserRound } from "lucide-react";
import { cn } from "@/lib/cn";
import { SiteInfoLinks } from "@/components/SiteInfoLinks";

/**
 * The signed-out account button: one quiet outlined circle (Search is the
 * page's one filled call to action) opening Sign up / Log in, then the
 * site's own pages (Help, About, Contact) under "FYStay".
 */
/** Pages that are themselves the login/sign-up flow - never sent back to. */
const AUTH_PAGES = ["/login", "/register", "/forgot-password", "/reset-password"];

export function GuestMenu() {
  const pathname = usePathname();
  const router = useRouter();
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
        className="focus-ring flex h-11 w-11 items-center justify-center rounded-full border border-border-subtle bg-surface text-foreground transition-colors hover:border-brand-300 hover:bg-brand-50 active:bg-brand-100"
      >
        <UserRound className="h-5 w-5" strokeWidth={1.75} aria-hidden />
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
        <div className="max-h-[70vh] overflow-y-auto p-1.5">
          {/* Account actions only: the four sections are the bottom tab bar
              on phones and in the header on desktop (see SiteBottomNav), so they aren't
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
          {/* Also here for phones, where the header's own host link gives
              way to the search pill once the page's search scrolls away. */}
          <Link
            href="/host"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium text-brand-700 hover:bg-brand-50"
          >
            <Home className="h-4 w-4" aria-hidden />
            List your property
          </Link>
          <SiteInfoLinks onNavigate={() => setOpen(false)} />
        </div>
      </div>
    </div>
  );
}
