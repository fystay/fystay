import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockSeedDemoData = vi.fn();
vi.mock("@/lib/demoSeed", () => ({ seedDemoData: (...args: unknown[]) => mockSeedDemoData(...args) }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const { GET, POST } = await import("./route");

const SECRET = "test-seed-secret";

function req(secret: string | null, method = "GET"): Request {
  const url = secret === null
    ? "http://localhost:3000/api/admin/seed-demo-data"
    : `http://localhost:3000/api/admin/seed-demo-data?secret=${secret}`;
  return new Request(url, { method });
}

const originalEnv = { ...process.env };

beforeEach(() => {
  process.env = { ...originalEnv, SEED_ADMIN_SECRET: SECRET };
  delete process.env.VERCEL_ENV;
  delete process.env.ALLOW_PRODUCTION_SEED;
  mockSeedDemoData.mockReset().mockResolvedValue({ listingsCreated: 0 });
});

afterEach(() => {
  process.env = originalEnv;
});

describe("/api/admin/seed-demo-data", () => {
  it("returns 501 and never seeds when SEED_ADMIN_SECRET isn't configured", async () => {
    delete process.env.SEED_ADMIN_SECRET;
    const res = await GET(req(SECRET));
    expect(res.status).toBe(501);
    expect(mockSeedDemoData).not.toHaveBeenCalled();
  });

  it("returns 401 and never seeds with a wrong secret, even in production", async () => {
    process.env.VERCEL_ENV = "production";
    const res = await GET(req("wrong"));
    expect(res.status).toBe(401);
    expect(mockSeedDemoData).not.toHaveBeenCalled();
  });

  it("refuses with 403 on a production deployment, even with the right secret", async () => {
    process.env.VERCEL_ENV = "production";
    for (const handler of [GET, POST]) {
      const res = await handler(req(SECRET, handler === GET ? "GET" : "POST"));
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error).toBe("Demo seeding is disabled in production.");
    }
    expect(mockSeedDemoData).not.toHaveBeenCalled();
  });

  it("seeds on production only with the explicit ALLOW_PRODUCTION_SEED=true override", async () => {
    process.env.VERCEL_ENV = "production";
    process.env.ALLOW_PRODUCTION_SEED = "true";
    const res = await GET(req(SECRET));
    expect(res.status).toBe(200);
    expect(mockSeedDemoData).toHaveBeenCalledTimes(1);
  });

  it("still seeds normally outside production (preview and local)", async () => {
    process.env.VERCEL_ENV = "preview";
    expect((await GET(req(SECRET))).status).toBe(200);
    delete process.env.VERCEL_ENV;
    expect((await POST(req(SECRET, "POST"))).status).toBe(200);
    expect(mockSeedDemoData).toHaveBeenCalledTimes(2);
  });
});
