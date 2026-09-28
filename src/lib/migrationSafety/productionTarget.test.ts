import { describe, expect, it } from "vitest";
import { RETIRED_MIGRATIONS } from "./history";
import {
  connectionStringProblems,
  databaseFactsProblems,
  EXPECTED_PRODUCTION_DATABASE,
  valuesToMask,
  type DatabaseFacts,
} from "./productionTarget";

const REF = EXPECTED_PRODUCTION_DATABASE.projectRef;
const PASSWORD = "p@ss/word with spaces";
const ENCODED = encodeURIComponent(PASSWORD);

const SESSION_POOLER = `postgresql://postgres.${REF}:${ENCODED}@aws-1-eu-west-1.pooler.supabase.com:5432/postgres`;
const DIRECT = `postgresql://postgres:${ENCODED}@db.${REF}.supabase.co:5432/postgres`;
const TRANSACTION_POOLER = `postgresql://postgres.${REF}:${ENCODED}@aws-1-eu-west-1.pooler.supabase.com:6543/postgres?pgbouncer=true`;

describe("connectionStringProblems", () => {
  it("accepts production's session pooler and direct connections", () => {
    expect(connectionStringProblems(SESSION_POOLER)).toEqual([]);
    expect(connectionStringProblems(DIRECT)).toEqual([]);
  });

  it("refuses the transaction pooler (the app's runtime URL)", () => {
    const problems = connectionStringProblems(TRANSACTION_POOLER);
    expect(problems.some((p) => p.includes("port 6543"))).toBe(true);
    expect(problems.some((p) => p.includes("pgbouncer=true"))).toBe(true);
  });

  it("refuses any other project - a preview project, or a local database", () => {
    expect(connectionStringProblems(SESSION_POOLER.replace(REF, "previewprojectref000"))[0]).toContain(
      "doesn't identify the production Supabase project",
    );
    expect(connectionStringProblems("postgresql://fystay:fystay@localhost:5432/postgres")[0]).toContain(
      "doesn't identify the production Supabase project",
    );
  });

  it("refuses a different database on the right project", () => {
    expect(connectionStringProblems(SESSION_POOLER.replace(/\/postgres$/, "/other"))).toEqual([
      'PROD_DIRECT_URL names database "other", expected "postgres".',
    ]);
  });

  it("refuses empty, malformed and non-postgres values", () => {
    expect(connectionStringProblems(undefined)[0]).toContain("empty");
    expect(connectionStringProblems("")[0]).toContain("empty");
    expect(connectionStringProblems("not a url")).toEqual(["PROD_DIRECT_URL isn't a valid URL."]);
    expect(connectionStringProblems(`mysql://u:p@db.${REF}.supabase.co:5432/postgres`)[0]).toContain(
      "isn't a postgresql://",
    );
  });

  it("never repeats any part of the credential", () => {
    for (const url of [SESSION_POOLER, TRANSACTION_POOLER, SESSION_POOLER.replace(REF, "x"), "not a url"]) {
      for (const problem of connectionStringProblems(url)) {
        expect(problem).not.toContain(PASSWORD);
        expect(problem).not.toContain(ENCODED);
      }
    }
  });
});

describe("valuesToMask", () => {
  it("masks both the encoded and decoded password", () => {
    expect(valuesToMask(SESSION_POOLER).sort()).toEqual([ENCODED, PASSWORD].sort());
  });

  it("masks nothing it can't find", () => {
    expect(valuesToMask(undefined)).toEqual([]);
    expect(valuesToMask("not a url")).toEqual([]);
    expect(valuesToMask("postgresql://user@host:5432/postgres")).toEqual([]);
  });
});

const PRODUCTION_FACTS: DatabaseFacts = {
  database: "postgres",
  serverVersionNum: 170006,
  hasSupabaseAuthenticatorRole: true,
  hasSupabaseAuthSchema: true,
  eventTriggerEnabled: "O",
  hasMigrationsTable: true,
  retiredMigrationChecksum: RETIRED_MIGRATIONS[0].checksum,
};

describe("databaseFactsProblems", () => {
  it("accepts what production reports", () => {
    expect(databaseFactsProblems(PRODUCTION_FACTS)).toEqual([]);
  });

  it("refuses a wrong database or major version", () => {
    expect(databaseFactsProblems({ ...PRODUCTION_FACTS, database: "fystay" })[0]).toContain('"fystay"');
    expect(databaseFactsProblems({ ...PRODUCTION_FACTS, serverVersionNum: 160004 })[0]).toContain("PostgreSQL 16");
  });

  it("refuses a server that isn't Supabase", () => {
    expect(databaseFactsProblems({ ...PRODUCTION_FACTS, hasSupabaseAuthenticatorRole: false })[0]).toContain(
      "isn't a Supabase project",
    );
  });

  it("refuses a missing or disabled ensure_rls trigger", () => {
    expect(databaseFactsProblems({ ...PRODUCTION_FACTS, eventTriggerEnabled: null })[0]).toContain("missing");
    expect(databaseFactsProblems({ ...PRODUCTION_FACTS, eventTriggerEnabled: "D" })[0]).toContain("disabled");
  });

  it("refuses a never-migrated database, or one without production's history fingerprint (a fresh preview)", () => {
    expect(databaseFactsProblems({ ...PRODUCTION_FACTS, hasMigrationsTable: false })[0]).toContain("never been migrated");
    expect(databaseFactsProblems({ ...PRODUCTION_FACTS, retiredMigrationChecksum: null })[0]).toContain(
      "history fingerprint",
    );
  });
});
