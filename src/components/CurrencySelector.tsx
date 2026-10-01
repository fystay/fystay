"use client";

import { useCurrency } from "@/components/CurrencyProvider";
import { SUPPORTED_CURRENCIES, isCurrencyCode } from "@/lib/currency";
import { Select } from "@/components/ui/Select";

/** "£", "$", "€" - the symbol each currency is shown with in its own locale. */
function currencySymbol(code: string, locale: string): string {
  return (
    new Intl.NumberFormat(locale, { style: "currency", currency: code })
      .formatToParts(0)
      .find((part) => part.type === "currency")?.value ?? code
  );
}

export function CurrencySelector() {
  const { currency, setCurrency } = useCurrency();

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor="display-currency" className="text-sm font-semibold text-foreground">
        Display currency
      </label>
      {/* w-fit: the box sizes to its text, so the arrow sits just inside
          it rather than stranded at the far edge of the footer column. */}
      <div className="w-fit">
        <Select
          id="display-currency"
          value={currency}
          onChange={(e) => {
            if (isCurrencyCode(e.target.value)) setCurrency(e.target.value);
          }}
        >
          {SUPPORTED_CURRENCIES.map((c) => (
            <option key={c.code} value={c.code}>
              {currencySymbol(c.code, c.locale)} {c.code} · {c.label}
            </option>
          ))}
        </Select>
      </div>
      <p className="max-w-[16rem] text-xs text-stone-500">
        Approximate, for browsing only - you always pay in GBP.
      </p>
    </div>
  );
}
