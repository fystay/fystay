// Check-in, checkout and quiet-hours times. The columns are free text (see
// the comment on Listing.checkInTime in prisma/schema.prisma) and older
// listings hold whatever the host typed ("After 3pm", "Flexible"). The host
// form now saves a 24-hour "HH:MM" from a native time picker; anything else
// already saved is kept exactly as it is until the host picks a new time.

export const DEFAULT_CHECK_IN_TIME = "15:00";
export const DEFAULT_CHECK_OUT_TIME = "11:00";

export const LISTING_TIME_FIELDS = ["checkInTime", "checkOutTime", "quietHoursStart", "quietHoursEnd"] as const;
export type ListingTimeField = (typeof LISTING_TIME_FIELDS)[number];
export type ListingTimes = Partial<Record<ListingTimeField, string | null>>;

const TIME_LABEL: Record<ListingTimeField, string> = {
  checkInTime: "Check-in time",
  checkOutTime: "Checkout time",
  quietHoursStart: "Quiet hours start",
  quietHoursEnd: "Quiet hours end",
};

const CANONICAL_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** True for exactly what the time picker produces: a 24-hour "HH:MM". */
export function isCanonicalTime(value: string | null | undefined): boolean {
  return typeof value === "string" && CANONICAL_TIME.test(value);
}

/**
 * Best reading of a saved time as "HH:MM", or null when it can't be read
 * confidently. "15:00", "3pm", "3:30 PM", "After 3pm", "noon" all parse; a
 * bare number with no am/pm ("After 3") or plain words ("Flexible") don't,
 * since guessing morning or afternoon would put the wrong time in front of
 * the host.
 */
export function parseListingTime(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const text = raw.trim().toLowerCase();
  if (isCanonicalTime(text)) return text;
  if (/\bnoon\b|\bmidday\b/.test(text)) return "12:00";
  if (/\bmidnight\b/.test(text)) return "00:00";

  const match = text.match(/(?<!\d)(\d{1,2})(?:[:.](\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?(?![\d])/);
  if (!match) return null;
  const [, hourText, minuteText, meridiem] = match;
  let hour = Number(hourText);
  const minute = minuteText === undefined ? 0 : Number(minuteText);
  if (minute > 59) return null;

  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    const pm = meridiem.startsWith("p");
    if (hour === 12) hour = pm ? 12 : 0;
    else if (pm) hour += 12;
  } else {
    // "15:00" style without am/pm is fine; a bare "3" is too ambiguous.
    if (minuteText === undefined || hour > 23) return null;
  }
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/**
 * How a saved time reads to a guest: "3pm", "10:30am", "noon", "midnight"
 * for a picker time, and anything else exactly as the host wrote it.
 */
export function formatListingTime(raw: string | null | undefined): string {
  if (!raw) return "";
  if (!isCanonicalTime(raw)) return raw;
  const [hour, minute] = raw.split(":").map(Number);
  if (minute === 0 && hour === 12) return "noon";
  if (minute === 0 && hour === 0) return "midnight";
  const suffix = hour < 12 ? "am" : "pm";
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return minute === 0 ? `${hour12}${suffix}` : `${hour12}:${String(minute).padStart(2, "0")}${suffix}`;
}

/** "10pm – 7am" - overnight ranges are normal for quiet hours. */
export function formatQuietHours(start: string | null | undefined, end: string | null | undefined): string {
  return `${formatListingTime(start)} – ${formatListingTime(end)}`;
}

/**
 * Why quiet hours can't be saved as given, or null when they can. Both or
 * neither must be set; an overnight range (22:00-07:00) is fine, the same
 * start and end isn't a range at all.
 */
export function quietHoursError(start: string | null | undefined, end: string | null | undefined): string | null {
  const hasStart = Boolean(start?.trim());
  const hasEnd = Boolean(end?.trim());
  if (hasStart !== hasEnd) return "Set both a start and an end for quiet hours, or leave both blank.";
  if (hasStart && start!.trim().toLowerCase() === end!.trim().toLowerCase()) {
    return "Quiet hours can't start and end at the same time.";
  }
  return null;
}

/**
 * Server-side check of the time fields a create/edit request sends. A sent
 * value must be a picker time ("HH:MM"), or - on an edit - exactly the text
 * already saved, so a client re-sending an older free-text value untouched
 * never fails. Quiet hours are checked as they'd end up after the save
 * (sent values over `existing`), but only when the request touches them.
 */
export function listingTimesError(input: ListingTimes, existing?: ListingTimes): string | null {
  for (const field of LISTING_TIME_FIELDS) {
    const value = input[field];
    if (value === undefined || value === null) continue;
    if (!isCanonicalTime(value) && value !== existing?.[field]) {
      return `${TIME_LABEL[field]} must be a time like 15:00.`;
    }
  }
  if (input.quietHoursStart === undefined && input.quietHoursEnd === undefined) return null;
  const start = input.quietHoursStart !== undefined ? input.quietHoursStart : (existing?.quietHoursStart ?? null);
  const end = input.quietHoursEnd !== undefined ? input.quietHoursEnd : (existing?.quietHoursEnd ?? null);
  return quietHoursError(start, end);
}
