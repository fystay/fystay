import { describe, expect, it } from "vitest";
import { parseStayDate, stayDateToLocal, toStayDateString, todayStayDate } from "./stayDates";

describe("stay dates", () => {
  it("parses a plain date as that date's UTC midnight", () => {
    expect(parseStayDate("2026-10-02")?.toISOString()).toBe("2026-10-02T00:00:00.000Z");
  });

  it("rejects impossible and malformed dates", () => {
    expect(parseStayDate("2026-02-31")).toBeNull();
    expect(parseStayDate("not a date")).toBeNull();
  });

  it("rounds a legacy local-midnight timestamp to the date the guest picked", () => {
    // UK summer (BST): local midnight on 2 Oct is 1 Oct 23:00 UTC.
    expect(parseStayDate("2026-10-01T23:00:00.000Z")?.toISOString()).toBe("2026-10-02T00:00:00.000Z");
    // New York: local midnight on 2 Oct is 2 Oct 04:00 UTC.
    expect(parseStayDate("2026-10-02T04:00:00.000Z")?.toISOString()).toBe("2026-10-02T00:00:00.000Z");
  });

  it("round-trips a picker date through the string the client sends", () => {
    const picked = new Date(2026, 9, 2); // local midnight, 2 Oct
    expect(toStayDateString(picked)).toBe("2026-10-02");
    expect(stayDateToLocal(parseStayDate(toStayDateString(picked))!)).toEqual(picked);
  });

  it("gives today's date as a UTC midnight", () => {
    expect(todayStayDate(new Date("2026-10-01T15:42:00Z")).toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });
});
