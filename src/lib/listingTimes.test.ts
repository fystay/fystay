import { describe, expect, it } from "vitest";
import {
  formatListingTime,
  formatQuietHours,
  isCanonicalTime,
  listingTimesError,
  parseListingTime,
  quietHoursError,
} from "./listingTimes";

describe("parseListingTime", () => {
  it.each([
    ["15:00", "15:00"],
    ["3pm", "15:00"],
    ["3 PM", "15:00"],
    ["3:30 pm", "15:30"],
    ["3.30pm", "15:30"],
    ["After 3:00 PM", "15:00"],
    ["Before 11:00 AM", "11:00"],
    ["From 3pm", "15:00"],
    ["11am", "11:00"],
    ["12pm", "12:00"],
    ["12am", "00:00"],
    ["10 p.m.", "22:00"],
    ["9:05", "09:05"],
    ["Noon", "12:00"],
    ["midnight", "00:00"],
  ])("reads %j as %s", (raw, expected) => {
    expect(parseListingTime(raw)).toBe(expected);
  });

  it.each(["Flexible", "By arrangement", "After 3", "24:00", "13pm", "3:75pm", "", null, undefined])(
    "won't guess at %j",
    (raw) => {
      expect(parseListingTime(raw)).toBeNull();
    },
  );
});

describe("isCanonicalTime", () => {
  it("accepts only a 24-hour HH:MM", () => {
    expect(isCanonicalTime("00:00")).toBe(true);
    expect(isCanonicalTime("23:59")).toBe(true);
    expect(isCanonicalTime("9:00")).toBe(false);
    expect(isCanonicalTime("24:00")).toBe(false);
    expect(isCanonicalTime("3pm")).toBe(false);
    expect(isCanonicalTime(null)).toBe(false);
  });
});

describe("formatListingTime", () => {
  it("reads a picker time naturally", () => {
    expect(formatListingTime("15:00")).toBe("3pm");
    expect(formatListingTime("10:30")).toBe("10:30am");
    expect(formatListingTime("12:00")).toBe("noon");
    expect(formatListingTime("00:00")).toBe("midnight");
    expect(formatListingTime("00:30")).toBe("12:30am");
  });

  it("shows older free text exactly as the host wrote it", () => {
    expect(formatListingTime("After 3pm")).toBe("After 3pm");
    expect(formatListingTime("Flexible")).toBe("Flexible");
    expect(formatListingTime(null)).toBe("");
  });

  it("formats overnight quiet hours", () => {
    expect(formatQuietHours("22:00", "07:00")).toBe("10pm – 7am");
  });
});

describe("quietHoursError", () => {
  it("accepts an overnight range, or none at all", () => {
    expect(quietHoursError("22:00", "07:00")).toBeNull();
    expect(quietHoursError("13:00", "15:00")).toBeNull();
    expect(quietHoursError("", "")).toBeNull();
    expect(quietHoursError(null, null)).toBeNull();
  });

  it("refuses the same start and end", () => {
    expect(quietHoursError("22:00", "22:00")).toMatch(/same time/);
  });

  it("refuses only one end of the range", () => {
    expect(quietHoursError("22:00", "")).toMatch(/both/);
    expect(quietHoursError(null, "07:00")).toMatch(/both/);
  });
});

describe("listingTimesError", () => {
  it("accepts picker times and clearing a time", () => {
    expect(listingTimesError({ checkInTime: "15:00", checkOutTime: null })).toBeNull();
  });

  it("refuses new free text", () => {
    expect(listingTimesError({ checkInTime: "3pm" })).toMatch(/Check-in time must be a time like 15:00/);
  });

  it("accepts older free text re-sent exactly as saved", () => {
    expect(listingTimesError({ checkInTime: "After 3pm" }, { checkInTime: "After 3pm" })).toBeNull();
    expect(listingTimesError({ checkInTime: "After 4pm" }, { checkInTime: "After 3pm" })).not.toBeNull();
  });

  it("checks quiet hours against the saved half when only one is sent", () => {
    expect(listingTimesError({ quietHoursEnd: "07:00" }, { quietHoursStart: "22:00", quietHoursEnd: null })).toBeNull();
    expect(listingTimesError({ quietHoursEnd: "22:00" }, { quietHoursStart: "22:00", quietHoursEnd: null })).toMatch(
      /same time/,
    );
    expect(listingTimesError({ quietHoursStart: "22:00" })).toMatch(/both/);
  });

  it("leaves quiet hours alone when the request doesn't touch them", () => {
    expect(listingTimesError({ checkInTime: "15:00" }, { quietHoursStart: "22:00", quietHoursEnd: null })).toBeNull();
  });
});
