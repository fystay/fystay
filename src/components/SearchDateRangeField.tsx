"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { DayPicker, type DateRange } from "react-day-picker";
import "react-day-picker/style.css";
import { format } from "date-fns";
import { CalendarDays } from "lucide-react";
import { cn } from "@/lib/cn";
import { useAnchoredPortalPosition } from "@/lib/useAnchoredPortalPosition";

export function SearchDateRangeField({
  range,
  onChange,
  className,
  triggerClassName,
  variant = "default",
}: {
  range: DateRange | undefined;
  onChange: (range: DateRange | undefined) => void;
  className?: string;
  /** Overrides both trigger buttons' own padding/sizing - see GuestCategoryPicker's identical prop. */
  triggerClassName?: string;
  /** "hero" swaps both closed triggers' icon/label/value to white, at every breakpoint - see SearchBar's own variant, which this mirrors. The open calendar popover is unaffected. */
  variant?: "default" | "hero";
}) {
  const [open, setOpen] = useState(false);
  // Picking dates only updates this local draft; the parent (and, on the
  // search results page, the live-filtered results) sees it when Done is
  // pressed - or when the guest clicks away (straight to Search, say) after
  // picking both dates, which is how most people use a date picker. Escape,
  // or clicking away with only one date picked, discards the draft.
  const [draftRange, setDraftRange] = useState(range);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const position = useAnchoredPortalPosition(containerRef, open);

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
        if (open && draftRange?.from && draftRange?.to) onChange(draftRange);
        setOpen(false);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, draftRange, onChange]);

  function toggleOpen() {
    setOpen((v) => {
      const next = !v;
      // Re-seed the draft from the last confirmed range each time the
      // panel opens, so a previously discarded/unfinished pick never
      // reappears.
      if (next) setDraftRange(range);
      return next;
    });
  }

  function confirm() {
    onChange(draftRange);
    setOpen(false);
  }

  const displayRange = open ? draftRange : range;
  const checkInLabel = displayRange?.from ? format(displayRange.from, "d MMM") : null;
  const checkOutLabel = displayRange?.to ? format(displayRange.to, "d MMM") : null;

  return (
    <div ref={containerRef} className={cn("relative flex items-stretch", className)}>
      {/* Two labelled halves (Check-in / Check-out) sharing one popover and
          one underlying range, rather than a single combined "Dates"
          field - the shape guests expect from a booking search, without
          changing how dates are actually picked, stored, or submitted. */}
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="date-range-panel"
        onClick={toggleOpen}
        className={cn(
          "focus-ring flex flex-1 items-center gap-2.5 rounded-xl px-3 py-2.5 text-left hover:bg-surface-muted sm:py-1.5",
          triggerClassName,
        )}
      >
        <CalendarDays
          className={cn("h-4 w-4 shrink-0 text-brand-600", variant === "hero" && "text-accent-400")}
        />
        <span className="min-w-0 flex-1">
          <span
            className={cn(
              "block text-[11px] font-semibold text-foreground",
              // Same small-caps champagne-gold treatment as the Where
              // field's own label - see its comment.
              variant === "hero" && "text-accent-400/90 uppercase tracking-wide",
            )}
          >
            Check-in
          </span>
          <span
            className={cn(
              "block truncate text-sm",
              checkInLabel ? "text-foreground" : "text-stone-500",
              variant === "hero" && (checkInLabel ? "text-white" : "text-white/70"),
            )}
          >
            {checkInLabel ?? "Add date"}
          </span>
        </span>
      </button>

      <div className={cn("my-2 w-px shrink-0 bg-border-subtle", variant === "hero" && "bg-white/15")} aria-hidden />

      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="date-range-panel"
        onClick={toggleOpen}
        className={cn(
          "focus-ring flex flex-1 items-center gap-2.5 rounded-xl px-3 py-2.5 text-left hover:bg-surface-muted sm:py-1.5",
          triggerClassName,
        )}
      >
        <span className="min-w-0 flex-1">
          <span
            className={cn(
              "block text-[11px] font-semibold text-foreground",
              variant === "hero" && "text-accent-400/90 uppercase tracking-wide",
            )}
          >
            Check-out
          </span>
          <span
            className={cn(
              "block truncate text-sm",
              checkOutLabel ? "text-foreground" : "text-stone-500",
              variant === "hero" && (checkOutLabel ? "text-white" : "text-white/70"),
            )}
          >
            {checkOutLabel ?? "Add date"}
          </span>
        </span>
      </button>

      {open &&
        position &&
        createPortal(
          <div
            ref={panelRef}
            id="date-range-panel"
            role="dialog"
            aria-label="Choose check-in and check-out dates"
            style={{ top: position.top + 8, left: position.left + position.width / 2 }}
            className="animate-dropdown-in absolute z-[60] w-max max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-2xl border border-border-subtle bg-surface p-3 shadow-[var(--shadow-popover)]"
          >
            <DayPicker
              mode="range"
              min={1}
              selected={draftRange}
              onSelect={setDraftRange}
              disabled={{ before: new Date() }}
              numberOfMonths={1}
              startMonth={new Date()}
            />
            <div className="flex justify-end border-t border-border-subtle pt-2">
              <button
                type="button"
                onClick={confirm}
                className="focus-ring rounded-full bg-brand-700 px-4 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-brand-800"
              >
                Done
              </button>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
