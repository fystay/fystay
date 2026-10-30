"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { useReserveBottomSpace } from "@/hooks/useReserveBottomSpace";

const DISMISSED_KEY = "fystay:cookie-notice-dismissed";

function readDismissed(): boolean {
  try {
    return window.localStorage.getItem(DISMISSED_KEY) === "true";
  } catch {
    // localStorage can be unavailable (private browsing, disabled storage)
    // - showing the notice every visit is the safe fallback.
    return false;
  }
}

export function CookieConsentBanner() {
  // Always starts hidden during the server render and the first client
  // render (before hydration), then this mount-only effect reveals it if
  // it hasn't already been dismissed. A lazy useState initializer would run
  // during render instead and could mismatch between server and client,
  // since whether localStorage has a "dismissed" flag can only be known
  // client-side, after mount.
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing with an external system (localStorage) that's only readable post-mount, not derivable from props/state
    setVisible(!readDismissed());
  }, []);

  function dismiss() {
    setVisible(false);
    try {
      window.localStorage.setItem(DISMISSED_KEY, "true");
    } catch {
      // Nothing to persist to - the notice will just show again next visit.
    }
  }

  if (!visible) return null;
  return <CookieBar onDismiss={dismiss} />;
}

/**
 * A slim bar along the bottom edge that reserves its own height (the same
 * way a page's booking bar does), so the page's content, the search card and
 * the support button all sit above it instead of underneath. It can only be
 * shown once the browser has checked whether it was dismissed; reserving
 * space at the bottom means that moment never pushes the page down.
 */
function CookieBar({ onDismiss }: { onDismiss: () => void }) {
  const barRef = useRef<HTMLDivElement>(null);
  useReserveBottomSpace(barRef, { pageBar: false });

  return (
    <div
      ref={barRef}
      role="region"
      aria-label="Cookie notice"
      className="animate-host-page-in fixed inset-x-0 bottom-0 z-50 border-t border-border-subtle bg-surface/95 px-4 pb-[calc(0.625rem+env(safe-area-inset-bottom))] pt-2.5 backdrop-blur"
    >
      <div className="mx-auto flex max-w-6xl items-center gap-3">
        <p className="min-w-0 flex-1 text-xs leading-snug text-stone-600 sm:text-sm">
          Strictly necessary cookies only - no tracking or advertising.{" "}
          <Link href="/legal/cookies" className="whitespace-nowrap text-brand-700 underline underline-offset-2 hover:text-brand-800">
            Cookie Policy
          </Link>
        </p>
        <Button onClick={onDismiss} size="sm" className="shrink-0">
          Got it
        </Button>
      </div>
    </div>
  );
}
