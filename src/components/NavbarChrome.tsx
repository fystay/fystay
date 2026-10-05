"use client";

import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { NavToneContext } from "@/components/NavTone";

/**
 * Owns the one piece of the navbar that has to know the current route: the
 * homepage's video hero wants the bar transparent and overlaid on the
 * footage at every breakpoint (see page.tsx's hero section), every other
 * page wants the normal opaque, sticky bar this site has always had.
 * Splitting this out into its own client component - rather than making
 * the whole (server, session-fetching) Navbar a client component - keeps
 * that data fetch on the server while still letting the chrome react to
 * the route.
 */
export function NavbarChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isHome = pathname === "/";

  return (
    <NavToneContext.Provider value={isHome ? "hero" : "default"}>
      <header
        data-tone={isHome ? "hero" : "default"}
        className={cn(
          "group/nav sticky top-0 z-30 border-b border-border-subtle bg-surface/90 backdrop-blur",
          // On the homepage this drops out of "sticky, opaque, its own
          // height" into "relative (not static - see below), transparent,
          // a fixed height with a matching negative margin pulled onto the
          // hero section right after it" (see that section's
          // -mt-[84px]/lg:-mt-[97px] in page.tsx) - a negative-margin
          // overlap rather than position:absolute, so this still renders in
          // normal document flow right after whatever the cookie consent
          // banner (a sibling, in-flow block above this) currently
          // occupies, instead of pinning to the literal top of the page and
          // overlapping the banner when it's showing. Applies at every
          // breakpoint, not just lg: - the header's own rendered height is
          // ~84px below lg: and ~97px at lg: (measured directly - lg: is
          // taller because the desktop logo is Logo size="lg" with extra
          // tagline clearance for the "y" descender's swash, sized so
          // its tagline spans the wordmark's full width), so the same trick
          // works whether the mobile icon-only layout or the desktop
          // logo/links/menu layout is what's actually rendering inside.
          //
          // relative, not static: z-index has no effect on a statically
          // positioned element, so a plain "static z-50" here is silently
          // a no-op - the account-menu dropdown (UserMenu/GuestMenu, opened
          // from inside this header) would then stack by DOM-order z:auto
          // against the hero's own absolutely-positioned, explicitly
          // z-indexed layers (the z-40 search bar wrapper, z-30 "now
          // covering" pills), which paint over it. "relative" with no
          // offset keeps the exact same in-flow box as "static" but lets
          // z-50 genuinely apply, so the open dropdown always wins against
          // every hero layer (max z-40) without changing layout.
          isHome && "relative z-50 border-none bg-transparent shadow-none backdrop-blur-none",
        )}
      >
        {children}
      </header>
    </NavToneContext.Provider>
  );
}
