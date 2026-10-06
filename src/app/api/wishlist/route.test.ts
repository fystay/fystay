import { beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.fn();
const findListing = vi.fn();
const findSaved = vi.fn();
const createSaved = vi.fn();
const deleteSaved = vi.fn();

vi.mock("@/auth", () => ({ auth: () => session() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    listing: { findUnique: (...a: unknown[]) => findListing(...a) },
    savedListing: {
      findUnique: (...a: unknown[]) => findSaved(...a),
      create: (...a: unknown[]) => createSaved(...a),
      delete: (...a: unknown[]) => deleteSaved(...a),
    },
  },
}));

import { POST } from "./route";

const call = (body: object) =>
  POST(
    new Request("http://x/api/wishlist", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

beforeEach(() => {
  session.mockReset().mockResolvedValue({ user: { id: "guest_1" } });
  findListing.mockReset().mockResolvedValue({ id: "listing_1" });
  findSaved.mockReset().mockResolvedValue(null);
  createSaved.mockReset().mockResolvedValue({});
  deleteSaved.mockReset().mockResolvedValue({});
});

describe("POST /api/wishlist", () => {
  it("needs a signed-in guest", async () => {
    session.mockResolvedValue(null);
    expect((await call({ listingId: "listing_1" })).status).toBe(401);
  });

  it("toggles when no state is given: saves, then unsaves", async () => {
    expect(await (await call({ listingId: "listing_1" })).json()).toEqual({ saved: true });
    expect(createSaved).toHaveBeenCalledTimes(1);

    findSaved.mockResolvedValue({ id: "saved_1" });
    expect(await (await call({ listingId: "listing_1" })).json()).toEqual({ saved: false });
    expect(deleteSaved).toHaveBeenCalledTimes(1);
  });

  it("with saved: true, saves once and never undoes an existing save", async () => {
    expect(await (await call({ listingId: "listing_1", saved: true })).json()).toEqual({ saved: true });
    expect(createSaved).toHaveBeenCalledTimes(1);

    findSaved.mockResolvedValue({ id: "saved_1" });
    expect(await (await call({ listingId: "listing_1", saved: true })).json()).toEqual({ saved: true });
    expect(createSaved).toHaveBeenCalledTimes(1);
    expect(deleteSaved).not.toHaveBeenCalled();
  });
});
