import { beforeEach, describe, expect, it, vi } from "vitest";

const { state, fetchPage, extract } = vi.hoisted(() => ({
  state: { session: null as null | { user: { id: string; role: string } }, configured: true },
  fetchPage: vi.fn(),
  extract: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: async () => state.session }));
vi.mock("@/lib/rateLimit", () => ({ checkRateLimit: async () => ({ allowed: true }), rateLimitedResponse: vi.fn() }));
vi.mock("@/lib/listingAiDraft", () => ({ isListingAiDraftConfigured: () => state.configured }));
vi.mock("@/lib/listingImport", async (original) => ({
  ...(await original<typeof import("@/lib/listingImport")>()),
  fetchPublicListingText: fetchPage,
  extractListingWithAi: extract,
}));

import { POST } from "./route";

const call = (body: unknown) => POST(new Request("http://x", { method: "POST", body: JSON.stringify(body) }));
const TEXT = "Two-bedroom flat in Blackpool, sleeps four, wifi, £95 a night. ".repeat(2);

beforeEach(() => {
  state.session = { user: { id: "admin_1", role: "ADMIN" } };
  state.configured = true;
  fetchPage.mockReset();
  extract.mockReset().mockResolvedValue({ draft: { title: "Flat" }, missing: [], uncertain: [] });
});

describe("POST /api/admin/properties/import", () => {
  it("is admin-only", async () => {
    state.session = null;
    expect((await call({ text: TEXT })).status).toBe(401);
    state.session = { user: { id: "host_1", role: "HOST" } };
    expect((await call({ text: TEXT })).status).toBe(403);
    expect(extract).not.toHaveBeenCalled();
  });

  it("is off without the AI key", async () => {
    state.configured = false;
    expect((await call({ text: TEXT })).status).toBe(503);
  });

  it("reads pasted text without fetching anything", async () => {
    const res = await call({ text: TEXT, url: "https://example.test/rooms/1" });
    expect(res.status).toBe(200);
    expect(fetchPage).not.toHaveBeenCalled();
    expect(extract).toHaveBeenCalledWith({ text: TEXT.trim(), sourceUrl: "https://example.test/rooms/1" });
  });

  it("asks for pasted text when a page can't be read", async () => {
    fetchPage.mockResolvedValue({ ok: false, reason: "example.test blocked the request. Paste instead." });
    const res = await call({ url: "https://example.test/rooms/1" });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ needsText: true });
    expect(extract).not.toHaveBeenCalled();
  });

  it("needs a link or enough text", async () => {
    expect((await call({ text: "short" })).status).toBe(400);
  });
});
