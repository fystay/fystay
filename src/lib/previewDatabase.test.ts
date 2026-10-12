import { describe, expect, it } from "vitest";
import { previewMigrationDecision } from "./previewDatabase";

const ref = "sqkpixwvugrxllrxlexs";
const pooled = `postgresql://fystay_preview_app.${ref}:pw@aws-1-eu-west-1.pooler.supabase.com:6543/postgres?pgbouncer=true&schema=fystay_preview`;
const session = `postgresql://fystay_preview_app.${ref}:pw@aws-1-eu-west-1.pooler.supabase.com:5432/postgres?schema=fystay_preview`;
const ready = { VERCEL: "1", VERCEL_ENV: "preview", PREVIEW_DB_MIGRATE: "1", DATABASE_URL: pooled, DIRECT_URL: session };

describe("previewMigrationDecision", () => {
  it("migrates an opted-in Preview build pointed at the Backup project's Preview schema", () => {
    expect(previewMigrationDecision(ready)).toEqual({ run: true, seed: false });
    expect(previewMigrationDecision({ ...ready, PREVIEW_DB_SEED: "1" })).toEqual({ run: true, seed: true });
  });

  it("never runs on a Production build, even when asked to", () => {
    expect(previewMigrationDecision({ ...ready, VERCEL_ENV: "production" }).run).toBe(false);
  });

  it("does nothing on a local or CI build, or a Preview that didn't opt in", () => {
    expect(previewMigrationDecision({ DATABASE_URL: pooled, DIRECT_URL: session }).run).toBe(false);
    expect(previewMigrationDecision({ ...ready, PREVIEW_DB_MIGRATE: undefined }).run).toBe(false);
  });

  it("refuses anything that names the production project", () => {
    const prod = session.replaceAll(ref, "wzatjhyfwtmxdxfmurkm");
    expect(() => previewMigrationDecision({ ...ready, DIRECT_URL: prod })).toThrow(/production project/);
    expect(() => previewMigrationDecision({ ...ready, NEXT_PUBLIC_SUPABASE_URL: "https://wzatjhyfwtmxdxfmurkm.supabase.co" })).toThrow(
      /production project/,
    );
  });

  it("refuses the public schema, the backup's other schemas, or no schema at all", () => {
    expect(() => previewMigrationDecision({ ...ready, DIRECT_URL: session.replace("schema=fystay_preview", "schema=public") })).toThrow(
      /schema=fystay_preview/,
    );
    expect(() => previewMigrationDecision({ ...ready, DATABASE_URL: pooled.replace("&schema=fystay_preview", "") })).toThrow(
      /schema=fystay_preview/,
    );
  });

  it("refuses any login other than the restricted Preview one, such as postgres", () => {
    expect(() => previewMigrationDecision({ ...ready, DIRECT_URL: session.replace("fystay_preview_app.", "postgres.") })).toThrow(
      /fystay_preview_app/,
    );
  });

  it("refuses another Supabase project, and the transaction pooler for migrations", () => {
    expect(() => previewMigrationDecision({ ...ready, DIRECT_URL: session.replace(ref, "someotherproject1234") })).toThrow(/Backup project/);
    expect(() => previewMigrationDecision({ ...ready, DIRECT_URL: pooled })).toThrow(/port 5432/);
  });

  it("refuses when a connection string is missing, without ever echoing a value", () => {
    let message = "";
    try {
      previewMigrationDecision({ ...ready, DIRECT_URL: undefined, DATABASE_URL: pooled.replace("pw@", "s3cret@").replace(ref, "x") });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/DIRECT_URL is not set/);
    expect(message).not.toMatch(/s3cret/);
  });
});
