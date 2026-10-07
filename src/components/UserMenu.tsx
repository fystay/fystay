"use client";

import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { Gift, Heart, Home, LayoutDashboard, Loader2, LogOut, Luggage, MessageCircle, UserCircle } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { signOutAction } from "@/actions/auth";
import { cn } from "@/lib/cn";
import { useNavTone } from "@/components/NavTone";

type Props = {
  name: string;
  role: "GUEST" | "HOST" | "ADMIN";
  unreadMessageCount?: number;
};

export function UserMenu({ name, role, unreadMessageCount = 0 }: Props) {
  const [open, setOpen] = useState(false);
  const isHero = useNavTone() === "hero";
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
      menuRef.current?.querySelector<HTMLElement>("a, button")?.focus();
    }
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="user-menu-panel"
        className={cn(
          "focus-ring flex items-center gap-2 rounded-xl border border-border-subtle py-1.5 pl-3 pr-1 hover:shadow-[var(--shadow-card)] active:bg-surface-muted",
          isHero && "border-white/40 text-white hover:bg-white/10 hover:shadow-none active:bg-white/15",
        )}
      >
        <span className="hidden text-sm font-medium sm:inline">{name.split(" ")[0]}</span>
        <span className="relative">
          <Avatar name={name} size={32} />
          {unreadMessageCount > 0 && (
            <span
              aria-hidden
              className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-red-500"
            />
          )}
        </span>
      </button>

      <div
        ref={menuRef}
        id="user-menu-panel"
        // Closed, it's only faded out (so it can animate open) - inert keeps its
        // links out of the tab order and away from screen readers until then.
        inert={!open}
        className={cn(
          "absolute right-0 z-20 mt-2 max-h-[70vh] w-56 origin-top-right overflow-y-auto rounded-xl border border-border-subtle bg-surface p-2 shadow-[var(--shadow-popover)]",
          "transition-all duration-150",
          open
            ? "scale-100 opacity-100"
            : "pointer-events-none scale-95 opacity-0",
        )}
      >
        <div className="border-b border-border-subtle px-3 py-2">
          <p className="truncate text-sm font-medium text-foreground">{name}</p>
          <Badge variant="brand" className="mt-1">
            {role === "HOST" ? "Host" : "Guest"}
          </Badge>
        </div>

        {/* Account actions only: the four sections are the tab row under
            the header on every page (see SectionPillsBar), so they aren't
            repeated here. */}

        <div className="flex flex-col py-1">
          {role === "HOST" && (
            <Link
              href="/host/dashboard"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-stone-700 hover:bg-surface-muted"
            >
              <LayoutDashboard className="h-4 w-4" /> Host dashboard
            </Link>
          )}
          <Link
            href="/inbox"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-stone-700 hover:bg-surface-muted"
          >
            <MessageCircle className="h-4 w-4" /> Messages
            {unreadMessageCount > 0 && (
              <Badge variant="brand" className="ml-auto">
                {unreadMessageCount}
              </Badge>
            )}
          </Link>
          <Link
            href="/bookings"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-stone-700 hover:bg-surface-muted"
          >
            <Luggage className="h-4 w-4" /> My trips
          </Link>
          <Link
            href="/wishlist"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-stone-700 hover:bg-surface-muted"
          >
            <Heart className="h-4 w-4" /> Wishlist
          </Link>
          <Link
            href="/refer"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-stone-700 hover:bg-surface-muted"
          >
            <Gift className="h-4 w-4" /> Refer a friend
          </Link>
          <Link
            href="/account"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-stone-700 hover:bg-surface-muted"
          >
            <UserCircle className="h-4 w-4" /> Account
          </Link>
          {role !== "HOST" && (
            <Link
              href="/host"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-brand-700 hover:bg-surface-muted"
            >
              <Home className="h-4 w-4" /> List your property
            </Link>
          )}
        </div>

        <div className="border-t border-border-subtle pt-1">
          <form action={signOutAction}>
            <LogOutButton />
          </form>
        </div>
      </div>
    </div>
  );
}

/** Says it's working the moment it's pressed - signing out is a round trip to the server. */
function LogOutButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-stone-700 hover:bg-surface-muted disabled:opacity-70"
    >
      {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <LogOut className="h-4 w-4" />}
      {pending ? "Logging out…" : "Log out"}
    </button>
  );
}
