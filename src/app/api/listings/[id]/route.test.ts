import { beforeEach, describe, expect, it, vi } from "vitest";

const { state, listingDelete } = vi.hoisted(() => ({
  state: { hostId: "host_1", bookingsToKeep: 0 },
  listingDelete: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: async () => ({ user: { id: "host_1", role: "HOST" } }) }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    listing: {
      findUnique: async () => ({ id: "listing_1", hostId: state.hostId }),
      delete: (...a: unknown[]) => listingDelete(...a),
    },
    booking: { count: async () => state.bookingsToKeep },
  },
}));

import { DELETE } from "./route";

const del = () => DELETE(new Request("http://x", { method: "DELETE" }), { params: Promise.resolve({ id: "listing_1" }) });

beforeEach(() => {
  state.hostId = "host_1";
  state.bookingsToKeep = 0;
  listingDelete.mockReset();
});

describe("DELETE /api/listings/[id]", () => {
  it("deletes a listing no guest has booked", async () => {
    expect((await del()).status).toBe(200);
    expect(listingDelete).toHaveBeenCalledTimes(1);
  });

  it("refuses to delete a listing with bookings, so their records survive", async () => {
    state.bookingsToKeep = 2;
    const res = await del();
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("listing_has_bookings");
    expect(listingDelete).not.toHaveBeenCalled();
  });

  it("refuses another host", async () => {
    state.hostId = "someone_else";
    expect((await del()).status).toBe(403);
    expect(listingDelete).not.toHaveBeenCalled();
  });
});
