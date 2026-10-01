"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import {
  DayButton as DefaultDayButton,
  DayPicker,
  type DateRange,
  type DayButtonProps,
  type Matcher,
} from "react-day-picker";
import "react-day-picker/style.css";
import { toast } from "sonner";
import { Ban, CalendarX2, Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Field, FieldError, Label } from "@/components/ui/Label";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Dialog, ConfirmDialog } from "@/components/ui/Dialog";
import { nightsBetween } from "@/lib/availability";
import { cn } from "@/lib/cn";
import { stayDateToLocal, toStayDateString } from "@/lib/stayDates";

const dateFormatter = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });

type BookingRow = {
  id: string;
  checkIn: Date;
  checkOut: Date;
  // The page only ever fetches PENDING/CONFIRMED bookings, but Prisma's
  // generated type for a `status: { in: [...] }` filter doesn't narrow to
  // that subset, so this accepts the full enum.
  status: "PENDING" | "CONFIRMED" | "CANCELLED" | "COMPLETED" | "REFUNDED";
  guests: number;
  guestName: string | null;
  reference: string;
};

type BlockRow = {
  id: string;
  startDate: Date;
  endDate: Date;
  reason: string | null;
  source: "HOST" | "ICAL_IMPORT" | "PMS_IMPORT";
};

const LEGEND = [
  { label: "Available", swatchClassName: "bg-surface border border-border-subtle" },
  { label: "Booked", swatchClassName: "bg-red-100" },
  { label: "Pending", swatchClassName: "bg-amber-100" },
  { label: "Blocked", swatchClassName: "bg-stone-300" },
];

const WIDE_QUERY = "(min-width: 860px)";
function subscribeToWideScreen(callback: () => void) {
  const mql = window.matchMedia(WIDE_QUERY);
  mql.addEventListener("change", callback);
  return () => mql.removeEventListener("change", callback);
}
function getIsWideScreen() {
  return window.matchMedia(WIDE_QUERY).matches;
}
function getIsWideScreenServer() {
  return false;
}

/** Widens the calendar to two months once there's room, matching Airbnb/Booking.com's host calendars. */
function useIsWideScreen(): boolean {
  return useSyncExternalStore(subscribeToWideScreen, getIsWideScreen, getIsWideScreenServer);
}

function findBookingForDate(bookings: BookingRow[], date: Date): BookingRow | undefined {
  return bookings.find(
    (b) => (b.status === "CONFIRMED" || b.status === "PENDING") &&
      date >= stayDateToLocal(b.checkIn) &&
      date < stayDateToLocal(b.checkOut),
  );
}

function findBlockForDate(blocks: BlockRow[], date: Date): BlockRow | undefined {
  return blocks.find((b) => date >= stayDateToLocal(b.startDate) && date < stayDateToLocal(b.endDate));
}

type DayInfo = { booking?: BookingRow; block?: BlockRow; title: string };

export function AvailabilityCalendar({
  listingId,
  roomTypeId,
  bookings,
  blocks,
}: {
  listingId: string;
  /** Set for a HOTEL listing's per-room-type calendar; undefined otherwise. */
  roomTypeId?: string;
  bookings: BookingRow[];
  blocks: BlockRow[];
}) {
  const router = useRouter();
  const isWide = useIsWideScreen();
  const [range, setRange] = useState<DateRange | undefined>();
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unblockTarget, setUnblockTarget] = useState<BlockRow | null>(null);
  const [unblocking, setUnblocking] = useState(false);
  const [selectedBooking, setSelectedBooking] = useState<BookingRow | null>(null);

  const confirmedRanges = useMemo(
    () => bookings.filter((b) => b.status === "CONFIRMED").map((b) => ({ from: stayDateToLocal(b.checkIn), to: stayDateToLocal(b.checkOut) })),
    [bookings],
  );
  const pendingRanges = useMemo(
    () => bookings.filter((b) => b.status === "PENDING").map((b) => ({ from: stayDateToLocal(b.checkIn), to: stayDateToLocal(b.checkOut) })),
    [bookings],
  );
  const blockedRanges = useMemo(
    () => blocks.map((b) => ({ from: stayDateToLocal(b.startDate), to: stayDateToLocal(b.endDate) })),
    [blocks],
  );

  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);
  const endMonth = useMemo(() => new Date(today.getFullYear() + 2, today.getMonth(), 1), [today]);

  const disabledDays: Matcher[] = useMemo(
    () => [{ before: today }, ...confirmedRanges, ...pendingRanges, ...blockedRanges],
    [today, confirmedRanges, pendingRanges, blockedRanges],
  );

  const nights = range?.from && range?.to ? nightsBetween(range.from, range.to) : 0;

  // A booked/pending/blocked day is excluded from range selection via
  // `disabled`, which also makes react-day-picker render it as a native
  // `disabled` button - those never fire click events. This override keeps
  // ordinary days on the library's default button (so range-select still
  // works normally) and only swaps in a plain, clickable button for the
  // special days, so a host can click one to see what's booked there.
  // Recreated only when bookings/blocks change (the setState setters are
  // referentially stable), so day buttons don't remount on every render.
  const CalendarDayButton = useMemo(() => {
    function dayInfoFor(date: Date): DayInfo | undefined {
      const booking = findBookingForDate(bookings, date);
      if (booking) {
        const label = booking.status === "CONFIRMED" ? "Booked" : "Pending";
        return { booking, title: `${label} · ${booking.guestName ?? "Guest"} · #${booking.reference}` };
      }
      const block = findBlockForDate(blocks, date);
      if (block) return { block, title: block.reason ? `Blocked · ${block.reason}` : "Blocked" };
      return undefined;
    }

    function Component(props: DayButtonProps) {
      const { day, modifiers } = props;
      const ref = useRef<HTMLButtonElement>(null);
      useEffect(() => {
        if (modifiers.focused) ref.current?.focus();
      }, [modifiers.focused]);

      const isSpecial = modifiers.confirmed || modifiers.pending || modifiers.blocked;
      const info = isSpecial ? dayInfoFor(day.date) : undefined;

      if (info) {
        const { className, style, tabIndex, onFocus, onBlur, onKeyDown, onMouseEnter, onMouseLeave, children } =
          props;
        return (
          <button
            ref={ref}
            type="button"
            className={className}
            style={style}
            tabIndex={tabIndex}
            title={info.title}
            aria-label={info.title}
            aria-haspopup="dialog"
            onFocus={onFocus}
            onBlur={onBlur}
            onKeyDown={onKeyDown}
            onMouseEnter={onMouseEnter}
            onMouseLeave={onMouseLeave}
            onClick={(e) => {
              e.preventDefault();
              if (info.booking) setSelectedBooking(info.booking);
              else if (info.block) setUnblockTarget(info.block);
            }}
          >
            {children}
          </button>
        );
      }

      return <DefaultDayButton {...props} />;
    }
    return Component;
  }, [bookings, blocks]);

  async function handleBlockDates() {
    setError(null);
    if (!range?.from || !range?.to) {
      setError("Select a date range to block.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`/api/listings/${listingId}/blocks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startDate: toStayDateString(range.from),
          endDate: toStayDateString(range.to),
          reason: reason.trim() || undefined,
          roomTypeId,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not block those dates.");
        toast.error(data.error ?? "Could not block those dates.");
        return;
      }

      toast.success("Dates blocked");
      setRange(undefined);
      setReason("");
      router.refresh();
    } catch {
      setError("Something went wrong. Please try again.");
      toast.error("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUnblock() {
    if (!unblockTarget) return;
    setUnblocking(true);
    const res = await fetch(`/api/listings/${listingId}/blocks/${unblockTarget.id}`, {
      method: "DELETE",
    });
    setUnblocking(false);
    setUnblockTarget(null);

    if (res.ok) {
      toast.success("Dates unblocked");
      router.refresh();
    } else {
      const data = await res.json().catch(() => null);
      toast.error(data?.error ?? "Could not unblock those dates.");
    }
  }

  return (
    <div className="mt-6 flex flex-col gap-6">
      <Card className="p-5">
        <CardContent className="p-0">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {LEGEND.map((item) => (
              <span key={item.label} className="flex items-center gap-1.5 text-xs text-stone-600">
                <span className={cn("h-3 w-3 rounded-full", item.swatchClassName)} aria-hidden />
                {item.label}
              </span>
            ))}
          </div>
          <p className="mt-2 text-xs text-stone-500">
            Click a booked, pending, or blocked day to see details. Drag across available days to select dates to
            block.
          </p>

          <div className="mt-4 flex justify-center overflow-x-auto">
            <DayPicker
              mode="range"
              selected={range}
              onSelect={setRange}
              disabled={disabledDays}
              modifiers={{ confirmed: confirmedRanges, pending: pendingRanges, blocked: blockedRanges }}
              modifiersClassNames={{
                confirmed: "!bg-red-100 !text-red-700",
                pending: "!bg-amber-100 !text-amber-800",
                blocked: "!bg-stone-300 !text-stone-600 line-through",
              }}
              components={{ DayButton: CalendarDayButton }}
              captionLayout="dropdown"
              startMonth={today}
              endMonth={endMonth}
              numberOfMonths={isWide ? 2 : 1}
            />
          </div>

          <div className="mt-4 flex flex-col gap-3 border-t border-border-subtle pt-4">
            <Field>
              <Label htmlFor="blockReason">Reason (optional)</Label>
              <Input
                id="blockReason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Maintenance, personal use"
              />
              <FieldError>{error}</FieldError>
            </Field>
            <Button
              onClick={handleBlockDates}
              loading={submitting}
              disabled={nights === 0}
              className="self-start"
            >
              <Ban className="h-4 w-4" />
              Block selected dates
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="p-5">
        <CardHeader className="p-0">
          <CardTitle>Bookings</CardTitle>
        </CardHeader>
        <CardContent className="mt-3 p-0">
          {bookings.length === 0 ? (
            <p className="text-sm text-stone-500">No confirmed or pending bookings yet.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border-subtle">
              {bookings.map((booking) => (
                <li key={booking.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedBooking(booking)}
                    className="focus-ring flex w-full flex-wrap items-center justify-between gap-2 rounded-lg py-3 text-left hover:bg-surface-muted"
                  >
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        {dateFormatter.format(booking.checkIn)} – {dateFormatter.format(booking.checkOut)}
                      </p>
                      <p className="flex items-center gap-1 text-xs text-stone-500">
                        <Users className="h-3.5 w-3.5" />
                        {booking.guestName ?? "Guest"} · {booking.guests} guest
                        {booking.guests > 1 ? "s" : ""} · #{booking.reference}
                      </p>
                    </div>
                    <Badge variant={booking.status === "CONFIRMED" ? "success" : "warning"}>
                      {booking.status === "CONFIRMED" ? "Confirmed" : "Pending"}
                    </Badge>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card className="p-5">
        <CardHeader className="p-0">
          <CardTitle>Blocked dates</CardTitle>
        </CardHeader>
        <CardContent className="mt-3 p-0">
          {blocks.length === 0 ? (
            <p className="text-sm text-stone-500">No dates manually blocked.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border-subtle">
              {blocks.map((block) => (
                <li key={block.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                  <div>
                    <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                      {dateFormatter.format(block.startDate)} – {dateFormatter.format(block.endDate)}
                      {(block.source === "ICAL_IMPORT" || block.source === "PMS_IMPORT") && (
                        <Badge variant="neutral" className="text-[11px]">
                          Synced
                        </Badge>
                      )}
                    </p>
                    {block.reason && <p className="text-xs text-stone-500">{block.reason}</p>}
                  </div>
                  <button
                    onClick={() => setUnblockTarget(block)}
                    className="focus-ring flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm font-medium text-stone-700 hover:bg-surface-muted"
                  >
                    <CalendarX2 className="h-4 w-4" />
                    Unblock
                  </button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={selectedBooking !== null}
        onClose={() => setSelectedBooking(null)}
        title="Reservation details"
      >
        {selectedBooking && (
          <div className="flex flex-col gap-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-medium text-foreground">
                {dateFormatter.format(selectedBooking.checkIn)} – {dateFormatter.format(selectedBooking.checkOut)}
              </p>
              <Badge variant={selectedBooking.status === "CONFIRMED" ? "success" : "warning"}>
                {selectedBooking.status === "CONFIRMED" ? "Confirmed" : "Pending"}
              </Badge>
            </div>
            <p className="flex items-center gap-1.5 text-stone-600">
              <Users className="h-4 w-4 shrink-0" />
              {selectedBooking.guestName ?? "Guest"} · {selectedBooking.guests} guest
              {selectedBooking.guests > 1 ? "s" : ""}
            </p>
            <p className="text-stone-500">Booking reference #{selectedBooking.reference}</p>
          </div>
        )}
      </Dialog>

      <ConfirmDialog
        open={unblockTarget !== null}
        onClose={() => setUnblockTarget(null)}
        onConfirm={handleUnblock}
        loading={unblocking}
        title="Unblock these dates"
        description={
          unblockTarget
            ? `Make ${dateFormatter.format(unblockTarget.startDate)} – ${dateFormatter.format(unblockTarget.endDate)} bookable again?`
            : ""
        }
        confirmLabel="Unblock"
      />
    </div>
  );
}
