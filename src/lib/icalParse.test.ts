import { describe, expect, it } from "vitest";
import { isIcsCalendar, parseIcsEvents as parse } from "./icalParse";

// Fixed "today", so the 2026 fixtures below aren't dropped as past events.
const TODAY = new Date(Date.UTC(2026, 0, 1));
const parseIcsEvents = (text: string) => parse(text, { today: TODAY });

function ics(body: string): string {
  return `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${body}END:VCALENDAR\r\n`;
}

describe("parseIcsEvents", () => {
  it("parses a single all-day VEVENT", () => {
    const events = parseIcsEvents(
      ics(
        "BEGIN:VEVENT\r\nUID:abc-123\r\nDTSTART;VALUE=DATE:20260610\r\nDTEND;VALUE=DATE:20260615\r\nEND:VEVENT\r\n",
      ),
    );
    expect(events).toEqual([
      { uid: "abc-123", start: new Date(Date.UTC(2026, 5, 10)), end: new Date(Date.UTC(2026, 5, 15)) },
    ]);
  });

  it("turns a timed UTC event into the UK nights it covers", () => {
    const events = parseIcsEvents(
      ics(
        "BEGIN:VEVENT\r\nUID:dt-1\r\nDTSTART:20260610T140000Z\r\nDTEND:20260615T110000Z\r\nEND:VEVENT\r\n",
      ),
    );
    // 15:00 BST on 10 June to 12:00 BST on 15 June: nights 10-14 June.
    expect(events).toEqual([
      { uid: "dt-1", start: new Date(Date.UTC(2026, 5, 10)), end: new Date(Date.UTC(2026, 5, 15)) },
    ]);
  });

  it("unfolds a UID value split across a continuation line back into one property", () => {
    // A single long UID folded mid-value, per RFC 5545 - the continuation
    // line's one leading space is the fold marker itself, not part of the
    // value, so unfolding must strip it before property parsing runs.
    const events = parseIcsEvents(
      ics("BEGIN:VEVENT\r\nUID:long-uid-part-one-\r\n part-two\r\nDTSTART;VALUE=DATE:20260610\r\nDTEND;VALUE=DATE:20260611\r\nEND:VEVENT\r\n"),
    );
    expect(events[0]?.uid).toBe("long-uid-part-one-part-two");
  });

  it("skips a VEVENT missing UID, DTSTART, or DTEND", () => {
    const events = parseIcsEvents(
      ics("BEGIN:VEVENT\r\nDTSTART;VALUE=DATE:20260610\r\nDTEND;VALUE=DATE:20260611\r\nEND:VEVENT\r\n"),
    );
    expect(events).toEqual([]);
  });

  it("skips an event with an unparseable date rather than throwing", () => {
    const events = parseIcsEvents(
      ics("BEGIN:VEVENT\r\nUID:bad-date\r\nDTSTART:not-a-date\r\nDTEND;VALUE=DATE:20260611\r\nEND:VEVENT\r\n"),
    );
    expect(events).toEqual([]);
  });

  it("parses multiple VEVENTs from the same feed", () => {
    const events = parseIcsEvents(
      ics(
        "BEGIN:VEVENT\r\nUID:one\r\nDTSTART;VALUE=DATE:20260101\r\nDTEND;VALUE=DATE:20260102\r\nEND:VEVENT\r\n" +
          "BEGIN:VEVENT\r\nUID:two\r\nDTSTART;VALUE=DATE:20260201\r\nDTEND;VALUE=DATE:20260202\r\nEND:VEVENT\r\n",
      ),
    );
    expect(events.map((e) => e.uid)).toEqual(["one", "two"]);
  });

  it("returns an empty array for a feed with no events", () => {
    expect(parseIcsEvents(ics(""))).toEqual([]);
  });

  it("ignores property parameters, reading only the value after the last relevant colon", () => {
    const events = parseIcsEvents(
      ics(
        "BEGIN:VEVENT\r\nUID:params-1\r\nDTSTART;TZID=Europe/London;VALUE=DATE:20260301\r\nDTEND;VALUE=DATE:20260302\r\nEND:VEVENT\r\n",
      ),
    );
    expect(events).toEqual([
      { uid: "params-1", start: new Date(Date.UTC(2026, 2, 1)), end: new Date(Date.UTC(2026, 2, 2)) },
    ]);
  });

  const day = (m: number, d: number) => new Date(Date.UTC(2026, m - 1, d));
  const vevent = (lines: string) => ics(`BEGIN:VEVENT\r\n${lines.trim().split("\n").map((l) => l.trim()).join("\r\n")}\r\nEND:VEVENT\r\n`);

  it("reads a UTC time late in the evening as the next UK day in summer", () => {
    // 23:30 UTC on 9 July is 00:30 BST on 10 July.
    const [event] = parseIcsEvents(vevent("UID:late\nDTSTART:20260709T233000Z\nDTEND:20260712T100000Z"));
    expect(event).toEqual({ uid: "late", start: day(7, 10), end: day(7, 12) });
  });

  it("reads TZID and floating times as the date written, whatever the server's zone", () => {
    const [tz] = parseIcsEvents(vevent("UID:tz\nDTSTART;TZID=America/New_York:20260810T220000\nDTEND;TZID=America/New_York:20260812T100000"));
    expect(tz).toEqual({ uid: "tz", start: day(8, 10), end: day(8, 12) });
    const [floating] = parseIcsEvents(vevent("UID:fl\nDTSTART:20260810T150000\nDTEND:20260811T110000"));
    expect(floating).toEqual({ uid: "fl", start: day(8, 10), end: day(8, 11) });
  });

  it("blocks at least one night for a same-day event, and uses DURATION or one day when DTEND is missing", () => {
    const [sameDay] = parseIcsEvents(vevent("UID:sd\nDTSTART:20260810T090000Z\nDTEND:20260810T170000Z"));
    expect(sameDay).toEqual({ uid: "sd", start: day(8, 10), end: day(8, 11) });
    const [duration] = parseIcsEvents(vevent("UID:du\nDTSTART;VALUE=DATE:20260810\nDURATION:P3D"));
    expect(duration).toEqual({ uid: "du", start: day(8, 10), end: day(8, 13) });
    const [noEnd] = parseIcsEvents(vevent("UID:ne\nDTSTART;VALUE=DATE:20260810"));
    expect(noEnd).toEqual({ uid: "ne", start: day(8, 10), end: day(8, 11) });
  });

  it("ignores cancelled and free (transparent) events", () => {
    const events = parseIcsEvents(
      vevent("UID:c\nSTATUS:CANCELLED\nDTSTART;VALUE=DATE:20260810\nDTEND;VALUE=DATE:20260812") +
        vevent("UID:t\nTRANSP:TRANSPARENT\nDTSTART;VALUE=DATE:20260810\nDTEND;VALUE=DATE:20260812"),
    );
    expect(events).toEqual([]);
  });

  it("expands a weekly recurring block, skipping EXDATEs, with a stable id per occurrence", () => {
    const events = parseIcsEvents(
      vevent("UID:weekly\nDTSTART;VALUE=DATE:20260803\nDTEND;VALUE=DATE:20260804\nRRULE:FREQ=WEEKLY;COUNT=4\nEXDATE;VALUE=DATE:20260810"),
    );
    expect(events).toEqual([
      { uid: "weekly#2026-08-03", start: day(8, 3), end: day(8, 4) },
      { uid: "weekly#2026-08-17", start: day(8, 17), end: day(8, 18) },
      { uid: "weekly#2026-08-24", start: day(8, 24), end: day(8, 25) },
    ]);
  });

  it("expands BYDAY and UNTIL, and applies a moved or cancelled occurrence", () => {
    const events = parseIcsEvents(
      vevent("UID:wk\nDTSTART;VALUE=DATE:20260803\nDTEND;VALUE=DATE:20260804\nRRULE:FREQ=WEEKLY;BYDAY=MO,FR;UNTIL=20260814") +
        vevent("UID:wk\nRECURRENCE-ID;VALUE=DATE:20260807\nDTSTART;VALUE=DATE:20260808\nDTEND;VALUE=DATE:20260809") +
        vevent("UID:wk\nRECURRENCE-ID;VALUE=DATE:20260810\nSTATUS:CANCELLED\nDTSTART;VALUE=DATE:20260810\nDTEND;VALUE=DATE:20260811"),
    );
    expect(events.map((e) => [e.uid, e.start.toISOString().slice(0, 10)])).toEqual([
      ["wk#2026-08-03", "2026-08-03"],
      ["wk#2026-08-07", "2026-08-08"],
      ["wk#2026-08-14", "2026-08-14"],
    ]);
  });

  it("drops events that ended before today", () => {
    const events = parse(vevent("UID:old\nDTSTART;VALUE=DATE:20260101\nDTEND;VALUE=DATE:20260103"), { today: day(6, 1) });
    expect(events).toEqual([]);
  });

  it("tells a calendar from an error or sign-in page", () => {
    expect(isIcsCalendar(ics(""))).toBe(true);
    expect(isIcsCalendar("\uFEFFBEGIN:VCALENDAR\r\n")).toBe(true);
    expect(isIcsCalendar("<!DOCTYPE html><html>Sign in</html>")).toBe(false);
    expect(isIcsCalendar("")).toBe(false);
  });
});
