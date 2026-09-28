import { beforeEach, describe, expect, it, vi } from "vitest";

// registry.ts pulls in cache.ts, which imports prisma - never touched here.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const {
  createProviderRow,
  describeDatabaseTarget,
  formatDatabaseTarget,
  listProviderOverview,
  setProviderStatus,
} = await import("./providerAdmin");
const { LIVE_HOTEL_PROVIDER_CODES, listRegisteredHotelProviders } = await import("./registry");
const { bookingComAdapter } = await import("./providers/bookingCom");

const mockFindMany = vi.fn();
const mockFindUnique = vi.fn();
const mockCreate = vi.fn();
const mockUpdate = vi.fn();
const db = {
  hotelProvider: {
    findMany: (...args: unknown[]) => mockFindMany(...args),
    findUnique: (...args: unknown[]) => mockFindUnique(...args),
    create: (...args: unknown[]) => mockCreate(...args),
    update: (...args: unknown[]) => mockUpdate(...args),
  },
} as unknown as Parameters<typeof listProviderOverview>[0];

const target = { host: "db.internal.example", port: "5432", database: "fystay" };
const dryRun = { apply: false, target };
const confirmed = { apply: true, confirmHost: "db.internal.example", target };

beforeEach(() => {
  mockFindMany.mockReset().mockResolvedValue([]);
  mockFindUnique.mockReset().mockResolvedValue(null);
  mockCreate.mockReset().mockResolvedValue({});
  mockUpdate.mockReset().mockResolvedValue({});
});

describe("describeDatabaseTarget", () => {
  it("returns host, port and database only - never the credentials", () => {
    const parsed = describeDatabaseTarget("postgresql://admin:sup3r-s3cret@db.internal.example:6543/fystay?schema=public");
    expect(parsed).toEqual({ host: "db.internal.example", port: "6543", database: "fystay" });
    const shown = formatDatabaseTarget(parsed!);
    expect(shown).toBe("db.internal.example:6543/fystay");
    expect(shown).not.toContain("sup3r-s3cret");
    expect(shown).not.toContain("admin");
  });

  it("returns null for a missing or unparseable URL", () => {
    expect(describeDatabaseTarget(undefined)).toBeNull();
    expect(describeDatabaseTarget("not a url")).toBeNull();
  });
});

describe("listProviderOverview", () => {
  it("shows every registered adapter and each row's decision for both non-production and production", async () => {
    mockFindMany.mockResolvedValue([
      { code: "mock", status: "ACTIVE" },
      { code: "booking_com", status: "ACTIVE" },
      { code: "legacy_provider", status: "ACTIVE" },
    ]);
    const overview = await listProviderOverview(db);
    const byCode = Object.fromEntries(overview.map((row) => [row.code, row]));

    expect(byCode.mock).toMatchObject({
      registered: true,
      fixture: true,
      nonProduction: "operational",
      production: "not operational (fixture_in_production)",
    });
    expect(byCode.booking_com).toMatchObject({
      registered: true,
      liveListed: false,
      nonProduction: "not operational (not_live_listed)",
      production: "not operational (not_live_listed)",
    });
    expect(byCode.legacy_provider).toMatchObject({ registered: false, production: "not operational (not_registered)" });
  });

  it("lists registered adapters that have no database row yet", async () => {
    const overview = await listProviderOverview(db);
    expect(overview.map((row) => row.code).sort()).toEqual(listRegisteredHotelProviders().map((p) => p.code).sort());
    expect(overview.every((row) => row.dbStatus === null && row.production === "no database row")).toBe(true);
  });
});

describe("createProviderRow", () => {
  it("refuses a code with no registered adapter", async () => {
    const result = await createProviderRow(db, "expedia", confirmed);
    expect(result.ok).toBe(false);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("refuses when a row already exists", async () => {
    mockFindUnique.mockResolvedValue({ status: "INACTIVE" });
    const result = await createProviderRow(db, "booking_com", confirmed);
    expect(result.ok).toBe(false);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("writes nothing on a dry run", async () => {
    const result = await createProviderRow(db, "booking_com", dryRun);
    expect(result.ok).toBe(true);
    expect(result.lines.join("\n")).toContain("Dry run - nothing was written");
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("refuses --apply unless --confirm-host matches the target host exactly", async () => {
    for (const confirmHost of [undefined, "", "localhost", "DB.INTERNAL.EXAMPLE", "db.internal.example:5432"]) {
      const result = await createProviderRow(db, "booking_com", { apply: true, confirmHost, target });
      expect(result.ok).toBe(false);
    }
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("refuses --apply when the target has no host at all", async () => {
    const result = await createProviderRow(db, "booking_com", { apply: true, confirmHost: "", target: { ...target, host: "" } });
    expect(result.ok).toBe(false);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("always creates the row INACTIVE, with name and flags copied from the adapter", async () => {
    const result = await createProviderRow(db, "booking_com", confirmed);
    expect(result.ok).toBe(true);
    expect(mockCreate).toHaveBeenCalledWith({
      data: {
        code: "booking_com",
        name: bookingComAdapter.name,
        status: "INACTIVE",
        supportsSearch: bookingComAdapter.supportsSearch,
        supportsDeepLink: bookingComAdapter.supportsDeepLink,
        supportsClickTracking: bookingComAdapter.supportsClickTracking,
        supportsConversionTracking: bookingComAdapter.supportsConversionTracking,
      },
    });
  });
});

describe("setProviderStatus", () => {
  it("rejects an unknown status, an unregistered code, or a missing row without writing", async () => {
    expect((await setProviderStatus(db, "mock", "LIVE", confirmed)).ok).toBe(false);
    expect((await setProviderStatus(db, "expedia", "ACTIVE", confirmed)).ok).toBe(false);
    expect((await setProviderStatus(db, "booking_com", "ACTIVE", confirmed)).ok).toBe(false);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("is a no-op when the status is already set", async () => {
    mockFindUnique.mockResolvedValue({ status: "ACTIVE" });
    const result = await setProviderStatus(db, "mock", "ACTIVE", confirmed);
    expect(result).toEqual({ ok: true, lines: ['"mock" is already ACTIVE - nothing to change.'] });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("shows that ACTIVE does not make booking_com operational anywhere, because it isn't live-listed", async () => {
    expect(LIVE_HOTEL_PROVIDER_CODES).not.toContain("booking_com");
    mockFindUnique.mockResolvedValue({ status: "INACTIVE" });
    const result = await setProviderStatus(db, "booking_com", "ACTIVE", dryRun);
    const text = result.lines.join("\n");
    expect(text).toContain("non-production: not operational (not_live_listed)");
    expect(text).toContain("production:     not operational (not_live_listed)");
    expect(text).toContain("not in LIVE_HOTEL_PROVIDER_CODES");
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("warns that mock is never operational in production", async () => {
    mockFindUnique.mockResolvedValue({ status: "INACTIVE" });
    const text = (await setProviderStatus(db, "mock", "ACTIVE", dryRun)).lines.join("\n");
    expect(text).toContain("production:     not operational (fixture_in_production)");
    expect(text).toContain("never operational on a production deployment");
  });

  it("refuses --apply with a mismatched host, and writes only with a confirmed one", async () => {
    mockFindUnique.mockResolvedValue({ status: "ACTIVE" });
    const refused = await setProviderStatus(db, "mock", "INACTIVE", { apply: true, confirmHost: "localhost", target });
    expect(refused.ok).toBe(false);
    expect(mockUpdate).not.toHaveBeenCalled();

    const applied = await setProviderStatus(db, "mock", "INACTIVE", confirmed);
    expect(applied.ok).toBe(true);
    expect(mockUpdate).toHaveBeenCalledWith({ where: { code: "mock" }, data: { status: "INACTIVE" } });
  });
});

describe("listRegisteredHotelProviders", () => {
  it("exposes identity and capability flags only, never a callable adapter", () => {
    for (const provider of listRegisteredHotelProviders()) {
      expect(Object.keys(provider).sort()).toEqual(
        ["code", "name", "supportsClickTracking", "supportsConversionTracking", "supportsDeepLink", "supportsSearch"].sort(),
      );
    }
  });
});
