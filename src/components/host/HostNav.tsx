"use client";

import { useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarDays,
  CreditCard,
  Home,
  LayoutGrid,
  MessageCircle,
  Plug,
  Plus,
  Sparkles,
  Sun,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { useReserveBottomSpace } from "@/hooks/useReserveBottomSpace";

type NavItem = { href: string; label: string; icon: LucideIcon; match?: (path: string) => boolean };

// The five things a host does most, in the order they do them - the same
// set on desktop (tabs) and on a phone (a bottom bar within thumb reach).
const PRIMARY: NavItem[] = [
  { href: "/host/dashboard", label: "Today", icon: Sun },
  { href: "/host/bookings", label: "Bookings", icon: LayoutGrid },
  {
    href: "/host/calendar",
    label: "Calendar",
    icon: CalendarDays,
    match: (p) => p.startsWith("/host/calendar") || /^\/host\/listings\/[^/]+\/calendar/.test(p),
  },
  { href: "/host/earnings", label: "Earnings", icon: Wallet },
  {
    href: "/host/listings",
    label: "Listings",
    icon: Home,
    match: (p) => p.startsWith("/host/listings") && !/\/calendar/.test(p),
  },
];

// Set-up-once and occasional things: one tap away, never in the way.
const SECONDARY: NavItem[] = [
  { href: "/inbox", label: "Messages", icon: MessageCircle },
  { href: "/host/payouts", label: "Payouts", icon: CreditCard },
  { href: "/host/integrations", label: "Channels", icon: Plug },
  { href: "/host/promote", label: "Spotlight", icon: Sparkles },
];

function isActive(item: NavItem, path: string) {
  return item.match ? item.match(path) : path === item.href || path.startsWith(`${item.href}/`);
}

export function HostNav({ actionCount, unreadMessages }: { actionCount: number; unreadMessages: number }) {
  const path = usePathname();
  const bottomBar = useRef<HTMLElement>(null);
  useReserveBottomSpace(bottomBar);

  const badgeFor = (href: string) =>
    href === "/host/dashboard" ? actionCount : href === "/inbox" ? unreadMessages : 0;

  return (
    <>
      <div className="sticky top-0 z-30 border-b border-border-subtle bg-surface/95 backdrop-blur supports-[backdrop-filter]:bg-surface/80">
        <nav
          aria-label="Hosting"
          className="mx-auto flex w-full max-w-6xl items-center gap-1 overflow-x-auto px-4 sm:px-6 [scrollbar-width:none]"
        >
          {/* Desktop: everything as tabs. Phone: the primary five live in the bottom bar. */}
          {PRIMARY.map((item) => (
            <NavTab key={item.href} item={item} active={isActive(item, path)} badge={badgeFor(item.href)} className="hidden md:flex" />
          ))}
          <span aria-hidden className="mx-2 hidden h-5 w-px bg-border-subtle md:block" />
          {SECONDARY.map((item) => (
            <NavTab key={item.href} item={item} active={isActive(item, path)} badge={badgeFor(item.href)} subtle />
          ))}
          <Link
            href="/host/listings/new"
            className="focus-ring ml-auto hidden shrink-0 items-center gap-1.5 rounded-full bg-brand-600 px-3.5 py-1.5 text-sm font-semibold text-white hover:bg-brand-700 md:flex"
          >
            <Plus className="h-4 w-4" />
            New listing
          </Link>
        </nav>
      </div>

      <nav
        ref={bottomBar}
        aria-label="Hosting (mobile)"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-border-subtle bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      >
        <ul className="mx-auto grid max-w-md grid-cols-5">
          {PRIMARY.map((item) => {
            const active = isActive(item, path);
            const badge = badgeFor(item.href);
            const Icon = item.icon;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "focus-ring relative flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium",
                    active ? "text-brand-700" : "text-stone-500",
                  )}
                >
                  <span className="relative">
                    <Icon className={cn("h-5 w-5", active && "stroke-[2.25]")} />
                    {badge > 0 && <Badge count={badge} className="-right-2.5 -top-1.5" />}
                  </span>
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}

function NavTab({
  item,
  active,
  badge,
  subtle,
  className,
}: {
  item: NavItem;
  active: boolean;
  badge: number;
  subtle?: boolean;
  className?: string;
}) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "focus-ring relative flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-3 text-sm font-medium transition-colors",
        active
          ? "border-brand-600 text-foreground"
          : cn("border-transparent hover:text-foreground", subtle ? "text-stone-500" : "text-stone-600"),
        className,
      )}
    >
      <Icon className="h-4 w-4" />
      {item.label}
      {badge > 0 && <Badge count={badge} className="static ml-0.5" />}
    </Link>
  );
}

function Badge({ count, className }: { count: number; className?: string }) {
  return (
    <span
      className={cn(
        "absolute flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-600 px-1 text-[10px] font-semibold leading-none text-white",
        className,
      )}
    >
      {count > 9 ? "9+" : count}
      <span className="sr-only"> waiting</span>
    </span>
  );
}
