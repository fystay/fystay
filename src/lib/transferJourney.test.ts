import { describe, expect, it } from "vitest";
import { composeJourneyNotes, transferJourneySchema, transferTimeError } from "./transferJourney";

const valid = {
  offeringId: "o1",
  pickupAddress: "Manchester Airport, Terminal 2",
  dropoffAddress: "12 Promenade, Blackpool",
  pickupAt: "2026-12-01T10:00:00.000Z",
  passengers: 2,
  bags: 3,
  contactName: "Sam Lee",
  contactPhone: "+44 7700 900123",
};

describe("transferJourneySchema", () => {
  it("accepts a complete journey", () => {
    expect(transferJourneySchema.safeParse(valid).success).toBe(true);
  });

  it("rejects a missing address, a bad phone number and no passengers", () => {
    expect(transferJourneySchema.safeParse({ ...valid, pickupAddress: " " }).success).toBe(false);
    expect(transferJourneySchema.safeParse({ ...valid, contactPhone: "call me" }).success).toBe(false);
    expect(transferJourneySchema.safeParse({ ...valid, passengers: 0 }).success).toBe(false);
  });
});

describe("transferTimeError", () => {
  const now = new Date("2026-11-01T12:00:00Z");
  it("needs 24 hours' notice", () => {
    expect(transferTimeError(new Date("2026-11-02T11:00:00Z"), now)).toMatch(/24 hours/);
    expect(transferTimeError(new Date("2026-11-02T12:00:00Z"), now)).toBeNull();
  });
});

describe("composeJourneyNotes", () => {
  it("lists the journey and leaves out what wasn't given", () => {
    const notes = composeJourneyNotes(transferJourneySchema.parse(valid));
    expect(notes).toBe(
      "Pickup: Manchester Airport, Terminal 2\nDrop-off: 12 Promenade, Blackpool\nPassengers: 2\nBags: 3",
    );
    expect(composeJourneyNotes(transferJourneySchema.parse({ ...valid, flightNumber: "BA1388", notes: "Child seat" }))).toContain(
      "Flight: BA1388",
    );
  });
});
