import Link from "next/link";
import {
  ArrowRight,
  BedDouble,
  CalendarClock,
  CheckCircle2,
  CircleAlert,
  Info,
  LogIn,
  LogOut,
  Star,
  TrendingUp,
  Trophy,
  type LucideIcon,
} from "lucide-react";
import { formatPrice } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { ActionItem } from "@/lib/hostAttention";
import type { Highlight } from "@/lib/hostInsights";
import { EmptyState, GuestAvatar, Meter, Panel } from "@/components/host/HostUi";

const shortDay = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

export type StayCard = {
  id: string;
  guestName: string;
  guests: number;
  nights: number;
  listingTitle: string;
  checkIn: Date;
  checkOut: Date;
  earningsCents: number;
};

// --- Needs your attention ---------------------------------------------------

const TONE: Record<ActionItem["tone"], { icon: LucideIcon; dot: string; label: string }> = {
  urgent: { icon: CircleAlert, dot: "bg-red-500", label: "Needs a reply" },
  attention: { icon: CalendarClock, dot: "bg-amber-500", label: "To do" },
  info: { icon: Info, dot: "bg-sky-500", label: "Suggestion" },
};

export function ActionCentre({ items, className }: { items: ActionItem[]; className?: string }) {
  return (
    <Panel title="Needs your attention" className={className} bodyClassName="px-2 pb-2 pt-2 sm:px-3">
      {items.length === 0 ? (
        <EmptyState icon={CheckCircle2} title="You're all caught up">
          Nothing is waiting on you. New requests and messages will show up here.
        </EmptyState>
      ) : (
        <ul className="flex flex-col">
          {items.map((item) => {
            const tone = TONE[item.tone];
            return (
              <li key={item.key}>
                <Link
                  href={item.href}
                  className="focus-ring group flex items-start gap-3 rounded-xl px-3 py-2.5 hover:bg-surface-muted/60"
                >
                  <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", tone.dot)} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="sr-only">{tone.label}: </span>
                    <span className="block text-sm font-medium text-foreground">{item.title}</span>
                    <span className="block text-xs text-stone-500">{item.detail}</span>
                  </span>
                  <span className="mt-0.5 flex shrink-0 items-center gap-0.5 text-xs font-semibold text-brand-700 group-hover:text-brand-800">
                    {item.cta}
                    <ArrowRight className="h-3 w-3" aria-hidden />
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

// --- Today --------------------------------------------------------------------

function StayLine({ stay, meta }: { stay: StayCard; meta: string }) {
  return (
    <li>
      <Link
        href={`/host/bookings/${stay.id}`}
        className="focus-ring flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-surface-muted/60"
      >
        <GuestAvatar name={stay.guestName} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-foreground">{stay.guestName}</span>
          <span className="block truncate text-xs text-stone-500">
            {stay.listingTitle} · {meta}
          </span>
        </span>
      </Link>
    </li>
  );
}

function TodayColumn({
  icon: Icon,
  title,
  stays,
  empty,
  meta,
}: {
  icon: LucideIcon;
  title: string;
  stays: StayCard[];
  empty: string;
  meta: (s: StayCard) => string;
}) {
  return (
    <div className="min-w-0">
      <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-stone-500">
        <Icon className="h-3.5 w-3.5" aria-hidden />
        {title}
        <span className="ml-auto rounded-full bg-surface-muted px-1.5 text-[11px] font-semibold text-stone-600">
          {stays.length}
        </span>
      </h3>
      {stays.length === 0 ? (
        <p className="mt-2 px-2 py-2 text-sm text-stone-500">{empty}</p>
      ) : (
        <ul className="mt-1 flex flex-col">
          {stays.map((s) => (
            <StayLine key={s.id} stay={s} meta={meta(s)} />
          ))}
        </ul>
      )}
    </div>
  );
}

export function TodayPanel({
  arrivals,
  departures,
  inHouse,
  occupiedTonight,
  bookableListings,
  nextArrival,
}: {
  arrivals: StayCard[];
  departures: StayCard[];
  inHouse: StayCard[];
  occupiedTonight: number;
  bookableListings: number;
  nextArrival: StayCard | null;
}) {
  const quiet = arrivals.length === 0 && departures.length === 0 && inHouse.length === 0;
  return (
    <Panel title="Today" icon={CalendarClock} action={{ href: "/host/calendar", label: "Calendar" }}>
      {bookableListings > 0 && (
        <div className="mb-4 flex items-center gap-3">
          <Meter
            value={(occupiedTonight / bookableListings) * 100}
            label="Homes occupied tonight"
            className="max-w-48"
          />
          <p className="text-sm text-stone-600">
            <span className="font-semibold text-foreground">
              {occupiedTonight} of {bookableListings}
            </span>{" "}
            {bookableListings === 1 ? "home" : "homes"} occupied tonight
          </p>
        </div>
      )}
      {quiet ? (
        <EmptyState icon={BedDouble} title="A quiet day - no check-ins or check-outs" className="py-4">
          {nextArrival
            ? `Next arrival: ${nextArrival.guestName} at ${nextArrival.listingTitle}, ${shortDay.format(nextArrival.checkIn)}.`
            : "No upcoming stays yet."}
        </EmptyState>
      ) : (
        <div className="grid gap-4 sm:grid-cols-3">
          <TodayColumn
            icon={LogIn}
            title="Arriving"
            stays={arrivals}
            empty="No check-ins"
            meta={(s) => `${s.guests} guest${s.guests === 1 ? "" : "s"}, ${s.nights} night${s.nights === 1 ? "" : "s"}`}
          />
          <TodayColumn
            icon={LogOut}
            title="Leaving"
            stays={departures}
            empty="No check-outs"
            meta={() => "checking out"}
          />
          <TodayColumn
            icon={BedDouble}
            title="Staying"
            stays={inHouse.filter((s) => !arrivals.some((a) => a.id === s.id))}
            empty="Nobody mid-stay"
            meta={(s) => `until ${shortDay.format(s.checkOut)}`}
          />
        </div>
      )}
    </Panel>
  );
}

// --- Coming up --------------------------------------------------------------

export function ComingUp({ stays, className }: { stays: StayCard[]; className?: string }) {
  return (
    <Panel
      title="Coming up"
      icon={CalendarClock}
      action={{ href: "/host/bookings", label: "All bookings" }}
      className={className}
    >
      {stays.length === 0 ? (
        <EmptyState icon={CalendarClock} title="Nothing booked for the next two weeks" className="py-4">
          A weekly discount or a Spotlight placement can help fill gaps.
        </EmptyState>
      ) : (
        <ol className="flex flex-col divide-y divide-border-subtle">
          {stays.map((s) => (
            <li key={s.id}>
              <Link
                href={`/host/bookings/${s.id}`}
                className="focus-ring -mx-2 flex items-center gap-3 rounded-xl px-2 py-2.5 hover:bg-surface-muted/60"
              >
                <span className="flex w-12 shrink-0 flex-col items-center rounded-lg bg-surface-muted py-1 text-center">
                  <span className="text-[10px] font-semibold uppercase text-stone-500">
                    {shortDay.format(s.checkIn).split(" ")[0]}
                  </span>
                  <span className="text-lg font-semibold leading-none text-foreground">{s.checkIn.getUTCDate()}</span>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-foreground">{s.guestName}</span>
                  <span className="block truncate text-xs text-stone-500">
                    {s.listingTitle} · {s.nights} night{s.nights === 1 ? "" : "s"} · {s.guests} guest
                    {s.guests === 1 ? "" : "s"}
                  </span>
                </span>
                <span className="shrink-0 text-sm font-semibold text-foreground">{formatPrice(s.earningsCents)}</span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

// --- Highlights & standing ---------------------------------------------------

const HIGHLIGHT_ICON: Record<Highlight["kind"], LucideIcon> = {
  milestone: Trophy,
  trend: TrendingUp,
  streak: Star,
  nudge: CalendarClock,
};

export function Highlights({ items }: { items: Highlight[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="flex flex-col gap-2">
      {items.map((h) => {
        const Icon = HIGHLIGHT_ICON[h.kind];
        return (
          <li key={h.text} className="flex items-center gap-2.5 text-sm text-stone-700">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-50 text-accent-600">
              <Icon className="h-3.5 w-3.5" aria-hidden />
            </span>
            {h.text}
          </li>
        );
      })}
    </ul>
  );
}

export type StandingCriterion = { label: string; current: string; target: string; progress: number; met: boolean };

/**
 * Great Host progress (hostStats.ts thresholds): each bar is a real
 * threshold with the host's real figure - something to work towards, with
 * no points, levels or streak counters.
 */
export function GreatHostProgress({ criteria, achieved }: { criteria: StandingCriterion[]; achieved: boolean }) {
  return (
    <div>
      <p className="text-sm text-stone-600">
        {achieved ? (
          <>
            <span className="font-semibold text-foreground">You&apos;re a Great Host.</span> Guests see the badge on your
            listings.
          </>
        ) : (
          <>
            Meet all three to earn the <span className="font-semibold text-foreground">Great Host</span> badge on your
            listings.
          </>
        )}
      </p>
      <ul className="mt-3 flex flex-col gap-3">
        {criteria.map((c) => (
          <li key={c.label}>
            <div className="flex items-baseline justify-between gap-2 text-xs">
              <span className="font-medium text-stone-700">
                {c.met && <CheckCircle2 className="mr-1 inline h-3.5 w-3.5 text-emerald-600" aria-hidden />}
                {c.label}
              </span>
              <span className="tabular-nums text-stone-500">
                <span className="font-semibold text-foreground">{c.current}</span> / {c.target}
              </span>
            </div>
            <Meter value={c.progress} label={c.label} tone={c.met ? "success" : "brand"} className="mt-1.5" />
          </li>
        ))}
      </ul>
    </div>
  );
}

// --- Month at a glance -----------------------------------------------------------

export function GlanceTile({
  label,
  value,
  context,
  meter,
}: {
  label: string;
  value: string;
  context: string;
  meter?: number | null;
}) {
  return (
    <div className="min-w-0 rounded-2xl border border-border-subtle bg-surface p-4 shadow-[var(--shadow-card)]">
      <p className="text-xs font-medium text-stone-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight text-foreground">{value}</p>
      {meter !== undefined && meter !== null && <Meter value={meter} label={label} className="mt-2" />}
      <p className="mt-1.5 text-xs text-stone-500">{context}</p>
    </div>
  );
}

// --- Before the first booking --------------------------------------------------

export type ReadyStep = { key: string; label: string; detail: string; done: boolean; href: string; cta: string; optional?: boolean };

/**
 * A new host's Today page: instead of empty charts and £0 tiles, the few
 * things that get a first booking, ticked off from real account data, and
 * one clear next step. Shown until the first booking arrives.
 */
export function FirstGuestChecklist({
  title,
  intro,
  steps,
  className,
}: {
  title: string;
  intro: string;
  steps: ReadyStep[];
  className?: string;
}) {
  const required = steps.filter((s) => !s.optional);
  const done = required.filter((s) => s.done).length;
  const next = steps.find((s) => !s.done && !s.optional) ?? steps.find((s) => !s.done);
  return (
    <Panel className={className} bodyClassName="px-5 pb-5 pt-5 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-serif text-2xl text-foreground">{title}</h2>
          <p className="mt-1 max-w-xl text-sm text-stone-600">{intro}</p>
        </div>
        <span className="rounded-full bg-surface-muted px-2.5 py-1 text-xs font-semibold text-stone-700">
          {done} of {required.length} done
        </span>
      </div>
      <Meter value={(done / Math.max(1, required.length)) * 100} label="Getting ready" tone="success" className="mt-4" />
      <ol className="mt-4 flex flex-col divide-y divide-border-subtle">
        {steps.map((step, i) => {
          const isNext = step === next;
          return (
            <li key={step.key} className="flex items-center gap-3 py-3">
              {step.done ? (
                <CheckCircle2 className="h-6 w-6 shrink-0 text-emerald-600" aria-hidden />
              ) : (
                <span
                  aria-hidden
                  className={cn(
                    "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                    isNext ? "bg-brand-600 text-white" : "bg-surface-muted text-stone-600",
                  )}
                >
                  {i + 1}
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className={cn("block text-sm font-medium", step.done ? "text-stone-500" : "text-foreground")}>
                  {step.label}
                  {step.optional && <span className="ml-1 text-xs font-normal text-stone-500">(optional)</span>}
                  {step.done && <span className="sr-only"> - done</span>}
                </span>
                {!step.done && <span className="block text-xs text-stone-500">{step.detail}</span>}
              </span>
              {!step.done && (
                <Link
                  href={step.href}
                  className={cn(
                    "focus-ring shrink-0 rounded-xl px-3.5 py-2 text-sm font-semibold",
                    isNext ? "bg-brand-600 text-white hover:bg-brand-700" : "text-brand-700 ring-1 ring-border-subtle hover:bg-surface-muted",
                  )}
                >
                  {step.cta}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </Panel>
  );
}
