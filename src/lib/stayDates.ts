/**
 * A stay's check-in/check-out (and a host's availability block) is a
 * calendar date, not a moment in time. It's stored as that date's UTC
 * midnight, so it reads the same on every server and in every browser.
 *
 * The date picker hands back a Date at the guest's own local midnight. Sent
 * with toISOString() that becomes the previous evening in UTC for anyone east
 * of Greenwich (a UK guest in summer booking 2 Oct sent "1 Oct 23:00Z"), so
 * the client sends the plain "yyyy-MM-dd" date and the server parses it here.
 */

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The calendar date a picker Date (local midnight) stands for, as "yyyy-MM-dd". */
export function toStayDateString(localDate: Date): string {
  const y = localDate.getFullYear();
  const m = String(localDate.getMonth() + 1).padStart(2, "0");
  const d = String(localDate.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Parses a stay date from a request into its UTC midnight, or null if it
 * isn't a date. Takes "yyyy-MM-dd", or - from a browser still running the
 * previous client code - a full timestamp of some local midnight, which is
 * rounded to the nearest UTC midnight (right for any UTC offset within ±12h,
 * which covers every guest of a UK booking site in practice).
 */
export function parseStayDate(input: string): Date | null {
  const dateOnly = DATE_ONLY.exec(input);
  if (dateOnly) {
    const [, y, m, d] = dateOnly.map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    // Rejects "2026-02-31" and friends instead of rolling them over.
    return date.getUTCMonth() === m - 1 && date.getUTCDate() === d ? date : null;
  }
  const timestamp = new Date(input);
  if (Number.isNaN(timestamp.getTime())) return null;
  return new Date(Math.round(timestamp.getTime() / DAY_MS) * DAY_MS);
}

/** Today's date as a stay date (UTC midnight). */
export function todayStayDate(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** A stored stay date as a local-midnight Date, for the browser's date picker. */
export function stayDateToLocal(date: Date | string): Date {
  const d = new Date(date);
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}
