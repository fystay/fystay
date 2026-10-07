import { Skeleton } from "@/components/ui/Skeleton";
import { cn } from "@/lib/cn";

/**
 * Loading shells for the hosting pages, shaped like the real page so
 * nothing jumps when the data arrives. Shown by each route's loading.tsx
 * the instant a tab is tapped (Next prefetches up to this boundary), so the
 * host always sees the page start to appear rather than a frozen screen.
 */

// At least a screen tall, so the footer stays below the fold until the real
// page (almost always taller) replaces this - otherwise it would jump down
// the screen as the content arrives.
const shell = "mx-auto min-h-screen w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-8";

function Card({ className, children }: { className?: string; children?: React.ReactNode }) {
  return (
    <div className={cn("rounded-2xl border border-border-subtle bg-surface p-5 shadow-[var(--shadow-card)]", className)}>
      {children}
    </div>
  );
}

function Header({ actions = 0 }: { actions?: number }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <Skeleton className="h-9 w-52" />
        <Skeleton className="mt-2 h-4 w-64" />
      </div>
      {actions > 0 && (
        <div className="flex gap-2">
          {Array.from({ length: actions }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-10 rounded-xl" />
          ))}
        </div>
      )}
    </div>
  );
}

function Pills({ count }: { count: number }) {
  return (
    <div className="mt-5 flex gap-1 overflow-hidden">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="h-8 w-24 shrink-0 rounded-full" />
      ))}
    </div>
  );
}

/** Screen-reader announcement shared by every shell. */
function Busy({ label }: { label: string }) {
  return (
    <span role="status" className="sr-only">
      Loading {label}…
    </span>
  );
}

export function TodaySkeleton() {
  return (
    <div className={shell}>
      <Busy label="your day" />
      <Header />
      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <Skeleton className="h-4 w-36" />
          <Skeleton className="mt-4 h-12 w-48" />
          <Skeleton className="mt-3 h-4 w-72" />
          <Skeleton className="mt-6 h-14 w-full" />
        </Card>
        <Card>
          <Skeleton className="h-4 w-40" />
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="mt-4 flex gap-3">
              <Skeleton className="mt-1 h-2 w-2 rounded-full" />
              <div className="flex-1">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="mt-1.5 h-3 w-1/2" />
              </div>
            </div>
          ))}
        </Card>
      </div>
      <Card className="mt-4">
        <Skeleton className="h-4 w-20" />
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="h-9 w-9 rounded-full" />
              <div className="flex-1">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="mt-1.5 h-3 w-1/2" />
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

export function BookingsSkeleton() {
  return (
    <div className={shell}>
      <Busy label="your bookings" />
      <Header />
      <Pills count={5} />
      <Skeleton className="mt-4 h-10 w-full rounded-xl" />
      <Skeleton className="mt-6 h-3 w-28" />
      <div className="mt-2 grid gap-2 md:grid-cols-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 rounded-2xl border border-border-subtle bg-surface p-3">
            <Skeleton className="h-14 w-14 rounded-xl" />
            <div className="flex-1">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="mt-1.5 h-3 w-2/3" />
              <Skeleton className="mt-1.5 h-3 w-1/2" />
            </div>
            <Skeleton className="h-5 w-12" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function BookingDetailSkeleton() {
  return (
    <div className="mx-auto min-h-screen w-full max-w-4xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
      <Busy label="this booking" />
      <Skeleton className="h-4 w-20" />
      <div className="mt-3 flex items-center gap-3">
        <Skeleton className="h-12 w-12 rounded-full" />
        <div className="flex-1">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="mt-2 h-4 w-64" />
        </div>
      </div>
      <div className="mt-5 grid gap-4 md:grid-cols-5">
        <div className="flex flex-col gap-4 md:col-span-3">
          <Card>
            <Skeleton className="h-4 w-16" />
            <Skeleton className="mt-4 h-20 w-full" />
          </Card>
          <Card>
            <Skeleton className="h-4 w-16" />
            <Skeleton className="mt-4 h-4 w-1/2" />
            <Skeleton className="mt-4 h-9 w-36 rounded-xl" />
          </Card>
        </div>
        <div className="flex flex-col gap-4 md:col-span-2">
          <Card>
            <Skeleton className="h-4 w-28" />
            <Skeleton className="mt-4 h-9 w-28" />
            <Skeleton className="mt-4 h-24 w-full" />
          </Card>
        </div>
      </div>
    </div>
  );
}

export function EarningsSkeleton() {
  return (
    <div className={shell}>
      <Busy label="your earnings" />
      <Header />
      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i} className="p-4">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="mt-2 h-7 w-24" />
            <Skeleton className="mt-2 h-3 w-36" />
          </Card>
        ))}
      </div>
      <Pills count={6} />
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <Skeleton className="h-4 w-36" />
          <Skeleton className="mt-4 h-12 w-48" />
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-14 rounded-xl" />
            ))}
          </div>
        </Card>
        <Card>
          <Skeleton className="h-4 w-36" />
          <Skeleton className="mt-4 h-28 w-full" />
        </Card>
      </div>
      <Card className="mt-4">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="mt-4 h-44 w-full" />
      </Card>
    </div>
  );
}

export function CalendarSkeleton() {
  return (
    <div className={shell}>
      <Busy label="your calendar" />
      <Header actions={3} />
      <Skeleton className="mt-5 h-4 w-96 max-w-full" />
      <Card className="mt-3 p-0">
        <Skeleton className="h-14 w-full rounded-b-none rounded-t-2xl" />
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 border-t border-border-subtle px-3 py-3">
            <Skeleton className="h-8 w-36 shrink-0" />
            <Skeleton className="h-7 flex-1" style={{ maxWidth: `${30 + ((i * 17) % 50)}%` }} />
          </div>
        ))}
      </Card>
    </div>
  );
}

export function ListingsSkeleton() {
  return (
    <div className={shell}>
      <Busy label="your listings" />
      <Header actions={1} />
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="p-4">
            <div className="flex gap-4">
              <Skeleton className="h-24 w-28 rounded-xl" />
              <div className="flex-1">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="mt-1.5 h-3 w-1/2" />
                <Skeleton className="mt-4 h-8 w-2/3" />
              </div>
            </div>
            <Skeleton className="mt-4 h-3 w-full" />
            <Skeleton className="mt-4 h-8 w-full" />
          </Card>
        ))}
      </div>
    </div>
  );
}

/** Spotlight, Channels and other simple hosting pages. */
export function SimpleHostSkeleton({ label }: { label: string }) {
  return (
    <div className={shell}>
      <Busy label={label} />
      <Header />
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <Card key={i}>
            <Skeleton className="h-4 w-40" />
            <Skeleton className="mt-4 h-20 w-full" />
          </Card>
        ))}
      </div>
    </div>
  );
}
