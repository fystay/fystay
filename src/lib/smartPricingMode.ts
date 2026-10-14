/**
 * The server-side switch for smart pricing (SMART_PRICING_MODE). Never a
 * NEXT_PUBLIC_ variable: the browser can't turn it on. Anything other than
 * "shadow" or "on" - including unset - is "off", so a typo fails safe.
 *
 * - off: every listing is priced at its host's own rates (the fixed 10%).
 * - shadow: the same prices are charged; smart prices are calculated and
 *   recorded alongside, for comparison.
 * - on: hosts who opted in get smart prices (or suggestions, if they want to
 *   approve changes).
 *
 * Rolling back is setting it to off: confirmed bookings keep the amounts
 * stored on them either way.
 */
export type SmartPricingMode = "off" | "shadow" | "on";

export function smartPricingMode(env: Readonly<Record<string, string | undefined>> = process.env): SmartPricingMode {
  const value = env.SMART_PRICING_MODE?.trim().toLowerCase();
  return value === "on" || value === "shadow" ? value : "off";
}
