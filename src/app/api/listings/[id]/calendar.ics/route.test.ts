import { describe, expect, it, vi } from "vitest";

const { findUnique } = vi.hoisted(() => ({ findUnique: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { listing: { findUnique } } }));

import { GET } from "./route";

const get = (id: string, token?: string) =>
  GET(new Request(`http://x/api/listings/${id}/calendar.ics${token ? `?token=${token}` : ""}`), {
    params: Promise.resolve({ id }),
  });

findUnique.mockImplementation(async ({ where, select }: { where: { id: string }; select: Record<string, unknown> }) => {
  // The query itself only asks for blocking bookings' dates and the host's
  // own blocks - never imported blocks, never guest details.
  expect(select.availabilityBlocks).toMatchObject({ where: { source: "HOST" } });
  expect(JSON.stringify(select.bookings)).not.toMatch(/guest/i);
  if (where.id !== "listing_a") return null;
  return {
    id: "listing_a",
    title: "Sea View Flat",
    icalExportToken: "token-a",
    bookings: [{ id: "b1", checkIn: new Date("2027-01-10"), checkOut: new Date("2027-01-12"), status: "CONFIRMED" }],
    availabilityBlocks: [{ id: "h1", startDate: new Date("2027-02-01"), endDate: new Date("2027-02-03"), reason: null }],
  };
});

describe("GET /api/listings/[id]/calendar.ics", () => {
  it("needs the listing's own private token", async () => {
    expect((await get("listing_a")).status).toBe(401);
    expect((await get("listing_a", "wrong-token")).status).toBe(404);
    // Another listing's token never opens this listing's calendar.
    expect((await get("listing_b", "token-a")).status).toBe(404);
  });

  it("exports bookings and the host's blocks as plain busy dates", async () => {
    const res = await get("listing_a", "token-a");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/calendar/);
    const body = await res.text();
    expect(body).toContain("DTSTART;VALUE=DATE:20270110");
    expect(body).toContain("DTSTART;VALUE=DATE:20270201");
    expect(body).toContain("SUMMARY:Booked (FYStay)");
  });
});
