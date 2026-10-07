import Link from "next/link";
import { ArrowDownRight, ArrowRight, ArrowUpRight, Minus, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * The small visual vocabulary every hosting page shares, so Today,
 * Bookings, Calendar, Earnings and Listings read as one product: a panel
 * with a quiet header, a meter, a change chip, a status pill and an empty
 * state. Calm by default - colour is reserved for state and the one number
 * each panel is about.
 */

export function Panel({
  title,
  icon: Icon,
  action,
  className,
  children,
  bodyClassName,
}: {
  title?: string;
  icon?: LucideIcon;
  action?: { href: string; label: string };
  className?: string;
  bodyClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={cn("min-w-0 rounded-2xl border border-border-subtle bg-surface shadow-[var(--shadow-card)]", className)}>
      {(title || action) && (
        <header className="flex items-center justify-between gap-3 px-5 pt-4 sm:px-6 sm:pt-5">
          {title && (
            <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              {Icon && <Icon className="h-4 w-4 text-stone-500" aria-hidden />}
              {title}
            </h2>
          )}
          {action && (
            <Link
              href={action.href}
              className="focus-ring group flex shrink-0 items-center gap-1 rounded-md text-sm font-medium text-brand-700 hover:text-brand-800"
            >
              {action.label}
              <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
            </Link>
          )}
        </header>
      )}
      <div className={cn("px-5 pb-5 pt-3 sm:px-6", bodyClassName)}>{children}</div>
    </section>
  );
}

/** A thin progress bar. `value` 0-100; the track is a lighter step of the same hue. */
export function Meter({
  value,
  label,
  tone = "brand",
  className,
}: {
  value: number;
  label: string;
  tone?: "brand" | "success" | "accent";
  className?: string;
}) {
  const clamped = Math.max(0, Math.min(100, value));
  const fill = { brand: "bg-brand-600", success: "bg-emerald-600", accent: "bg-accent-500" }[tone];
  const track = { brand: "bg-brand-100", success: "bg-emerald-100", accent: "bg-amber-100" }[tone];
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn("h-1.5 w-full overflow-hidden rounded-full", track, className)}
    >
      <div className={cn("h-full rounded-full", fill)} style={{ width: `${clamped}%` }} />
    </div>
  );
}

/** "↑ 18% vs September" - green up, neutral down (a quiet month isn't a failure). */
export function ChangeChip({
  change,
  comparedTo,
  positiveOnly = false,
}: {
  change: number | null;
  comparedTo: string;
  /** For a month still in progress, where a dip is just the month not being over yet. */
  positiveOnly?: boolean;
}) {
  if (change === null || (positiveOnly && change <= 0)) return null;
  const Icon = change > 0 ? ArrowUpRight : change < 0 ? ArrowDownRight : Minus;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-semibold",
        change > 0 ? "bg-emerald-50 text-emerald-800" : "bg-surface-muted text-stone-600",
      )}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {change > 0 ? "+" : ""}
      {change}% <span className="font-normal">vs {comparedTo}</span>
    </span>
  );
}

export type PillTone = "success" | "warning" | "danger" | "info" | "neutral" | "brand";

const PILL: Record<PillTone, string> = {
  success: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  warning: "bg-amber-50 text-amber-900 ring-amber-200",
  danger: "bg-red-50 text-red-800 ring-red-200",
  info: "bg-sky-50 text-sky-900 ring-sky-200",
  neutral: "bg-surface-muted text-stone-700 ring-border-subtle",
  brand: "bg-brand-50 text-brand-800 ring-brand-200",
};

export function Pill({ tone, children, className }: { tone: PillTone; children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
        PILL[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  children,
  className,
}: {
  icon: LucideIcon;
  title: string;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center px-4 py-8 text-center", className)}>
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-surface-muted text-stone-500">
        <Icon className="h-5 w-5" aria-hidden />
      </span>
      <p className="mt-3 text-sm font-semibold text-foreground">{title}</p>
      {children && <div className="mt-1 max-w-sm text-sm text-stone-500">{children}</div>}
    </div>
  );
}

/** Page title block shared by every hosting page. */
export function HostPageHeader({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="font-serif text-3xl leading-tight text-foreground sm:text-[2.1rem]">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-stone-600">{subtitle}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

/** A guest's initials in a soft circle - the host sees people, not rows. */
export function GuestAvatar({ name, className }: { name: string; className?: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
  return (
    <span
      aria-hidden
      className={cn(
        "flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-800",
        className,
      )}
    >
      {initials || "G"}
    </span>
  );
}

export function hostPageClassName() {
  return "animate-host-page-in mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-8";
}

/**
 * The full-width "nothing here yet" card for a whole page (a new host's
 * Bookings, Calendar, Earnings, Listings): says what will appear here, why
 * it's empty, and the one thing to do next - never a blank page or a grid
 * of zeros.
 */
export function HostPageEmpty({
  icon: Icon,
  title,
  children,
  action,
  secondary,
}: {
  icon: LucideIcon;
  title: string;
  children: React.ReactNode;
  action?: { href: string; label: string };
  secondary?: { href: string; label: string };
}) {
  return (
    <section className="mt-6 flex flex-col items-center rounded-2xl border border-border-subtle bg-surface px-6 py-12 text-center shadow-[var(--shadow-card)]">
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-700">
        <Icon className="h-6 w-6" aria-hidden />
      </span>
      <h2 className="mt-4 font-serif text-2xl text-foreground">{title}</h2>
      <div className="mt-2 max-w-md text-sm leading-relaxed text-stone-600">{children}</div>
      {(action || secondary) && (
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          {action && (
            <Link
              href={action.href}
              className="focus-ring inline-flex h-11 items-center rounded-xl bg-brand-600 px-5 text-sm font-semibold text-white hover:bg-brand-700"
            >
              {action.label}
            </Link>
          )}
          {secondary && (
            <Link
              href={secondary.href}
              className="focus-ring inline-flex h-11 items-center rounded-xl px-4 text-sm font-medium text-stone-700 ring-1 ring-border-subtle hover:bg-surface-muted"
            >
              {secondary.label}
            </Link>
          )}
        </div>
      )}
    </section>
  );
}

/** What a host with no listings, or no live ones, should do next - one step at a time. */
export function nextHostStep(input: { listingCount: number; payoutsReady: boolean }) {
  if (input.listingCount === 0) return { href: "/host/listings/new", label: "Create your first listing" };
  if (!input.payoutsReady) return { href: "/host/payouts", label: "Set up payouts" };
  return null;
}
