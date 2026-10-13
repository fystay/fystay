import { formatDistance } from "date-fns";

/**
 * How a listing's iCal calendar sync is doing, in words a host can act on -
 * shared by the Channels page and the listing's own calendar sync card so
 * both say the same thing. Pure (no database, no server-only imports), so
 * it also runs in the client card.
 *
 * Status comes only from what icalSync.ts stored on the listing: no import
 * link means "Not connected", never "connected".
 */

/**
 * The daily background sync (vercel.json crons, /api/cron/sync-ical-imports).
 * A unit test checks vercel.json still says this, so the copy below can't
 * drift from the real schedule.
 */
export const ICAL_SYNC_CRON_SCHEDULE = "0 6 * * *";
export const ICAL_SYNC_SCHEDULE_TEXT = "once a day, at 6am UTC (7am UK summer time)";

export type IcalChannel = "AIRBNB" | "OTHER";

export const ICAL_CHANNEL_LABEL: Record<IcalChannel, string> = {
  AIRBNB: "Airbnb",
  OTHER: "Other calendar (iCal)",
};

/** Which channel an import link belongs to, from its host name. */
export function icalChannelForUrl(raw: string | null | undefined): IcalChannel | null {
  if (!raw) return null;
  try {
    const host = new URL(raw).hostname.toLowerCase();
    return /(^|\.)airbnb\.[a-z]{2,3}(\.[a-z]{2})?$/.test(host) ? "AIRBNB" : "OTHER";
  } catch {
    return "OTHER";
  }
}

export type IcalSyncFields = {
  icalImportUrl: string | null;
  icalSyncedAt: Date | null;
  icalSyncError: string | null;
  icalSyncFailedAt: Date | null;
};

export type IcalChannelStatus =
  | { state: "NOT_CONNECTED"; channel: null; label: string }
  | { state: "PENDING"; channel: IcalChannel; label: string; message: string }
  | { state: "CONNECTED"; channel: IcalChannel; label: string }
  | { state: "PROBLEM"; channel: IcalChannel; label: string; message: string };

/** Has the most recent sync attempt failed (rather than an older one, since cleared by a success)? */
export function icalSyncFailing(fields: IcalSyncFields): boolean {
  const { icalSyncError, icalSyncFailedAt, icalSyncedAt } = fields;
  return Boolean(icalSyncError && icalSyncFailedAt && (!icalSyncedAt || icalSyncFailedAt > icalSyncedAt));
}

export function icalChannelStatus(fields: IcalSyncFields, now: Date = new Date()): IcalChannelStatus {
  const channel = icalChannelForUrl(fields.icalImportUrl);
  if (!channel) return { state: "NOT_CONNECTED", channel: null, label: "Not connected" };

  const ago = (date: Date) => formatDistance(date, now, { addSuffix: true });

  if (icalSyncFailing(fields)) {
    const message = friendlyIcalSyncError(fields.icalSyncError, channel);
    const kept = fields.icalSyncedAt
      ? ` Dates from the last good sync (${ago(fields.icalSyncedAt)}) are still blocked.`
      : " No dates have been imported yet.";
    return { state: "PROBLEM", channel, label: "Sync problem", message: message + kept };
  }
  if (!fields.icalSyncedAt) {
    return {
      state: "PENDING",
      channel,
      label: "Link saved – not synced yet",
      message: "Open the listing's calendar and press Sync now to check the link works.",
    };
  }
  return { state: "CONNECTED", channel, label: `Connected – last synced ${ago(fields.icalSyncedAt)}` };
}

/**
 * Turns the reason icalSync.ts stored (see fetchImportedEvents) into the
 * next step for the host, naming the site the link came from.
 */
export function friendlyIcalSyncError(stored: string | null, channel: IcalChannel = "OTHER"): string {
  const site = channel === "AIRBNB" ? "Airbnb" : "The other site";
  const freshLink =
    channel === "AIRBNB"
      ? "copy a fresh export link from Airbnb (Calendar → Availability → Connect calendars → Export calendar) and paste it here"
      : "copy a fresh export (iCal / .ics) link from that site and paste it here";
  const text = stored ?? "";

  const refused = text.match(/refused the calendar link \((\d{3})\)/);
  if (refused) {
    const code = refused[1];
    return code === "404"
      ? `${site} returned 404 – the link may have been reset or the listing removed there; ${freshLink}.`
      : `${site} refused the link (${code}) – it may have been reset or made private; ${freshLink}.`;
  }
  const serverError = text.match(/returned an error \((\d{3})\)/);
  if (serverError) {
    return `${site} had a problem sending the calendar (${serverError[1]}). FYStay will try again at the next sync, or press Sync now later.`;
  }
  if (/didn.t respond/.test(text)) {
    return `${site} didn't respond in time. FYStay will try again at the next sync, or press Sync now later.`;
  }
  if (/didn.t return a calendar file/.test(text)) {
    return channel === "AIRBNB"
      ? "That link opened a web page, not a calendar. Use Airbnb's Export calendar link (it ends in .ics), not the listing's page address."
      : "That link opened a web page, not a calendar. Use the site's export (iCal / .ics) link.";
  }
  if (/can.t be used/.test(text)) {
    return `${text.replace(/\.$/, "")}. Paste the calendar's public export (.ics) link instead.`;
  }
  return text || "The calendar couldn't be synced. FYStay will try again at the next sync.";
}
