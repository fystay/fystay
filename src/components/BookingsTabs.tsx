"use client";

import { useState } from "react";
import Link from "next/link";
import { Luggage } from "lucide-react";
import { cn } from "@/lib/cn";
import { buttonVariants } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { BookingCard, type BookingCardBooking, type BookingCardChangeRequest } from "@/components/BookingCard";
import { paginate } from "@/lib/pagination";

type TabKey = "upcoming" | "past" | "cancelled";

// A page of bookings per tab keeps a guest with a long history (56+
// upcoming trips isn't hypothetical - it's what this exact account has
// today) from rendering every single one into one ever-growing page.
// Client-side (not a URL ?page=) since the tabs themselves are already
// client-side state, not separate routes - see this component's own
// pre-pagination comment below for why.
const BOOKINGS_PAGE_SIZE = 10;

export type TabBooking = BookingCardBooking & {
  changeRequests: BookingCardChangeRequest[];
  hasAirportTransfer: boolean;
};

function EmptySection({
  message,
  hint,
  showCta,
}: {
  message: string;
  hint: string;
  showCta?: boolean;
}) {
  return (
    <Card className="flex flex-col items-center gap-3 p-12 text-center">
      <Luggage className="h-8 w-8 text-stone-300" />
      <p className="font-medium text-foreground">{message}</p>
      <p className="max-w-sm text-sm text-stone-500">{hint}</p>
      {showCta && (
        <Link href="/" className={cn(buttonVariants(), "mt-2")}>
          Start exploring
        </Link>
      )}
    </Card>
  );
}

function TabSection({
  bookings,
  page,
  onPageChange,
  emptyMessage,
  emptyHint,
  showCta,
  airportTransferProviderName,
}: {
  bookings: TabBooking[];
  page: number;
  onPageChange: (page: number) => void;
  emptyMessage: string;
  emptyHint: string;
  showCta?: boolean;
  airportTransferProviderName: string | null;
}) {
  if (bookings.length === 0) {
    return <EmptySection message={emptyMessage} hint={emptyHint} showCta={showCta} />;
  }

  const paginated = paginate(bookings, page, BOOKINGS_PAGE_SIZE);

  return (
    <div>
      <ul className="flex flex-col gap-4">
        {paginated.items.map((booking) => (
          <li key={booking.id}>
            <BookingCard
              booking={booking}
              latestChangeRequest={booking.changeRequests[0]}
              hasAirportTransfer={booking.hasAirportTransfer}
              airportTransferProviderName={airportTransferProviderName}
            />
          </li>
        ))}
      </ul>
      <PageControls page={paginated.page} totalPages={paginated.totalPages} onChange={onPageChange} />
    </div>
  );
}

/** A thin, client-state-driven stand-in for <Pagination> (which reads/writes the URL) - same look, no navigation. */
function PageControls({
  page,
  totalPages,
  onChange,
}: {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
}) {
  if (totalPages <= 1) return null;
  return (
    <nav aria-label="Bookings pages" className="flex items-center justify-center gap-1 pt-4">
      <button
        type="button"
        onClick={() => onChange(page - 1)}
        disabled={page <= 1}
        aria-label="Previous page"
        className="focus-ring flex h-9 w-9 items-center justify-center rounded-full text-sm font-medium text-stone-500 hover:bg-surface-muted disabled:pointer-events-none disabled:opacity-40"
      >
        ‹
      </button>
      {Array.from({ length: totalPages }, (_, i) => i + 1).map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(n)}
          aria-current={n === page ? "page" : undefined}
          className={cn(
            "focus-ring flex h-9 w-9 items-center justify-center rounded-full text-sm font-medium",
            n === page ? "bg-brand-700 text-white" : "text-foreground hover:bg-surface-muted",
          )}
        >
          {n}
        </button>
      ))}
      <button
        type="button"
        onClick={() => onChange(page + 1)}
        disabled={page >= totalPages}
        aria-label="Next page"
        className="focus-ring flex h-9 w-9 items-center justify-center rounded-full text-sm font-medium text-stone-500 hover:bg-surface-muted disabled:pointer-events-none disabled:opacity-40"
      >
        ›
      </button>
    </nav>
  );
}

/**
 * Tab switching is the only interactive part of "My trips" - the booking
 * data itself is fetched server-side and passed in as plain, serializable
 * arrays (Prisma rows survive the server/client boundary directly), with
 * this component owning both which tab is active and which page of that
 * tab is showing.
 */
export function BookingsTabs({
  upcoming,
  past,
  cancelled,
  airportTransferProviderName,
}: {
  upcoming: TabBooking[];
  past: TabBooking[];
  cancelled: TabBooking[];
  airportTransferProviderName: string | null;
}) {
  const counts = { upcoming: upcoming.length, past: past.length, cancelled: cancelled.length };
  const initialTab: TabKey =
    counts.upcoming > 0 ? "upcoming" : counts.past > 0 ? "past" : counts.cancelled > 0 ? "cancelled" : "upcoming";
  const [tab, setTab] = useState<TabKey>(initialTab);
  const [pages, setPages] = useState<Record<TabKey, number>>({ upcoming: 1, past: 1, cancelled: 1 });

  function selectTab(next: TabKey) {
    setTab(next);
  }

  const tabs: { key: TabKey; label: string }[] = [
    { key: "upcoming", label: "Upcoming" },
    { key: "past", label: "Past trips" },
    { key: "cancelled", label: "Cancelled" },
  ];

  const sections: Record<TabKey, { bookings: TabBooking[]; emptyMessage: string; emptyHint: string; showCta?: boolean }> = {
    upcoming: {
      bookings: upcoming,
      emptyMessage: "No upcoming trips",
      emptyHint: "Find your next stay from local hosts.",
      showCta: true,
    },
    past: {
      bookings: past,
      emptyMessage: "No past trips yet",
      emptyHint: "Your completed stays will show up here once they're done.",
    },
    cancelled: {
      bookings: cancelled,
      emptyMessage: "No cancelled bookings",
      emptyHint: "Any reservations you cancel will appear here.",
    },
  };

  return (
    <div className="mt-6">
      <div role="tablist" className="flex gap-1 border-b border-border-subtle">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => selectTab(t.key)}
            className={cn(
              "focus-ring -mb-px flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors",
              tab === t.key
                ? "border-brand-700 text-brand-700"
                : "border-transparent text-stone-500 hover:text-foreground",
            )}
          >
            {t.label}
            <span
              className={cn(
                "rounded-full px-1.5 py-0.5 text-xs font-semibold",
                tab === t.key ? "bg-brand-50 text-brand-800" : "bg-surface-muted text-stone-500",
              )}
            >
              {counts[t.key]}
            </span>
          </button>
        ))}
      </div>

      <div className="mt-6" role="tabpanel">
        <TabSection
          bookings={sections[tab].bookings}
          page={pages[tab]}
          onPageChange={(page) => setPages((prev) => ({ ...prev, [tab]: page }))}
          emptyMessage={sections[tab].emptyMessage}
          emptyHint={sections[tab].emptyHint}
          showCta={sections[tab].showCta}
          airportTransferProviderName={airportTransferProviderName}
        />
      </div>
    </div>
  );
}
