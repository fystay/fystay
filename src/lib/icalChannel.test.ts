import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import {
  ICAL_SYNC_CRON_SCHEDULE,
  friendlyIcalSyncError,
  icalChannelForUrl,
  icalChannelStatus,
  type IcalSyncFields,
} from "./icalChannel";

const NOW = new Date("2026-10-13T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 60 * 60 * 1000);
const AIRBNB = "https://www.airbnb.co.uk/calendar/ical/123.ics?s=abc";

function fields(overrides: Partial<IcalSyncFields> = {}): IcalSyncFields {
  return { icalImportUrl: null, icalSyncedAt: null, icalSyncError: null, icalSyncFailedAt: null, ...overrides };
}

describe("icalChannelForUrl", () => {
  it("recognises Airbnb links on any Airbnb domain", () => {
    expect(icalChannelForUrl(AIRBNB)).toBe("AIRBNB");
    expect(icalChannelForUrl("https://www.airbnb.com/calendar/ical/1.ics")).toBe("AIRBNB");
    expect(icalChannelForUrl("https://airbnb.com.au/calendar/ical/1.ics")).toBe("AIRBNB");
  });

  it("treats anything else, including look-alikes, as another calendar", () => {
    expect(icalChannelForUrl("https://www.vrbo.com/icalendar/1.ics")).toBe("OTHER");
    expect(icalChannelForUrl("https://airbnb.evil.example/cal.ics")).toBe("OTHER");
    expect(icalChannelForUrl("not a url")).toBe("OTHER");
  });

  it("has no channel without a link", () => {
    expect(icalChannelForUrl(null)).toBeNull();
    expect(icalChannelForUrl("")).toBeNull();
  });
});

describe("icalChannelStatus", () => {
  it("is never connected when no import link is set, even with stale sync fields", () => {
    const status = icalChannelStatus(fields({ icalSyncedAt: hoursAgo(1) }), NOW);
    expect(status).toEqual({ state: "NOT_CONNECTED", channel: null, label: "Not connected" });
  });

  it("is pending when a link is saved but has never synced", () => {
    const status = icalChannelStatus(fields({ icalImportUrl: AIRBNB }), NOW);
    expect(status.state).toBe("PENDING");
    expect(status.channel).toBe("AIRBNB");
  });

  it("is connected with the last sync time after a good sync", () => {
    const status = icalChannelStatus(fields({ icalImportUrl: AIRBNB, icalSyncedAt: hoursAgo(3) }), NOW);
    expect(status).toEqual({ state: "CONNECTED", channel: "AIRBNB", label: "Connected – last synced about 3 hours ago" });
  });

  it("reports a problem when the latest attempt failed, and says the old dates are kept", () => {
    const status = icalChannelStatus(
      fields({
        icalImportUrl: AIRBNB,
        icalSyncedAt: hoursAgo(26),
        icalSyncError: "The other site refused the calendar link (404). Check it's the current export link.",
        icalSyncFailedAt: hoursAgo(2),
      }),
      NOW,
    );
    expect(status.state).toBe("PROBLEM");
    if (status.state !== "PROBLEM") return;
    expect(status.label).toBe("Sync problem");
    expect(status.message).toMatch(/^Airbnb returned 404 – the link may have been reset/);
    expect(status.message).toContain("still blocked");
  });

  it("says nothing was imported when the very first sync failed", () => {
    const status = icalChannelStatus(
      fields({ icalImportUrl: "https://example.com/c.ics", icalSyncError: "x", icalSyncFailedAt: hoursAgo(1) }),
      NOW,
    );
    expect(status.state).toBe("PROBLEM");
    if (status.state === "PROBLEM") expect(status.message).toContain("No dates have been imported yet");
  });

  it("ignores an error older than the last good sync", () => {
    const status = icalChannelStatus(
      fields({ icalImportUrl: AIRBNB, icalSyncedAt: hoursAgo(1), icalSyncError: "old", icalSyncFailedAt: hoursAgo(5) }),
      NOW,
    );
    expect(status.state).toBe("CONNECTED");
  });
});

describe("friendlyIcalSyncError", () => {
  it("tells the host to fetch a fresh Airbnb link on 404 / 403", () => {
    expect(friendlyIcalSyncError("The other site refused the calendar link (404).", "AIRBNB")).toContain(
      "copy a fresh export link from Airbnb",
    );
    expect(friendlyIcalSyncError("The other site refused the calendar link (403).", "AIRBNB")).toMatch(
      /^Airbnb refused the link \(403\)/,
    );
    expect(friendlyIcalSyncError("The other site refused the calendar link (401).", "OTHER")).toMatch(
      /^The other site refused the link \(401\).*from that site/,
    );
  });

  it("says temporary failures retry on their own", () => {
    expect(friendlyIcalSyncError("The other calendar returned an error (503). FYStay will try again", "AIRBNB")).toMatch(
      /^Airbnb had a problem.*\(503\).*try again/,
    );
    expect(friendlyIcalSyncError("The other calendar didn't respond. FYStay will try again at the next sync.")).toMatch(
      /didn't respond in time.*try again/,
    );
  });

  it("explains a web page was pasted instead of the export link", () => {
    expect(
      friendlyIcalSyncError("That link didn't return a calendar file. Use the calendar's export (iCal / .ics) link.", "AIRBNB"),
    ).toContain("Export calendar link");
  });

  it("keeps an unsafe-link reason and adds the fix", () => {
    expect(friendlyIcalSyncError("That calendar link can't be used: only public addresses are allowed.")).toBe(
      "That calendar link can't be used: only public addresses are allowed. Paste the calendar's public export (.ics) link instead.",
    );
  });

  it("falls back to the stored text, or a generic retry message", () => {
    expect(friendlyIcalSyncError("Something unusual")).toBe("Something unusual");
    expect(friendlyIcalSyncError(null)).toMatch(/try again at the next sync/);
  });
});

describe("ICAL_SYNC_CRON_SCHEDULE", () => {
  it("matches the real schedule in vercel.json, which the page copy describes", () => {
    const vercel = JSON.parse(readFileSync(join(__dirname, "../../vercel.json"), "utf8")) as {
      crons: { path: string; schedule: string }[];
    };
    const cron = vercel.crons.find((c) => c.path === "/api/cron/sync-ical-imports");
    expect(cron?.schedule).toBe(ICAL_SYNC_CRON_SCHEDULE);
  });
});
