"use client";

import { AlertTriangle } from "lucide-react";
import { Field, FieldError, FieldHint, Label } from "@/components/ui/Label";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { formatPrice } from "@/lib/format";
import { MONTHLY_DISCOUNT_MIN_NIGHTS, WEEKLY_DISCOUNT_MIN_NIGHTS } from "@/lib/pricing";
import { LAST_MINUTE_MAX_PERCENT, LAST_MINUTE_MIN_PERCENT, LAST_MINUTE_WINDOW_OPTIONS } from "@/lib/deals";
import { discountExample, type DiscountExample } from "@/lib/listingFormOptions";

// Same bounds as the server (weekly/monthly in src/lib/listingInput.ts,
// last-minute in src/lib/dealValidation.ts).
const STAY_DISCOUNT_MAX_PERCENT = 90;
const EXAMPLE_PRICE_CENTS = 10_000;
const LAST_MINUTE_EXAMPLE_NIGHTS = 3;

export type ListingDiscountValues = {
  weeklyDiscountPercent: string;
  monthlyDiscountPercent: string;
  lastMinuteDiscountPercent: string;
  lastMinuteWindowDays: string;
};

type Props = ListingDiscountValues & {
  pricePerNight: string;
  weekendPricePerNight: string;
  isHotel: boolean;
  onChange: (key: keyof ListingDiscountValues, value: string) => void;
};

/** A typed percentage as a number, or null when blank or not a whole number. */
function percent(value: string): number | null {
  if (!value.trim()) return null;
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
}

function boundsError(value: string, min: number, max: number): string | null {
  if (!value.trim()) return null;
  const n = Number(value);
  if (!Number.isInteger(n)) return "Use a whole number.";
  if (n < min || n > max) return `Choose between ${min}% and ${max}%.`;
  return null;
}

function ExampleLine({ label, example }: { label: string; example: DiscountExample }) {
  const perNight = Math.round(example.totalCents / example.nights);
  return (
    <p className="mt-1.5 rounded-lg bg-surface-muted px-3 py-2 text-xs text-stone-700">
      {label}:{" "}
      {example.appliedName ? (
        <>
          <span className="line-through">{formatPrice(example.beforeCents)}</span>{" "}
          <span className="font-semibold">{formatPrice(example.totalCents)}</span> with the{" "}
          {example.appliedName.toLowerCase()} ({example.appliedPercent}% off) - about {formatPrice(perNight)} a night.
        </>
      ) : (
        <>{formatPrice(example.totalCents)}, no discount.</>
      )}
    </p>
  );
}

/**
 * The host's weekly, monthly and last-minute discounts, each with when it
 * applies and a live example priced by the booking engine itself (see
 * discountExample) so what the host sees here is what a guest is charged.
 */
export function ListingDiscounts({
  weeklyDiscountPercent,
  monthlyDiscountPercent,
  lastMinuteDiscountPercent,
  lastMinuteWindowDays,
  pricePerNight,
  weekendPricePerNight,
  isHotel,
  onChange,
}: Props) {
  const typedPriceCents = Math.round(Number(pricePerNight) * 100);
  const usingOwnPrice = !isHotel && Number.isFinite(typedPriceCents) && typedPriceCents > 0;
  const priceCents = usingOwnPrice ? typedPriceCents : EXAMPLE_PRICE_CENTS;
  const weekendCents =
    usingOwnPrice && weekendPricePerNight.trim() ? Math.round(Number(weekendPricePerNight) * 100) : null;

  const weekly = percent(weeklyDiscountPercent);
  const monthly = percent(monthlyDiscountPercent);
  const lastMinute = percent(lastMinuteDiscountPercent);
  const windowDays = lastMinuteWindowDays || String(LAST_MINUTE_WINDOW_OPTIONS[1]);

  const weeklyError = boundsError(weeklyDiscountPercent, 0, STAY_DISCOUNT_MAX_PERCENT);
  const monthlyError = boundsError(monthlyDiscountPercent, 0, STAY_DISCOUNT_MAX_PERCENT);
  const lastMinuteError = boundsError(lastMinuteDiscountPercent, LAST_MINUTE_MIN_PERCENT, LAST_MINUTE_MAX_PERCENT);

  const example = (nights: number, lastMinutePercent: number | null = null) =>
    discountExample({
      nights,
      pricePerNightCents: priceCents,
      weekendPricePerNightCents: weekendCents,
      weeklyDiscountPercent: weekly,
      monthlyDiscountPercent: monthly,
      lastMinuteDiscountPercent: lastMinutePercent,
    });

  // The engine gives a 28+ night stay the monthly rate whenever one is set,
  // even a smaller one - worth flagging, never blocking.
  const monthlyBelowWeekly = weekly !== null && monthly !== null && monthly > 0 && monthly < weekly;

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-stone-600">
        Guests get <strong>one discount per stay, never two</strong>. A stay of {MONTHLY_DISCOUNT_MIN_NIGHTS}+ nights
        gets your monthly discount instead of your weekly one (or the weekly one if you haven&apos;t set a monthly
        discount). A last-minute deal replaces either only when it&apos;s the bigger saving.
        {!usingOwnPrice && (
          <>
            {" "}
            Examples below use {formatPrice(EXAMPLE_PRICE_CENTS)} a night
            {isHotel ? " - each room type's own price applies." : " until you set your price."}
          </>
        )}
      </p>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Field>
          <Label htmlFor="weeklyDiscountPercent">Weekly discount (optional)</Label>
          <div className="relative">
            <Input
              id="weeklyDiscountPercent"
              type="number"
              inputMode="numeric"
              min={0}
              max={STAY_DISCOUNT_MAX_PERCENT}
              step={1}
              className="pr-9"
              value={weeklyDiscountPercent}
              invalid={Boolean(weeklyError)}
              onChange={(e) => onChange("weeklyDiscountPercent", e.target.value)}
              placeholder="e.g. 10"
              aria-describedby="weeklyDiscountPercent-hint"
            />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-stone-500">%</span>
          </div>
          <FieldError>{weeklyError}</FieldError>
          <p id="weeklyDiscountPercent-hint" className="mt-1.5 text-xs text-stone-500">
            Off every night of a stay of {WEEKLY_DISCOUNT_MIN_NIGHTS}+ nights.
          </p>
          {weekly !== null && weekly > 0 && !weeklyError && (
            <ExampleLine label={`${WEEKLY_DISCOUNT_MIN_NIGHTS} nights`} example={example(WEEKLY_DISCOUNT_MIN_NIGHTS)} />
          )}
        </Field>

        <Field>
          <Label htmlFor="monthlyDiscountPercent">Monthly discount (optional)</Label>
          <div className="relative">
            <Input
              id="monthlyDiscountPercent"
              type="number"
              inputMode="numeric"
              min={0}
              max={STAY_DISCOUNT_MAX_PERCENT}
              step={1}
              className="pr-9"
              value={monthlyDiscountPercent}
              invalid={Boolean(monthlyError)}
              onChange={(e) => onChange("monthlyDiscountPercent", e.target.value)}
              placeholder="e.g. 20"
              aria-describedby="monthlyDiscountPercent-hint"
            />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-stone-500">%</span>
          </div>
          <FieldError>{monthlyError}</FieldError>
          <p id="monthlyDiscountPercent-hint" className="mt-1.5 text-xs text-stone-500">
            Off every night of a stay of {MONTHLY_DISCOUNT_MIN_NIGHTS}+ nights, instead of the weekly discount.
          </p>
          {((monthly !== null && monthly > 0) || (weekly !== null && weekly > 0)) && !monthlyError && !weeklyError && (
            <ExampleLine label={`${MONTHLY_DISCOUNT_MIN_NIGHTS} nights`} example={example(MONTHLY_DISCOUNT_MIN_NIGHTS)} />
          )}
          {monthlyBelowWeekly && (
            <p className="mt-1.5 flex items-start gap-2 text-xs text-amber-700">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              Your monthly discount is smaller than your weekly one, so a {MONTHLY_DISCOUNT_MIN_NIGHTS}-night stay gets
              less off than a {WEEKLY_DISCOUNT_MIN_NIGHTS}-night stay.
            </p>
          )}
        </Field>

        <Field>
          <Label htmlFor="lastMinuteDiscountPercent">Last-minute deal (optional)</Label>
          <div className="relative">
            <Input
              id="lastMinuteDiscountPercent"
              type="number"
              inputMode="numeric"
              min={LAST_MINUTE_MIN_PERCENT}
              max={LAST_MINUTE_MAX_PERCENT}
              step={1}
              className="pr-9"
              value={lastMinuteDiscountPercent}
              invalid={Boolean(lastMinuteError)}
              onChange={(e) => onChange("lastMinuteDiscountPercent", e.target.value)}
              placeholder="e.g. 15"
              aria-describedby="lastMinuteDiscountPercent-hint"
            />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-stone-500">%</span>
          </div>
          <FieldError>{lastMinuteError}</FieldError>
          <p id="lastMinuteDiscountPercent-hint" className="mt-1.5 text-xs text-stone-500">
            {LAST_MINUTE_MIN_PERCENT}-{LAST_MINUTE_MAX_PERCENT}% off any stay that checks in within {windowDays} days of
            booking. Featured in Last Minute Deals on the homepage.
          </p>
          {lastMinute !== null && lastMinute > 0 && !lastMinuteError && (
            <>
              <ExampleLine
                label={`${LAST_MINUTE_EXAMPLE_NIGHTS} weeknights starting soon`}
                example={discountExample({
                  nights: LAST_MINUTE_EXAMPLE_NIGHTS,
                  pricePerNightCents: priceCents,
                  weekendPricePerNightCents: null,
                  weeklyDiscountPercent: weekly,
                  monthlyDiscountPercent: monthly,
                  lastMinuteDiscountPercent: lastMinute,
                })}
              />
              {weekly !== null && weekly > 0 && !weeklyError && (
                <ExampleLine
                  label={`${WEEKLY_DISCOUNT_MIN_NIGHTS} nights starting soon`}
                  example={example(WEEKLY_DISCOUNT_MIN_NIGHTS, lastMinute)}
                />
              )}
            </>
          )}
        </Field>

        <Field>
          <Label htmlFor="lastMinuteWindowDays">Counts as last-minute when check-in is within</Label>
          <Select
            id="lastMinuteWindowDays"
            value={windowDays}
            onChange={(e) => onChange("lastMinuteWindowDays", e.target.value)}
            disabled={!lastMinuteDiscountPercent}
          >
            {LAST_MINUTE_WINDOW_OPTIONS.map((days) => (
              <option key={days} value={days}>
                {days} days
              </option>
            ))}
          </Select>
          {!lastMinuteDiscountPercent && <FieldHint>Set a last-minute percentage to choose this.</FieldHint>}
        </Field>
      </div>
    </div>
  );
}
