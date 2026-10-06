"use client";

import { useRef } from "react";
import { Button } from "@/components/ui/Button";
import { useReserveBottomSpace } from "@/hooks/useReserveBottomSpace";

/**
 * On mobile the booking widget sits below the description, amenities, and
 * reviews, so without this a guest would have to scroll back up to book. A
 * sticky footer keeps the price and the next step always in reach - and it
 * says what it will actually do: the widget renders it with its own live
 * state (the total for the chosen dates, and the same action as its own
 * main button), so the two never disagree.
 */
export function MobileBookingBar({
  amount,
  detail,
  actionLabel,
  onAction,
  loading = false,
}: {
  /** The headline figure, e.g. "£1,116 total" or "£320 / night". */
  amount: React.ReactNode;
  /** A short line under it, e.g. "6-9 Dec · 3 nights". */
  detail?: React.ReactNode;
  actionLabel: string;
  onAction: () => void;
  loading?: boolean;
}) {
  const barRef = useRef<HTMLDivElement>(null);
  useReserveBottomSpace(barRef);

  return (
    <div
      ref={barRef}
      className="fixed inset-x-0 bottom-0 z-10 flex items-center justify-between gap-4 border-t border-border-subtle bg-surface px-4 py-3 shadow-[var(--shadow-popover)] [padding-bottom:calc(env(safe-area-inset-bottom)+0.75rem)] lg:hidden"
    >
      <div className="min-w-0">
        <p className="truncate text-base text-foreground">{amount}</p>
        {detail && <p className="truncate text-xs text-stone-500">{detail}</p>}
      </div>
      <Button onClick={onAction} loading={loading} size="lg" className="shrink-0">
        {actionLabel}
      </Button>
    </div>
  );
}

/** Scrolls the page's booking widget into view - the bar's action when there's nothing to do directly. */
export function scrollToBookingWidget() {
  document.getElementById("booking-widget")?.scrollIntoView({ behavior: "smooth", block: "start" });
}
