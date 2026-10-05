"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { HelpCircle, Mail, MessageCircle, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { SUPPORT_EMAIL } from "@/lib/seo";


// On phones the launcher sits over the corner of the first screen - on the
// homepage, right over the benefits under the search - so there it waits
// until the visitor has scrolled a little (or the page can't scroll at all).
const PHONE_QUERY = "(max-width: 639px)";
const PHONE_REVEAL_SCROLL_PX = 240;

function launcherVisible(): boolean {
  if (!window.matchMedia(PHONE_QUERY).matches) return true;
  const canScroll = document.documentElement.scrollHeight - window.innerHeight > PHONE_REVEAL_SCROLL_PX;
  return !canScroll || window.scrollY > PHONE_REVEAL_SCROLL_PX;
}

/**
 * An honest "message us" entry point, not a fake live chat - FYStay has no
 * real-time chat system behind this, just a small team reading the same
 * inbox already linked from Help/Safety/Contact. A floating corner button
 * is still worth having on every page rather than only on /contact: it's
 * the one piece of "we're a real, responsive company" reassurance visible
 * no matter where a visitor is on the site, which is exactly where a
 * nervous first-time booker is most likely to want it.
 */
export function SupportWidget() {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  // Hidden in the server render, then shown (fading in) once the browser
  // knows the screen size - so it never flashes over a phone's first screen
  // before hiding. Measured a frame after mount, not during hydration: a
  // state change in the hydration commit itself was found to drop clicks
  // made while the page was still becoming interactive (see SectionPills).
  const [launcherShown, setLauncherShown] = useState(false);
  const visible = launcherShown || open;

  useEffect(() => {
    const update = () => setLauncherShown(launcherVisible());
    const frame = requestAnimationFrame(update);
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  return (
    <div
      ref={containerRef}
      // Stacks above the page-specific fixed bottom bar (if any) rather
      // than guessing a fixed offset or being hidden behind it - see
      // --fixed-bottom-bar-height in globals.css / useReserveBottomSpace.
      style={{ bottom: "calc(var(--fixed-bottom-bar-height, 0px) + 1rem)" }}
      className={cn(
        "fixed right-4 z-40 transition-[opacity,transform] duration-300 motion-reduce:transition-none",
        visible ? "opacity-100" : "pointer-events-none translate-y-2 opacity-0",
      )}
      inert={!visible}
    >
      {open && (
        <div
          role="dialog"
          aria-label="Get help"
          className="animate-dropdown-in absolute bottom-14 right-0 w-72 rounded-2xl border border-border-subtle bg-surface p-4 shadow-[var(--shadow-popover)]"
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-foreground">Need a hand?</p>
              <p className="mt-0.5 text-xs text-stone-500">
                A small team reads every message - not a bot.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="focus-ring -m-1 rounded-full p-1 text-stone-400 hover:bg-surface-muted hover:text-stone-600"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            className="mt-3 flex items-center gap-2.5 rounded-xl bg-brand-700 px-3.5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-800"
          >
            <Mail className="h-4 w-4 shrink-0" aria-hidden />
            Email us
          </a>

          <Link
            href="/help"
            onClick={() => setOpen(false)}
            className="mt-2 flex items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-sm font-medium text-foreground transition hover:bg-surface-muted"
          >
            <HelpCircle className="h-4 w-4 shrink-0 text-brand-600" aria-hidden />
            Browse the Help center
          </Link>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={open ? "Close help" : "Get help"}
        className={cn(
          "focus-ring flex h-12 w-12 items-center justify-center rounded-full bg-brand-700 text-white shadow-[var(--shadow-popover)] transition hover:bg-brand-800",
        )}
      >
        {open ? <X className="h-5 w-5" /> : <MessageCircle className="h-5 w-5" />}
      </button>
    </div>
  );
}
