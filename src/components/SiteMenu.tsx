"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown, Menu } from "lucide-react";
import { SECONDARY_NAV_LINKS } from "@/lib/primaryNav";

/**
 * The phone header's left-hand menu (lg:hidden in Navbar): About, Help,
 * Contact and List your property - pages with no bottom-bar tab. Account
 * actions stay in the account menu on the right.
 */
export function SiteMenu() {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
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
    if (open) menuRef.current?.querySelector<HTMLElement>("a")?.focus();
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="site-menu-panel"
        aria-label="Menu"
        className="focus-ring flex h-11 items-center gap-1.5 rounded-xl bg-brand-600 px-3 text-white hover:bg-brand-700 active:bg-brand-800"
      >
        <Menu className="h-4 w-4" aria-hidden />
        <ChevronDown className="h-4 w-4" aria-hidden />
      </button>
      <div
        ref={menuRef}
        id="site-menu-panel"
        inert={!open}
        className={
          "absolute left-0 z-20 mt-2 w-52 origin-top-left overflow-hidden rounded-xl border border-border-subtle bg-surface p-1.5 shadow-[var(--shadow-popover)] transition-all duration-150 " +
          (open ? "scale-100 opacity-100" : "pointer-events-none scale-95 opacity-0")
        }
      >
        {SECONDARY_NAV_LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            onClick={() => setOpen(false)}
            className="block rounded-lg px-3 py-2.5 text-sm text-stone-700 hover:bg-brand-50 hover:text-foreground"
          >
            {link.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
