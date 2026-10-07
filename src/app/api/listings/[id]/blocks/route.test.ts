import { beforeEach, describe, expect, it, vi } from "vitest";

const { state } = vi.hoisted(() => ({
  state: {
    log: [] as string[],
    bookings: [] as { checkIn: Date; checkOut: Date }[],
    blockFindManyWhere: null as unknown,
  },
}));

vi.mock("@/auth", () => ({ auth: async () => ({ user: { id: "host_1" } }) }));
vi.mock("@/lib/availabilityLock", () => ({
  withListingAvailabilityLock: async (db: unknown, listingId: string, fn: (tx: unknown) => Promise<unknown>) => {
    state.log.push(`lock:${listingId}`);
    const result = await fn(db);
    state.log.push(`unlock:${listingId}`);
    return result;
  },
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    listing: {
      findUnique: async () => ({ id: "listing_1", hostId: "host_1", propertyType: "HOTEL" }),
    },
    roomType: {
      findUnique: async () => ({ id: "rt_1", listingId: "listing_1", totalRooms: 3 }),
      findUniqueOrThrow: async () => ({ totalRooms: 3 }),
    },
    booking: {
      findMany: async () => {
        state.log.push("availability-read");
        return state.bookings.map((b) => ({ ...b, roomsBooked: 1 }));
      },
    },
    availabilityBlock: {
      findMany: async (args: { where: unknown }) => {
        state.blockFindManyWhere = args.where;
        return [];
      },
      create: async (args: { data: object }) => {
        state.log.push("block-create");
        return { id: "blk_1", ...args.data };
      },
    },
  },
}));

import { POST } from "./route";

const block = () =>
  POST(
    new Request("http://x", {
      method: "POST",
      body: JSON.stringify({ startDate: "2027-03-01", endDate: "2027-03-03", roomTypeId: "rt_1" }),
    }),
    { params: Promise.resolve({ id: "listing_1" }) },
  );

beforeEach(() => {
  state.log = [];
  state.bookings = [];
  state.blockFindManyWhere = null;
});

describe("a host blocking dates", () => {
  it("checks for overlaps and writes the block inside the listing's availability lock", async () => {
    expect((await block()).status).toBe(201);
    expect(state.log).toEqual(["lock:listing_1", "availability-read", "block-create", "unlock:listing_1"]);
    // A room type's block is checked against listing-wide blocks too.
    expect(state.blockFindManyWhere).toEqual({ OR: [{ roomTypeId: "rt_1" }, { listingId: "listing_1", roomTypeId: null }] });
  });

  it("refuses dates a booking already holds", async () => {
    state.bookings = [{ checkIn: new Date("2027-03-02"), checkOut: new Date("2027-03-04") }];
    expect((await block()).status).toBe(409);
    expect(state.log).not.toContain("block-create");
  });
});
