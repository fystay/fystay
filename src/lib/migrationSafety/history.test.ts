import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  evaluateMigrationHistory,
  RETIRED_MIGRATIONS,
  type LocalMigration,
  type MigrationHistoryRow,
} from "./history";

// The real migrations in this repository.
const MIGRATIONS_DIR = join(process.cwd(), "prisma", "migrations");
const LOCAL: LocalMigration[] = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => ({
    name: entry.name,
    checksum: createHash("sha256")
      .update(readFileSync(join(MIGRATIONS_DIR, entry.name, "migration.sql")))
      .digest("hex"),
  }))
  .sort((a, b) => a.name.localeCompare(b.name));

const HOTEL = "20260924191043_add_hotel_affiliate_system";
const CACHE = "20260925061447_add_hotel_provider_cache";
const RETIRED = RETIRED_MIGRATIONS[0];

// The migrations production had at the 2026-09-28 recovery (CACHE was the
// newest). These tests model that snapshot, so a migration added since
// doesn't change what they describe.
const RECOVERED: LocalMigration[] = LOCAL.filter((m) => m.name <= CACHE);

let clock = Date.UTC(2026, 7, 27);
function row(name: string, checksum: string, state: "applied" | "failed" | "rolledBack" = "applied"): MigrationHistoryRow {
  clock += 60_000;
  return {
    migrationName: name,
    checksum,
    startedAt: new Date(clock),
    finishedAt: state === "applied" ? new Date(clock + 1000) : null,
    rolledBackAt: state === "rolledBack" ? new Date(clock + 2000) : null,
  };
}

function checksumOf(name: string): string {
  const migration = LOCAL.find((m) => m.name === name);
  if (!migration) throw new Error(`no local migration ${name}`);
  return migration.checksum;
}

/**
 * Production's history after the 2026-09-28 recovery: 44 rows - every repo
 * migration applied, plus the retired 190352 row, plus 191043's rolled-back
 * failed attempt followed by its successful re-apply.
 */
function productionHistory(): MigrationHistoryRow[] {
  const rows: MigrationHistoryRow[] = [];
  for (const migration of RECOVERED) {
    if (migration.name === HOTEL) {
      rows.push(row(RETIRED.name, RETIRED.checksum));
      rows.push(row(HOTEL, migration.checksum, "rolledBack"));
    }
    rows.push(row(migration.name, migration.checksum));
  }
  return rows;
}

describe("evaluateMigrationHistory - production's real, recovered history", () => {
  it("is safe, fully applied, and accepts exactly the retired row and the re-applied failure", () => {
    const history = productionHistory();
    expect(history).toHaveLength(44);

    const report = evaluateMigrationHistory(history, RECOVERED);
    expect(report.problems).toEqual([]);
    expect(report.pending).toEqual([]);
    expect(report.appliedCount).toBe(43);
    expect(report.retired).toEqual([RETIRED.name]);
    expect(report.resolvedFailures).toEqual([HOTEL]);
  });

  it("lists a new migration as pending, and nothing else", () => {
    const next = { name: "20261001000000_add_something", checksum: "a".repeat(64) };
    const report = evaluateMigrationHistory(productionHistory(), [...RECOVERED, next]);
    expect(report.problems).toEqual([]);
    expect(report.pending).toEqual([next.name]);
  });

  it("lists a migration whose row was removed as pending (the Phase 3 rehearsal state)", () => {
    const history = productionHistory().filter((r) => r.migrationName !== CACHE);
    const report = evaluateMigrationHistory(history, RECOVERED);
    expect(report.problems).toEqual([]);
    expect(report.pending).toEqual([CACHE]);
  });
});

describe("evaluateMigrationHistory - what makes a deploy unsafe", () => {
  it("stops on an unresolved failed migration, and never suggests fixing it automatically", () => {
    const history = [...productionHistory(), row("20261001000000_broken", "b".repeat(64), "failed")];
    const [problem] = evaluateMigrationHistory(history, RECOVERED).problems;
    expect(problem).toContain("20261001000000_broken");
    expect(problem).toContain("never runs `prisma migrate resolve`");
  });

  it("stops when an applied migration was edited afterwards (prisma migrate status misses this)", () => {
    const edited = RECOVERED.map((m) => (m.name === CACHE ? { ...m, checksum: "c".repeat(64) } : m));
    const problems = evaluateMigrationHistory(productionHistory(), edited).problems;
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(`"${CACHE}" was modified after it was applied`);
  });

  it("stops when an applied migration is missing from the commit (renamed, deleted, or wrong commit)", () => {
    const withoutCache = RECOVERED.filter((m) => m.name !== CACHE);
    const problems = evaluateMigrationHistory(productionHistory(), withoutCache).problems;
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(`"${CACHE}" is applied in the database but missing`);
  });

  it("accepts the retired row only with its exact recorded checksum", () => {
    const tampered = productionHistory().map((r) =>
      r.migrationName === RETIRED.name ? { ...r, checksum: "d".repeat(64) } : r,
    );
    const problems = evaluateMigrationHistory(tampered, RECOVERED).problems;
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(RETIRED.name);
  });

  it("stops when a pending migration is older than one already applied", () => {
    const late = { name: "20260101000000_backdated", checksum: "e".repeat(64) };
    const problems = evaluateMigrationHistory(productionHistory(), [...RECOVERED, late]).problems;
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(`"${late.name}" is pending but older than "${CACHE}"`);
  });

  it("stops on a rolled-back migration that was never re-applied and isn't in the commit", () => {
    const history = [...productionHistory(), row("20261001000000_abandoned", "f".repeat(64), "rolledBack")];
    const problems = evaluateMigrationHistory(history, RECOVERED).problems;
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("neither re-applied nor present");
  });

  it("treats a rolled-back migration that is still in the commit as pending, to be re-applied", () => {
    const history = productionHistory().filter((r) => !(r.migrationName === CACHE && r.finishedAt));
    history.push(row(CACHE, checksumOf(CACHE), "rolledBack"));
    const report = evaluateMigrationHistory(history, RECOVERED);
    expect(report.problems).toEqual([]);
    expect(report.pending).toEqual([CACHE]);
  });

  it("stops on a migration recorded as applied twice", () => {
    const history = [...productionHistory(), row(CACHE, checksumOf(CACHE))];
    expect(evaluateMigrationHistory(history, RECOVERED).problems[0]).toContain("applied more than once");
  });

  it("stops on two migrations sharing a timestamp, or a badly named directory", () => {
    const clash = { name: `${CACHE.slice(0, 14)}_other`, checksum: "1".repeat(64) };
    const odd = { name: "not-a-migration", checksum: "2".repeat(64) };
    const problems = evaluateMigrationHistory(productionHistory(), [...RECOVERED, clash, odd]).problems;
    expect(problems.some((p) => p.includes("share a timestamp"))).toBe(true);
    expect(problems.some((p) => p.includes('"not-a-migration" isn\'t named'))).toBe(true);
  });

  it("everything is pending on an empty database", () => {
    const report = evaluateMigrationHistory([], LOCAL);
    expect(report.problems).toEqual([]);
    expect(report.pending).toHaveLength(LOCAL.length);
  });
});
