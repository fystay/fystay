import { z } from "zod";
import { LAST_MINUTE_MAX_PERCENT, LAST_MINUTE_MIN_PERCENT, LAST_MINUTE_WINDOW_OPTIONS } from "@/lib/deals";

/** The last-minute deal fields a host can send when creating or editing a listing. */
export const lastMinuteDealInput = {
  lastMinuteDiscountPercent: z
    .number()
    .int()
    .min(LAST_MINUTE_MIN_PERCENT, `A last-minute deal needs to be at least ${LAST_MINUTE_MIN_PERCENT}% off`)
    .max(LAST_MINUTE_MAX_PERCENT, `A last-minute deal can be at most ${LAST_MINUTE_MAX_PERCENT}% off`)
    .nullable()
    .optional(),
  lastMinuteWindowDays: z
    .number()
    .int()
    .refine((days) => (LAST_MINUTE_WINDOW_OPTIONS as readonly number[]).includes(days), {
      message: `Choose ${LAST_MINUTE_WINDOW_OPTIONS.join(", ")} days for a last-minute deal`,
    })
    .nullable()
    .optional(),
};

type DealFields = { lastMinuteDiscountPercent?: number | null; lastMinuteWindowDays?: number | null };

/**
 * Resolves what a create/edit request does to the listing's last-minute deal
 * against what's saved (`existing`, absent for a new listing): removing the
 * percentage removes the whole deal, and a deal can't end up with a
 * percentage but no window. Returns the fields to save (spread after the
 * request's own fields, so they win), or an error.
 */
export function resolveLastMinuteDeal(
  input: DealFields,
  existing?: { lastMinuteDiscountPercent: number | null; lastMinuteWindowDays: number | null },
): { fields: DealFields } | { error: string } {
  if (input.lastMinuteDiscountPercent === undefined && input.lastMinuteWindowDays === undefined) {
    return { fields: {} };
  }
  if (input.lastMinuteDiscountPercent === null) {
    return { fields: { lastMinuteDiscountPercent: null, lastMinuteWindowDays: null } };
  }
  const percent = input.lastMinuteDiscountPercent ?? existing?.lastMinuteDiscountPercent ?? null;
  const windowDays =
    input.lastMinuteWindowDays !== undefined ? input.lastMinuteWindowDays : (existing?.lastMinuteWindowDays ?? null);
  if (percent === null) {
    // Only a window was sent, with no deal to attach it to - leave it unset.
    return { fields: { lastMinuteWindowDays: null } };
  }
  if (windowDays === null) {
    return { error: "Choose how close to check-in the last-minute deal applies" };
  }
  return { fields: { lastMinuteDiscountPercent: percent, lastMinuteWindowDays: windowDays } };
}
