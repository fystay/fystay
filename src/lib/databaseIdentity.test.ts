import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertNoProductionDatabaseOutsideProduction,
  BUILD_TIME_DATABASE_URL,
  findProductionDatabaseVariables,
  isNextProductionBuild,
  PRODUCTION_SUPABASE_PROJECT_REF,
  productionDatabaseRefusal,
} from "./databaseIdentity";

// storage.ts imports "server-only", which throws outside a React server
// build; the runtime-wiring tests below import the real module.
vi.mock("server-only", () => ({}));

const PROD = PRODUCTION_SUPABASE_PROJECT_REF;
const PREVIEW = "previewprojectref000";
const PASSWORD = "s3cret-password-value";

// Shaped like the real Supabase values, with made-up passwords/signatures.
function credentials(ref: string) {
  return {
    DATABASE_URL: `postgresql://postgres.${ref}:${PASSWORD}@aws-1-eu-west-1.pooler.supabase.com:6543/postgres?pgbouncer=true`,
    DIRECT_URL: `postgresql://postgres.${ref}:${PASSWORD}@aws-1-eu-west-1.pooler.supabase.com:5432/postgres`,
    PMS_HOST_SCOPED_DATABASE_URL: `postgresql://fystay_pms_host_scoped.${ref}:${PASSWORD}@aws-1-eu-west-1.pooler.supabase.com:6543/postgres`,
    NEXT_PUBLIC_SUPABASE_URL: `https://${ref}.supabase.co`,
    SUPABASE_SERVICE_ROLE_KEY: legacyServiceRoleKey(ref),
  };
}

function base64Url(value: string): string {
  return Buffer.from(value).toString("base64url");
}

/** A legacy service_role JWT: the ref only appears base64-encoded inside the payload. */
function legacyServiceRoleKey(ref: string): string {
  return [
    base64Url(JSON.stringify({ alg: "HS256", typ: "JWT" })),
    base64Url(JSON.stringify({ iss: "supabase", ref, role: "service_role", iat: 1700000000 })),
    "c2lnbmF0dXJl",
  ].join(".");
}

describe("findProductionDatabaseVariables", () => {
  it("names every variable that points at the production project", () => {
    expect(findProductionDatabaseVariables(credentials(PROD))).toEqual([
      "DATABASE_URL",
      "DIRECT_URL",
      "PMS_HOST_SCOPED_DATABASE_URL",
      "NEXT_PUBLIC_SUPABASE_URL",
      "SUPABASE_SERVICE_ROLE_KEY",
    ]);
  });

  it("finds nothing in a complete set of preview-project credentials", () => {
    expect(findProductionDatabaseVariables(credentials(PREVIEW))).toEqual([]);
  });

  it("recognises the direct-connection host form and is case-insensitive", () => {
    expect(
      findProductionDatabaseVariables({
        DIRECT_URL: `postgresql://postgres:${PASSWORD}@db.${PROD.toUpperCase()}.supabase.co:5432/postgres`,
      }),
    ).toEqual(["DIRECT_URL"]);
  });

  it("decodes a legacy service_role JWT, where the ref is not visible as plain text", () => {
    const key = legacyServiceRoleKey(PROD);
    expect(key.includes(PROD)).toBe(false);
    expect(findProductionDatabaseVariables({ SUPABASE_SERVICE_ROLE_KEY: key })).toEqual([
      "SUPABASE_SERVICE_ROLE_KEY",
    ]);
  });

  it("can't identify an sb_secret_ key on its own - the Supabase URL beside it does", () => {
    expect(findProductionDatabaseVariables({ SUPABASE_SERVICE_ROLE_KEY: "sb_secret_abc123" })).toEqual([]);
    expect(
      findProductionDatabaseVariables({
        SUPABASE_SERVICE_ROLE_KEY: "sb_secret_abc123",
        NEXT_PUBLIC_SUPABASE_URL: `https://${PROD}.supabase.co`,
      }),
    ).toEqual(["NEXT_PUBLIC_SUPABASE_URL"]);
  });

  it("ignores unset, empty and malformed values", () => {
    expect(
      findProductionDatabaseVariables({
        DATABASE_URL: "",
        SUPABASE_SERVICE_ROLE_KEY: "not.a.jwt",
        NEXT_PUBLIC_SUPABASE_URL: undefined,
      }),
    ).toEqual([]);
  });

  it("only inspects the database and Supabase variables", () => {
    expect(findProductionDatabaseVariables({ SOMETHING_ELSE: `https://${PROD}.supabase.co` })).toEqual([]);
  });
});

describe("productionDatabaseRefusal", () => {
  it("refuses a preview deployment holding production credentials", () => {
    const refusal = productionDatabaseRefusal({ VERCEL: "1", VERCEL_ENV: "preview", ...credentials(PROD) });
    expect(refusal).toContain("Refusing to run");
    expect(refusal).toContain("DATABASE_URL");
    expect(refusal).toContain("VERCEL_ENV=preview");
  });

  it("refuses when even one variable still points at production", () => {
    const env = { VERCEL: "1", VERCEL_ENV: "preview", ...credentials(PREVIEW), DIRECT_URL: credentials(PROD).DIRECT_URL };
    expect(productionDatabaseRefusal(env)).toContain("DIRECT_URL");
  });

  it("never includes a credential value in the message", () => {
    const refusal = productionDatabaseRefusal({ VERCEL: "1", VERCEL_ENV: "preview", ...credentials(PROD) }) ?? "";
    expect(refusal).not.toContain(PASSWORD);
    expect(refusal).not.toContain(credentials(PROD).SUPABASE_SERVICE_ROLE_KEY);
  });

  it("refuses Vercel development deployments too", () => {
    expect(productionDatabaseRefusal({ VERCEL: "1", VERCEL_ENV: "development", ...credentials(PROD) })).not.toBeNull();
  });

  it("fails closed on Vercel when VERCEL_ENV is missing", () => {
    expect(productionDatabaseRefusal({ VERCEL: "1", ...credentials(PROD) })).toContain("VERCEL_ENV=unset");
  });

  it("allows production credentials on the production deployment", () => {
    expect(productionDatabaseRefusal({ VERCEL: "1", VERCEL_ENV: "production", ...credentials(PROD) })).toBeNull();
  });

  it("allows a preview deployment using its own project", () => {
    expect(productionDatabaseRefusal({ VERCEL: "1", VERCEL_ENV: "preview", ...credentials(PREVIEW) })).toBeNull();
  });

  it("leaves local runs alone (operator CLIs deliberately target production from a terminal)", () => {
    expect(productionDatabaseRefusal({ ...credentials(PROD) })).toBeNull();
    expect(productionDatabaseRefusal({ VERCEL_ENV: "preview", ...credentials(PROD) })).toBeNull();
  });
});

describe("assertNoProductionDatabaseOutsideProduction", () => {
  it("throws the refusal", () => {
    expect(() =>
      assertNoProductionDatabaseOutsideProduction({ VERCEL: "1", VERCEL_ENV: "preview", ...credentials(PROD) }),
    ).toThrow(/Refusing to run/);
  });

  it("does nothing when the configuration is sound", () => {
    expect(() =>
      assertNoProductionDatabaseOutsideProduction({ VERCEL: "1", VERCEL_ENV: "preview", ...credentials(PREVIEW) }),
    ).not.toThrow();
  });
});

// The real modules, not just the pure function: on Vercel, serverless
// functions don't re-evaluate next.config.ts, so these are the runtime layer.
describe("runtime wiring on a misconfigured preview deployment", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  function stubPreviewWithProductionCredentials() {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("VERCEL_ENV", "preview");
    for (const [name, value] of Object.entries(credentials(PROD))) vi.stubEnv(name, value);
  }

  it("src/lib/prisma.ts refuses to load, before any client is created", async () => {
    stubPreviewWithProductionCredentials();
    vi.resetModules();
    await expect(import("./prisma")).rejects.toThrow(/Refusing to run/);
  });

  it("src/lib/storage.ts refuses to use the production service-role key", async () => {
    stubPreviewWithProductionCredentials();
    vi.resetModules();
    const { uploadUserAvatar } = await import("./storage");
    const file = new File(["x"], "avatar.png", { type: "image/png" });
    await expect(uploadUserAvatar(file, "user-1")).rejects.toThrow(/Refusing to run/);
  });

  it("src/lib/prisma.ts loads normally for a preview deployment on its own project", async () => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("VERCEL_ENV", "preview");
    for (const [name, value] of Object.entries(credentials(PREVIEW))) vi.stubEnv(name, value);
    vi.resetModules();
    const { prisma } = await import("./prisma");
    expect(prisma).toBeDefined();
  });
});

describe("build-time database access", () => {
  it("detects next build only by its own phase value", () => {
    expect(isNextProductionBuild({ NEXT_PHASE: "phase-production-build" })).toBe(true);
    expect(isNextProductionBuild({ NEXT_PHASE: "phase-production-server" })).toBe(false);
    expect(isNextProductionBuild({})).toBe(false);
  });

  it("points at a reserved, unresolvable host", () => {
    expect(new URL(BUILD_TIME_DATABASE_URL).hostname.endsWith(".invalid")).toBe(true);
  });
});
