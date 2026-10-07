"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";

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

  return (
    // A floating card over the page, not a bar above it: the notice can only
    // be shown once the browser has checked whether it was dismissed, and a
    // bar inserted at that point pushed every page down (on phones by
    // ~130px) just after it appeared. Sits above any fixed bottom bar.
    <div
      role="region"
      aria-label="Cookie notice"
      className="animate-host-page-in fixed inset-x-3 z-50 rounded-2xl border border-border-subtle bg-surface px-4 py-3 shadow-[var(--shadow-popover)] sm:inset-x-auto sm:left-4 sm:max-w-md"
      style={{ bottom: "calc(var(--fixed-bottom-bar-height, 0px) + 0.75rem)" }}
    >
      <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-stone-600">
          We only use strictly necessary cookies to keep you signed in and run the site - no
          tracking or advertising cookies. See our{" "}
          <Link href="/legal/cookies" className="text-brand-700 underline underline-offset-2 hover:text-brand-800">
            Cookie Policy
          </Link>{" "}
          for details.
        </p>
        <Button onClick={dismiss} size="sm" className="shrink-0">
          Got it
        </Button>
      </div>
    </div>
  );
}
