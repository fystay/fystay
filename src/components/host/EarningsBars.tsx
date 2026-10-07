"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";

export type EarningsBar = { label: string; shortLabel: string; cents: number; current?: boolean };

const money = (cents: number) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(cents / 100);

/** Rounds up to a clean axis maximum: 1, 2, 2.5 or 5 × a power of ten. */
function niceMax(value: number): number {
  if (value <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 2.5, 5, 10]) {
    if (step * power >= value) return step * power;
  }
  return 10 * power;
}

/**
 * Month-by-month earnings as thin columns: one series in one hue, the
 * current month in the darker step, hover/focus for the exact figure, and
 * a table for screen readers. `compact` drops the axis for the dashboard's
 * at-a-glance version.
 */
export function EarningsBars({
  bars,
  compact = false,
  height = compact ? 56 : 180,
  caption,
}: {
  bars: EarningsBar[];
  compact?: boolean;
  height?: number;
  caption: string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const max = niceMax(Math.max(...bars.map((b) => b.cents)));
  const ticks = compact ? [] : [0, max / 2, max];
  const focused = active !== null ? bars[active] : null;

  return (
    <figure className={cn("w-full", !compact && "pt-3")}>
      <div className="relative" style={{ height }}>
        {!compact && (
          <div aria-hidden className="pointer-events-none absolute inset-0">
            {ticks.map((t) => (
              <div
                key={t}
                className="absolute inset-x-0 flex items-center gap-2"
                style={{ bottom: `${(t / max) * 100}%` }}
              >
                <span className="w-12 shrink-0 -translate-y-1/2 text-right text-[11px] tabular-nums text-stone-500">
                  {money(t)}
                </span>
                <span className="h-px flex-1 -translate-y-1/2 bg-border-subtle" />
              </div>
            ))}
          </div>
        )}
        <div className={cn("absolute inset-0 flex items-end justify-between gap-0.5", !compact && "left-14")}>
          {bars.map((bar, i) => {
            const pct = bar.cents > 0 ? Math.max(3, (bar.cents / max) * 100) : 0;
            return (
              <button
                key={bar.label}
                type="button"
                aria-label={`${bar.label}: ${money(bar.cents)}`}
                onMouseEnter={() => setActive(i)}
                onMouseLeave={() => setActive(null)}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(null)}
                className="focus-ring group flex h-full flex-1 cursor-default items-end justify-center rounded-sm"
              >
                <span
                  className={cn(
                    "w-full max-w-6 rounded-t-[4px] transition-colors",
                    bar.current ? "bg-brand-600" : "bg-brand-300",
                    active === i && !bar.current && "bg-brand-400",
                    bar.cents === 0 && "bg-transparent",
                  )}
                  style={{ height: `${pct}%` }}
                />
              </button>
            );
          })}
        </div>
        {focused && (
          <div
            role="status"
            className="pointer-events-none absolute -top-1 right-0 rounded-lg border border-border-subtle bg-surface px-2.5 py-1 text-xs shadow-[var(--shadow-popover)]"
          >
            <span className="text-stone-500">{focused.label}</span>{" "}
            <span className="font-semibold text-foreground">{money(focused.cents)}</span>
          </div>
        )}
      </div>
      <div aria-hidden className={cn("mt-1.5 flex justify-between gap-0.5", !compact && "pl-14")}>
        {bars.map((bar) => (
          <span
            key={bar.label}
            className={cn(
              "flex-1 text-center text-[10px] leading-none",
              bar.current ? "font-semibold text-foreground" : "text-stone-500",
            )}
          >
            {bar.shortLabel}
          </span>
        ))}
      </div>
      <figcaption className="sr-only">{caption}</figcaption>
      {/* In a wrapper: a table ignores sr-only's 1px width and would widen the page on a phone. */}
      <div className="sr-only">
        <table>
          <caption>{caption}</caption>
          <tbody>
            {bars.map((bar) => (
              <tr key={bar.label}>
                <th scope="row">{bar.label}</th>
                <td>{money(bar.cents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}
