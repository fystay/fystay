/**
 * Whole pounds as "£75"; an amount with pence (a percentage discount, a
 * fee) in full as "£35.70" - never rounded, so a price on screen is always
 * exactly what's charged.
 */
export function formatPrice(cents: number): string {
  const digits = Math.round(cents) % 100 === 0 ? 0 : 2;
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(cents / 100);
}

/**
 * Formats an amount in whatever currency a hotel-affiliate provider quoted
 * it in - deliberately not routed through useFormattedPrice/formatPriceIn
 * (src/lib/currency.ts), which convert FYStay's own GBP-denominated prices
 * into a guest's browsing-currency preference using a static approximate
 * rate. A provider's quoted price is a real figure in a real currency, not
 * a GBP amount to re-convert - showing it as-is is the only accurate
 * option. Falls back to a plain "<code> <amount>" if the code isn't one
 * Intl recognizes (defensive only - every provider adapter's own currency
 * field is expected to already be a valid ISO 4217 code).
 */
export function formatProviderPrice(cents: number, currencyCode: string): string {
  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: currencyCode,
      maximumFractionDigits: 0,
    }).format(cents / 100);
  } catch {
    return `${currencyCode} ${(cents / 100).toFixed(0)}`;
  }
}

// Dates render identically on the server and in the browser - formatting
// with the runtime's own locale and timezone (toLocaleDateString()) gave a US
// server and a UK browser different text, which broke hydration and showed
// guests ambiguous dates like 01/10/2026.

/** Check-in/check-out dates are stored as UTC midnight, so they format in UTC. */
const stayDateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

export function formatStayDate(date: Date | string): string {
  return stayDateFormatter.format(new Date(date));
}

const ukDateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Europe/London",
});

/** A moment in time (a deadline, a creation date), shown as its UK date. */
export function formatDate(date: Date | string): string {
  return ukDateFormatter.format(new Date(date));
}

const ukDateTimeFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/London",
});

/** A moment in time with its UK clock time. */
export function formatDateTime(date: Date | string): string {
  return ukDateTimeFormatter.format(new Date(date));
}

const ukTimeFormatter = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/London",
});

/** A moment's UK clock time alone, e.g. "14:32" - for a deadline later today. */
export function formatUkTime(date: Date | string): string {
  return ukTimeFormatter.format(new Date(date));
}
