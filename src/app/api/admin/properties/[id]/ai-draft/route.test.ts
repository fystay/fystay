import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { authMock, findUnique, draftMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  findUnique: vi.fn(),
  draftMock: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: () => authMock() }));
vi.mock("@/lib/prisma", () => ({ prisma: { listing: { findUnique } } }));
vi.mock("@/lib/rateLimit", () => ({ checkRateLimit: async () => ({ allowed: true }), rateLimitedResponse: vi.fn() }));
vi.mock("@/lib/listingAiDraft", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/listingAiDraft")>()),
  draftListingWithAi: (...a: unknown[]) => draftMock(...a),
}));

import { POST } from "./route";

const notes = "Two-bed flat on the prom with sea views, wifi and parking.";
const call = (body: object = { notes }) =>
  POST(new Request("http://localhost/api/admin/properties/l1/ai-draft", { method: "POST", body: JSON.stringify(body) }), {
    params: Promise.resolve({ id: "l1" }),
  });

beforeEach(() => {
  authMock.mockReset().mockResolvedValue({ user: { id: "admin_1", role: "ADMIN" } });
  findUnique.mockReset().mockResolvedValue({ preparedById: "admin_1", city: "Blackpool", propertyType: "APARTMENT" });
  draftMock.mockReset().mockResolvedValue({ title: "Sea-view flat", description: "A bright flat.", amenities: ["Wifi"] });
  vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");
});
afterEach(() => vi.unstubAllEnvs());

describe("POST /api/admin/properties/[id]/ai-draft", () => {
  it("is for admins only", async () => {
    authMock.mockResolvedValue({ user: { id: "h1", role: "HOST" } });
    expect((await call()).status).toBe(403);
    expect(draftMock).not.toHaveBeenCalled();
  });

  it("answers 503 until the API key is set", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    expect((await call()).status).toBe(503);
    expect(draftMock).not.toHaveBeenCalled();
  });

  it("only drafts listings FYStay prepared", async () => {
    findUnique.mockResolvedValue({ preparedById: null, city: "Blackpool", propertyType: "APARTMENT" });
    expect((await call()).status).toBe(404);
  });

  it("refuses notes too short to draft from", async () => {
    expect((await call({ notes: "nice flat" })).status).toBe(400);
    expect(draftMock).not.toHaveBeenCalled();
  });

  it("returns the draft without saving it", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ draft: { title: "Sea-view flat", description: "A bright flat.", amenities: ["Wifi"] } });
    expect(draftMock).toHaveBeenCalledWith({ notes, city: "Blackpool", propertyType: "APARTMENT" });
  });
});
