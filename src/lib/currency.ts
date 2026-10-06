import { formatPrice } from "@/lib/format";

export type CurrencyCode = "GBP" | "USD" | "EUR";

type CurrencyDef = {
  code: CurrencyCode;
  label: string;
  /** Locale used purely for symbol placement/formatting conventions - not
   * tied to any particular country of residence. */
  locale: string;
  /** Units of this currency per GBP - a static, hand-refreshed snapshot,
   * not a live exchange rate. This is a browsing convenience only: every
   * real charge (Stripe checkout, refunds, host payouts, receipts) is
   * always computed and shown in GBP, the currency FYStay actually
   * transacts in, regardless of what a guest has this set to. A live-rate
   * API was deliberately skipped here - the small risk of it being wrong,
   * slow, or unreachable isn't worth it for a number that's never used to
   * actually charge anyone. */
  perGBP: number;
};

export const SUPPORTED_CURRENCIES: CurrencyDef[] = [
  { code: "GBP", label: "British Pound", locale: "en-GB", perGBP: 1 },
  { code: "USD", label: "US Dollar", locale: "en-US", perGBP: 1.27 },
  { code: "EUR", label: "Euro", locale: "en-IE", perGBP: 1.17 },
];

export function isCurrencyCode(value: string): value is CurrencyCode {
  return SUPPORTED_CURRENCIES.some((c) => c.code === value);
}

function currencyDef(code: CurrencyCode): CurrencyDef {
  return SUPPORTED_CURRENCIES.find((c) => c.code === code) ?? SUPPORTED_CURRENCIES[0];
}

/** Formats a GBP amount (in pence) as an approximate price in the given
 * display currency - see the perGBP doc comment above on why this is never
 * the amount actually charged. */
export function formatPriceIn(gbpCents: number, currency: CurrencyCode): string {
  // GBP is the real price: shown exactly, pence and all when there are any
  // (see formatPrice). A converted price is only approximate, so it's
  // rounded to whole units rather than implying a precision it doesn't have.
  if (currency === "GBP") return formatPrice(gbpCents);
  const def = currencyDef(currency);
  const convertedAmount = (gbpCents / 100) * def.perGBP;
  return new Intl.NumberFormat(def.locale, {
    style: "currency",
    currency: def.code,
    maximumFractionDigits: 0,
  }).format(convertedAmount);
}
