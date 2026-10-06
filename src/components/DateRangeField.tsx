"use client";

import { useEffect, useRef, useState } from "react";
import { DayPicker, type DateRange, type Matcher } from "react-day-picker";
import "react-day-picker/style.css";
import { CalendarDays } from "lucide-react";
import { cn } from "@/lib/cn";

const dateFormatter = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });

export function DateRangeField({
  id,
  range,
  onChange,
  disabledRanges,
  minNights = 1,
  maxNights,
}: {
  /** On the trigger button, so another control (e.g. "Choose your dates") can open the calendar. */
  id?: string;
  range: DateRange | undefined;
  onChange: (range: DateRange | undefined) => void;
  disabledRanges: Matcher[];
  /** In nights, not calendar days - passed straight through as react-day-picker's day-count min/max. */
  minNights?: number;
  maxNights?: number | null;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
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
  }, []);

  const label = range?.from
    ? range.to
      ? `${dateFormatter.format(range.from)} – ${dateFormatter.format(range.to)}`
      : `${dateFormatter.format(range.from)} – Add checkout`
    : "Add dates";

  return (
    <div ref={containerRef} className="relative">
      <button
        id={id}
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "focus-ring flex w-full items-center gap-2 rounded-lg border border-border-subtle px-3 py-2.5 text-left text-sm hover:border-stone-300",
          !range?.from && "text-stone-500",
        )}
      >
        <CalendarDays className="h-4 w-4 shrink-0 text-stone-400" />
        {label}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Choose check-in and check-out dates"
          className="absolute left-1/2 top-full z-[60] mt-2 w-max max-w-[calc(100vw-2rem)] -translate-x-1/2 overflow-x-auto rounded-2xl border border-border-subtle bg-surface p-3 shadow-[var(--shadow-popover)]"
        >
          <DayPicker
            mode="range"
            min={minNights}
            max={maxNights ?? undefined}
            selected={range}
            onSelect={(next) => {
              onChange(next);
              if (next?.from && next?.to) setOpen(false);
            }}
            disabled={disabledRanges}
            numberOfMonths={1}
            startMonth={new Date()}
          />
        </div>
      )}
    </div>
  );
}
