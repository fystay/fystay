/**
 * Reads another site's calendar export (Airbnb, Vrbo, Booking.com, Google
 * Calendar...) into the nights it marks as busy, for icalSync.ts.
 *
 * Every event becomes a range of calendar nights, [start, end) at UTC
 * midnight - the same shape as an AvailabilityBlock and a booking's
 * checkIn/checkOut:
 * - All-day events (VALUE=DATE, what Airbnb and Vrbo export) are used as
 *   they are: DTEND is already the morning the stay ends.
 * - Timed events become the nights they touch: from the local date they
 *   start on to the local date they end on, at least one night. "Local"
 *   is the event's own TZID or floating time as written, and UK time
 *   (Europe/London) for UTC times - so a 23:30 UTC start in summer counts
 *   from the next day, as it would in the UK.
 * - Recurring events (RRULE) are expanded for the next ~18 months: DAILY,
 *   WEEKLY (with BYDAY), MONTHLY and YEARLY, with INTERVAL, COUNT, UNTIL and
 *   EXDATE. An occurrence moved with RECURRENCE-ID replaces the original.
 *   Rules beyond that keep just their first occurrence.
 * - Cancelled (STATUS:CANCELLED) and free (TRANSP:TRANSPARENT) events don't
 *   block anything.
 * - Events that ended before today are dropped; they can't clash with a
 *   new booking.
 *
 * Malformed events are skipped, never thrown on - one bad event in someone
 * else's export shouldn't stop every other date syncing.
 */
export type ParsedIcsEvent = {
  /** Stable per event (and per occurrence of a recurring one), so a re-sync updates rather than duplicates it. */
  uid: string;
  start: Date;
  end: Date;
};

const DAY_MS = 24 * 60 * 60 * 1000;
/** How far ahead recurring events are expanded - well past any bookable date. */
const RECURRENCE_HORIZON_DAYS = 550;
/** A ceiling per feed, so a runaway export can't fill the database. */
export const MAX_IMPORTED_EVENTS = 2000;

/** RFC 5545 line unfolding: a continuation line starts with a space or tab and is joined onto the previous line. */
function unfoldLines(text: string): string[] {
  const rawLines = text.split(/\r\n|\r|\n/);
  const unfolded: string[] = [];
  for (const line of rawLines) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && unfolded.length > 0) {
      unfolded[unfolded.length - 1] += line.slice(1);
    } else {
      unfolded.push(line);
    }
  }
  return unfolded;
}

/** Does this look like an iCalendar file at all (rather than an error or sign-in page)? */
export function isIcsCalendar(text: string): boolean {
  return /^\s*BEGIN:VCALENDAR/i.test(text.replace(/^﻿/, ""));
}

const utcDay = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

/** The calendar date (UTC midnight) a UTC instant falls on in the UK. */
function ukDate(instant: Date): Date {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  return utcDay(get("year"), get("month"), get("day"));
}

type IcsTime = { date: Date; allDay: boolean };

/**
 * A DTSTART/DTEND/EXDATE/RECURRENCE-ID value as its local calendar date.
 * Accepts DATE (YYYYMMDD) and DATE-TIME (YYYYMMDDTHHmmss, optionally Z).
 * TZID and floating times are read as written; Z times as UK time.
 */
function parseIcsTime(value: string): IcsTime | null {
  const v = value.trim();
  const dateOnly = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  if (dateOnly) {
    const [, y, m, d] = dateOnly;
    return { date: utcDay(+y, +m, +d), allDay: true };
  }
  const dateTime = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(v);
  if (!dateTime) return null;
  const [, y, m, d, hh, mm, ss, z] = dateTime;
  if (z) {
    const instant = new Date(Date.UTC(+y, +m - 1, +d, +hh, +mm, +ss));
    return { date: ukDate(instant), allDay: false };
  }
  return { date: utcDay(+y, +m, +d), allDay: false };
}

/** The nights an event's start/end cover: [startDate, endDate), at least one night. */
function nightsCovered(start: IcsTime, end: IcsTime | null, durationDays: number | null): { start: Date; end: Date } {
  let endDate: Date;
  if (end) {
    endDate = end.date;
  } else if (durationDays !== null) {
    endDate = new Date(start.date.getTime() + Math.max(1, durationDays) * DAY_MS);
  } else {
    endDate = new Date(start.date.getTime() + DAY_MS);
  }
  if (endDate.getTime() <= start.date.getTime()) endDate = new Date(start.date.getTime() + DAY_MS);
  return { start: start.date, end: endDate };
}

/** DURATION as whole days (P2D, P1W, PT36H rounds up); null if absent or unreadable. */
function parseDurationDays(value: string): number | null {
  const match = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value.trim());
  if (!match) return null;
  const [, w, d, h, m, s] = match;
  const hours = (+(w ?? 0) * 7 + +(d ?? 0)) * 24 + +(h ?? 0) + +(m ?? 0) / 60 + +(s ?? 0) / 3600;
  return Math.ceil(hours / 24);
}

type RawEvent = {
  uid?: string;
  start?: IcsTime;
  end?: IcsTime;
  durationDays?: number | null;
  rrule?: string;
  exdates: number[];
  recurrenceId?: IcsTime;
  cancelled: boolean;
  transparent: boolean;
};

const WEEKDAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

function addMonths(date: Date, months: number): Date | null {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, date.getUTCDate()));
  // e.g. the 31st in a 30-day month: RFC 5545 skips that occurrence.
  return d.getUTCDate() === date.getUTCDate() ? d : null;
}

/** Start dates of each occurrence of a recurring event, from its first start up to `horizon`. */
function expandRule(first: Date, rule: string, horizon: Date): Date[] | null {
  const parts = Object.fromEntries(
    rule.split(";").map((part) => {
      const [k, v] = part.split("=");
      return [k?.toUpperCase(), v ?? ""];
    }),
  ) as Record<string, string>;
  const freq = parts.FREQ;
  const interval = Math.max(1, Number(parts.INTERVAL) || 1);
  const count = parts.COUNT ? Number(parts.COUNT) : null;
  const until = parts.UNTIL ? parseIcsTime(parts.UNTIL)?.date ?? null : null;
  const limit = until && until < horizon ? until : horizon;
  if (!["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(freq)) return null;

  const out: Date[] = [];
  const push = (d: Date) => {
    if (d.getTime() > limit.getTime()) return false;
    if (count !== null && out.length >= count) return false;
    out.push(d);
    return out.length < MAX_IMPORTED_EVENTS;
  };

  if (freq === "WEEKLY" && parts.BYDAY) {
    const days = parts.BYDAY.split(",").map((d) => WEEKDAYS.indexOf(d.replace(/^[+-]?\d+/, ""))).filter((d) => d >= 0);
    // Weeks counted from the week (Sunday-based here; good enough for INTERVAL=1 and 2) of the first start.
    const weekStart = new Date(first.getTime() - first.getUTCDay() * DAY_MS);
    for (let week = 0; ; week += interval) {
      const base = weekStart.getTime() + week * 7 * DAY_MS;
      if (base > limit.getTime()) break;
      for (const day of [...days].sort((a, b) => a - b)) {
        const d = new Date(base + day * DAY_MS);
        if (d < first) continue;
        if (!push(d)) return out;
      }
    }
    return out;
  }

  for (let i = 0; ; i++) {
    let d: Date | null;
    if (freq === "DAILY") d = new Date(first.getTime() + i * interval * DAY_MS);
    else if (freq === "WEEKLY") d = new Date(first.getTime() + i * interval * 7 * DAY_MS);
    else if (freq === "MONTHLY") d = addMonths(first, i * interval);
    else d = addMonths(first, i * interval * 12);
    if (d === null) {
      if (i > 12 * 50) break;
      continue;
    }
    if (!push(d)) break;
  }
  return out;
}

const dayKey = (d: Date) => d.toISOString().slice(0, 10);

/**
 * The busy nights in a raw .ics feed, as UTC-midnight [start, end) ranges.
 * `today` (default: now) drops events already over and anchors how far
 * recurring events are expanded.
 */
export function parseIcsEvents(text: string, { today = new Date() }: { today?: Date } = {}): ParsedIcsEvent[] {
  const lines = unfoldLines(text);
  const raw: RawEvent[] = [];

  let current: RawEvent | null = null;
  for (const line of lines) {
    const upper = line.toUpperCase();
    if (upper === "BEGIN:VEVENT") {
      current = { exdates: [], cancelled: false, transparent: false };
      continue;
    }
    if (upper === "END:VEVENT") {
      if (current) raw.push(current);
      current = null;
      continue;
    }
    if (!current) continue;

    const colonIndex = line.indexOf(":");
    if (colonIndex === -1) continue;
    const name = line.slice(0, colonIndex).split(";")[0].toUpperCase();
    const value = line.slice(colonIndex + 1).trim();

    if (name === "UID") current.uid = value;
    else if (name === "DTSTART") current.start = parseIcsTime(value) ?? undefined;
    else if (name === "DTEND") current.end = parseIcsTime(value) ?? undefined;
    else if (name === "DURATION") current.durationDays = parseDurationDays(value);
    else if (name === "RRULE") current.rrule = value;
    else if (name === "EXDATE") {
      for (const part of value.split(",")) {
        const t = parseIcsTime(part);
        if (t) current.exdates.push(t.date.getTime());
      }
    } else if (name === "RECURRENCE-ID") current.recurrenceId = parseIcsTime(value) ?? undefined;
    else if (name === "STATUS") current.cancelled = value.toUpperCase() === "CANCELLED";
    else if (name === "TRANSP") current.transparent = value.toUpperCase() === "TRANSPARENT";
  }

  const todayDate = utcDay(today.getUTCFullYear(), today.getUTCMonth() + 1, today.getUTCDate());
  const horizon = new Date(todayDate.getTime() + RECURRENCE_HORIZON_DAYS * DAY_MS);
  const events = new Map<string, ParsedIcsEvent>();
  const removed = new Set<string>();

  const add = (uid: string, start: IcsTime, end: IcsTime | null, durationDays: number | null) => {
    const nights = nightsCovered(start, end, durationDays);
    events.set(uid, { uid, ...nights });
  };

  // Masters first, then moved/cancelled single occurrences on top of them.
  for (const event of raw.filter((e) => !e.recurrenceId)) {
    if (!event.uid || !event.start) continue;
    if (event.cancelled || event.transparent) continue;
    const length = event.end ? Math.max(DAY_MS, nightsCovered(event.start, event.end, null).end.getTime() - event.start.date.getTime()) : null;
    if (!event.rrule) {
      add(event.uid, event.start, event.end ?? null, event.durationDays ?? null);
      continue;
    }
    const starts = expandRule(event.start.date, event.rrule, horizon) ?? [event.start.date];
    for (const start of starts) {
      if (event.exdates.includes(start.getTime())) continue;
      const days = length !== null ? length / DAY_MS : (event.durationDays ?? 1);
      events.set(`${event.uid}#${dayKey(start)}`, {
        uid: `${event.uid}#${dayKey(start)}`,
        start,
        end: new Date(start.getTime() + Math.max(1, days) * DAY_MS),
      });
    }
  }
  for (const event of raw.filter((e) => e.recurrenceId)) {
    if (!event.uid || !event.recurrenceId) continue;
    const key = `${event.uid}#${dayKey(event.recurrenceId.date)}`;
    if (event.cancelled || event.transparent || !event.start) {
      events.delete(key);
      removed.add(key);
      continue;
    }
    add(key, event.start, event.end ?? null, event.durationDays ?? null);
  }

  return [...events.values()]
    .filter((e) => !removed.has(e.uid) && e.end.getTime() > todayDate.getTime())
    .sort((a, b) => a.start.getTime() - b.start.getTime())
    .slice(0, MAX_IMPORTED_EVENTS);
}
