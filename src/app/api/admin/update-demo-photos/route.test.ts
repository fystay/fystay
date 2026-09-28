import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockUpdateCoverPhotos = vi.fn();
vi.mock("@/lib/demoSeed", () => ({
  updateDemoListingCoverPhotos: (...args: unknown[]) => mockUpdateCoverPhotos(...args),
}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const { GET, POST } = await import("./route");

const SECRET = "test-seed-secret";

function req(secret: string | null, method = "GET"): Request {
  const url = secret === null
    ? "http://localhost:3000/api/admin/update-demo-photos"
    : `http://localhost:3000/api/admin/update-demo-photos?secret=${secret}`;
  return new Request(url, { method });
}

const originalEnv = { ...process.env };

beforeEach(() => {
  process.env = { ...originalEnv, SEED_ADMIN_SECRET: SECRET };
  delete process.env.VERCEL_ENV;
  delete process.env.ALLOW_PRODUCTION_SEED;
  mockUpdateCoverPhotos.mockReset().mockResolvedValue([]);
});

afterEach(() => {
  process.env = originalEnv;
});

describe("/api/admin/update-demo-photos", () => {
  it("returns 501 and never updates when SEED_ADMIN_SECRET isn't configured", async () => {
    delete process.env.SEED_ADMIN_SECRET;
    const res = await GET(req(SECRET));
    expect(res.status).toBe(501);
    expect(mockUpdateCoverPhotos).not.toHaveBeenCalled();
  });

  it("returns 401 (not 403) and never updates with a wrong or missing secret, even in production", async () => {
    process.env.VERCEL_ENV = "production";
    expect((await GET(req("wrong"))).status).toBe(401);
    expect((await POST(req(null, "POST"))).status).toBe(401);
    expect(mockUpdateCoverPhotos).not.toHaveBeenCalled();
  });

  it("refuses with 403 on a production deployment, even with the right secret", async () => {
    process.env.VERCEL_ENV = "production";
    for (const handler of [GET, POST]) {
      const res = await handler(req(SECRET, handler === GET ? "GET" : "POST"));
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error).toBe("Demo photo updates are disabled in production.");
    }
    expect(mockUpdateCoverPhotos).not.toHaveBeenCalled();
  });

  it("refuses on production for any override value other than exactly 'true'", async () => {
    process.env.VERCEL_ENV = "production";
    for (const value of ["1", "yes", "TRUE", ""]) {
      process.env.ALLOW_PRODUCTION_SEED = value;
      expect((await GET(req(SECRET))).status).toBe(403);
    }
    expect(mockUpdateCoverPhotos).not.toHaveBeenCalled();
  });

  it("updates on production only with the explicit ALLOW_PRODUCTION_SEED=true override", async () => {
    process.env.VERCEL_ENV = "production";
    process.env.ALLOW_PRODUCTION_SEED = "true";
    const res = await GET(req(SECRET));
    expect(res.status).toBe(200);
    expect(mockUpdateCoverPhotos).toHaveBeenCalledTimes(1);
  });

  it("still updates normally outside production (preview and local), via the header as well as the query", async () => {
    process.env.VERCEL_ENV = "preview";
    expect((await GET(req(SECRET))).status).toBe(200);
    delete process.env.VERCEL_ENV;
    const viaHeader = new Request("http://localhost:3000/api/admin/update-demo-photos", {
      method: "POST",
      headers: { "x-seed-secret": SECRET },
    });
    expect((await POST(viaHeader)).status).toBe(200);
    expect(mockUpdateCoverPhotos).toHaveBeenCalledTimes(2);
  });
});
