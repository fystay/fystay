"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/Logo";
import { cn } from "@/lib/cn";

type Kind = "in" | "out";

const AuthTransitionContext = createContext<(kind: Kind) => void>(() => {});

/** Call before navigating after a sign-in or sign-out, to cover the page swap. */
export function useAuthTransition() {
  return useContext(AuthTransitionContext);
}

const COPY: Record<Kind, string> = { in: "Welcome back", out: "Signing you out" };

// Long enough to read as a deliberate moment rather than a flash, short
// enough never to feel like waiting; the hard limit covers a navigation that
// never lands (or lands on the page already showing).
const MIN_VISIBLE_MS = 700;
const MAX_VISIBLE_MS = 8000;
const SAME_PAGE_MS = 1400;
const FADE_MS = 300;

/**
 * Covers the swap between signed-out and signed-in pages with a soft cream
 * screen, the wordmark and a slim progress bar, then fades away once the new
 * page is showing - instead of the header and page content jumping as the
 * session changes underneath them. Wrap the app in it; start it with
 * useAuthTransition() just before navigating.
 */
export function AuthTransitionProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [kind, setKind] = useState<Kind | null>(null);
  const [shown, setShown] = useState(false);
  const startedAt = useRef(0);
  const startedOn = useRef(pathname);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearTimers = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };

  const hide = useCallback(() => {
    const wait = Math.max(0, MIN_VISIBLE_MS - (Date.now() - startedAt.current));
    timers.current.push(
      setTimeout(() => {
        setShown(false);
        timers.current.push(setTimeout(() => setKind(null), FADE_MS));
      }, wait),
    );
  }, []);

  const start = useCallback(
    (next: Kind) => {
      clearTimers();
      startedAt.current = Date.now();
      startedOn.current = pathname;
      setKind(next);
      // Next frame, so the opacity transition has a start state to run from.
      requestAnimationFrame(() => setShown(true));
      // Signing out from the page you'll land on doesn't change the path.
      timers.current.push(setTimeout(hide, SAME_PAGE_MS));
      timers.current.push(setTimeout(hide, MAX_VISIBLE_MS));
    },
    [hide, pathname],
  );

  // The new page has arrived.
  useEffect(() => {
    if (kind && pathname !== startedOn.current) hide();
  }, [pathname, kind, hide]);

  useEffect(() => clearTimers, []);

  const value = useMemo(() => start, [start]);

  return (
    <AuthTransitionContext.Provider value={value}>
      {children}
      {kind && (
        <div
          role="status"
          aria-live="polite"
          className={cn(
            "fixed inset-0 z-[100] flex flex-col items-center justify-center gap-6 bg-background transition-opacity ease-out motion-reduce:transition-none",
            shown ? "opacity-100" : "pointer-events-none opacity-0",
          )}
          style={{ transitionDuration: `${FADE_MS}ms` }}
        >
          <Logo size="xl" />
          <p className="text-sm font-medium tracking-wide text-stone-600">{COPY[kind]}</p>
          <div className="h-0.5 w-40 overflow-hidden rounded-full bg-brand-100" aria-hidden>
            <div className="animate-auth-progress h-full w-full rounded-full bg-brand-600" />
          </div>
        </div>
      )}
    </AuthTransitionContext.Provider>
  );
}
