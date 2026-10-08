"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Minus, Plus, Users } from "lucide-react";
import { cn } from "@/lib/cn";
import { summarizeGuests, type GuestCounts } from "@/lib/search";
import { useAnchoredPortalPosition } from "@/lib/useAnchoredPortalPosition";

const ROWS: {
  key: keyof GuestCounts;
  label: string;
  hint: string;
  min: number;
  max: number;
}[] = [
  { key: "adults", label: "Adults", hint: "Ages 13 or above", min: 1, max: 16 },
  { key: "children", label: "Children", hint: "Ages 2 – 12", min: 0, max: 16 },
  { key: "infants", label: "Infants", hint: "Under 2", min: 0, max: 5 },
  { key: "pets", label: "Pets", hint: "Not every stay allows pets", min: 0, max: 5 },
];

export function GuestCategoryPicker({
  value,
  onChange,
  capacity,
  showPets = true,
  requireDoneToConfirm = false,
  className,
  triggerClassName,
  variant = "default",
}: {
  value: GuestCounts;
  onChange: (value: GuestCounts) => void;
  /** Caps combined adults + children, e.g. to a specific listing's maxGuests. */
  capacity?: number;
  /** Hide the Pets row entirely, e.g. when a listing doesn't allow pets. */
  showPets?: boolean;
  /** When true, +/- only updates this panel's own display; onChange (and
   * whatever it triggers - on the search bar, a live re-search) only fires
   * once Done is pressed, matching the search date-range picker. Off by
   * default so the booking widget keeps applying each click immediately,
   * where there's no live search to guard against. */
  requireDoneToConfirm?: boolean;
  className?: string;
  triggerClassName?: string;
  /** "hero" swaps the closed trigger's icon/label/value to white, at every breakpoint - see SearchBar's own variant, which this mirrors. The open picker panel is unaffected. */
  variant?: "default" | "hero";
}) {
  const [open, setOpen] = useState(false);
  // Only meaningful when requireDoneToConfirm - +/- clicks update this
  // instead of calling onChange, so nothing is confirmed until Done.
  const [draft, setDraft] = useState(value);
  const containerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const position = useAnchoredPortalPosition(containerRef, open);

  // Only while open, and only in requireDoneToConfirm mode: closing without
  // pressing Done (clicking outside, Escape) must fall back to the last
  // confirmed value, not leave the trigger label showing a discarded draft.
  const displayValue = open && requireDoneToConfirm ? draft : value;
  const rows = showPets ? ROWS : ROWS.filter((row) => row.key !== "pets");

  function maxFor(key: keyof GuestCounts, rowMax: number): number {
    if (capacity === undefined) return rowMax;
    if (key === "adults") return Math.min(rowMax, capacity - displayValue.children);
    if (key === "children") return Math.min(rowMax, capacity - displayValue.adults);
    return rowMax;
  }

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      const target = e.target as Node;
      // The panel is portaled to document.body, so it's no longer a DOM
      // descendant of containerRef - it needs its own check here too.
      if (
        containerRef.current &&
        !containerRef.current.contains(target) &&
        !panelRef.current?.contains(target)
      ) {
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

  function toggleOpen() {
    setOpen((v) => {
      const next = !v;
      // Re-seed the draft from the last confirmed value each time the
      // panel opens, so a previously discarded/unfinished adjustment
      // never reappears.
      if (next && requireDoneToConfirm) setDraft(value);
      return next;
    });
  }

  function update(key: keyof GuestCounts, next: number) {
    if (requireDoneToConfirm) {
      setDraft((d) => ({ ...d, [key]: next }));
    } else {
      onChange({ ...value, [key]: next });
    }
  }

  function confirm() {
    onChange(draft);
    setOpen(false);
  }

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <button
        type="button"
        onClick={toggleOpen}
        aria-expanded={open}
        aria-controls="guest-picker-panel"
        className={cn(
          "focus-ring flex w-full items-center gap-2 rounded-xl px-3 py-1 text-left hover:bg-surface-muted",
          triggerClassName,
        )}
      >
        {/* Icon color for the non-hero case is set externally via
            triggerClassName's [&>svg]: override (see SearchBar.tsx) so
            this component's own default (stone-400, matched by the
            booking widget's unstyled usage) is never touched - the hero
            lg: amber override lives in that same external className for
            the same reason. */}
        <Users className="h-4 w-4 shrink-0 text-stone-400" />
        <span className="min-w-0 flex-1">
          <span
            className={cn(
              "block text-[11px] font-semibold text-foreground",
              variant === "hero" && "text-accent-400/90 uppercase tracking-wide",
            )}
          >
            Guests
          </span>
          {/* Full white, not a dimmed white/70 - unlike Where/dates, this
              field never actually reads as "empty": its default state is
              already a real value ("1 guest"), so treating it like an
              unset placeholder was the inconsistency, not the fix. */}
          <span className={cn("block truncate text-sm text-stone-500", variant === "hero" && "text-white")}>
            {summarizeGuests(displayValue)}
          </span>
        </span>
      </button>

      {open &&
        position &&
        createPortal(
          <div
            ref={panelRef}
            id="guest-picker-panel"
            style={{ top: position.top + 8, left: position.left }}
            className="absolute z-[60] w-72 rounded-2xl border border-border-subtle bg-surface p-4 shadow-[var(--shadow-popover)]"
          >
          <div className="flex flex-col divide-y divide-border-subtle">
            {rows.map((row) => {
              const rowMax = maxFor(row.key, row.max);
              return (
                <div
                  key={row.key}
                  className="flex items-center justify-between py-3 first:pt-0 last:pb-0"
                >
                  <div>
                    <p className="text-sm font-medium text-foreground">{row.label}</p>
                    <p className="text-xs text-stone-500">{row.hint}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => update(row.key, Math.max(row.min, displayValue[row.key] - 1))}
                      disabled={displayValue[row.key] <= row.min}
                      aria-label={`Decrease ${row.label.toLowerCase()}`}
                      className={cn(
                        "focus-ring flex h-9 w-9 items-center justify-center rounded-full border border-border-subtle text-stone-600",
                        "disabled:pointer-events-none disabled:opacity-40",
                        "hover:border-stone-400",
                      )}
                    >
                      <Minus className="h-4 w-4" />
                    </button>
                    <span className="w-4 text-center text-sm font-medium">
                      {displayValue[row.key]}
                    </span>
                    <button
                      type="button"
                      onClick={() => update(row.key, Math.min(rowMax, displayValue[row.key] + 1))}
                      disabled={displayValue[row.key] >= rowMax}
                      aria-label={`Increase ${row.label.toLowerCase()}`}
                      className={cn(
                        "focus-ring flex h-9 w-9 items-center justify-center rounded-full border border-border-subtle text-stone-600",
                        "disabled:pointer-events-none disabled:opacity-40",
                        "hover:border-stone-400",
                      )}
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          {capacity !== undefined && (
            <p className="mt-3 text-xs text-stone-500">
              This place has a maximum of {capacity} guest{capacity === 1 ? "" : "s"}.
            </p>
          )}
          {requireDoneToConfirm && (
            <div className="mt-3 flex justify-end border-t border-border-subtle pt-3">
              <button
                type="button"
                onClick={confirm}
                className="focus-ring rounded-full bg-brand-700 px-4 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-brand-800"
              >
                Done
              </button>
            </div>
          )}
          </div>,
          document.body,
        )}
    </div>
  );
}
