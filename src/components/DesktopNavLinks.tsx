"use client";

import Link from "next/link";
import { cn } from "@/lib/cn";
import { useNavTone } from "@/components/NavTone";
import { HEADER_NAV_LINKS } from "@/lib/primaryNav";

/**
 * Desktop-only (lg:) secondary links (Hotels, About), beside the account
 * menu on the right of the header - the four main sections sit in the
 * centre (see Navbar). Hidden below lg, where the
 * navbar keeps its current compact mobile layout. Split out as its own
 * client component (rather than inline in the server-rendered Navbar) just
 * to read NavTone - see NavbarChrome for why that has to be a route-aware
 * client boundary.
 */
export function DesktopNavLinks() {
  const isHero = useNavTone() === "hero";

  return (
    <nav className="relative z-10 hidden items-center gap-6 text-sm font-medium lg:flex">
      {HEADER_NAV_LINKS.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className={cn(
            "focus-ring rounded-sm text-stone-600 transition-colors hover:text-brand-700",
            isHero && "text-white/90 hover:text-white",
          )}
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
