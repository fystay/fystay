import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { evaluateMigrationHistory, RETIRED_MIGRATIONS, type MigrationHistoryRow } from "./history";
import {
  buildManifest,
  checkManifestAppendOnly,
  checkSnapshotAgainstManifest,
  checkSnapshotAppendOnly,
  MANIFEST_PATH,
  MIGRATIONS_PATH,
  parseManifest,
  serializeManifest,
  type MigrationManifest,
} from "./manifest";
import { commitExists, readManifestFile, snapshotFromCommit, snapshotFromDisk } from "./migrationFiles";

const REPO_ROOT = process.cwd();
const TSX = join(REPO_ROOT, "node_modules", ".bin", "tsx");
const CHECK_SCRIPT = join(REPO_ROOT, "scripts", "db", "check-migration-manifest.ts");
const UPDATE_SCRIPT = join(REPO_ROOT, "scripts", "db", "update-migration-manifest.ts");

const FIRST = "20260101000000_init";
const SECOND = "20260102000000_add_bookings";
const THIRD = "20260103000000_add_reviews";

// --- temporary fixture repositories ----------------------------------------

const fixtures: string[] = [];
afterEach(() => {
  while (fixtures.length > 0) rmSync(fixtures.pop()!, { recursive: true, force: true });
});

function git(dir: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: dir, stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
}

function writeMigration(root: string, name: string, sql: string) {
  mkdirSync(join(root, MIGRATIONS_PATH, name), { recursive: true });
  writeFileSync(join(root, MIGRATIONS_PATH, name, "migration.sql"), sql);
}

/** A git repository with three migrations, a lock file and a generated manifest, all committed. */
function fixtureRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "fystay-migrations-"));
  fixtures.push(root);
  mkdirSync(join(root, MIGRATIONS_PATH), { recursive: true });
  writeFileSync(join(root, MIGRATIONS_PATH, "migration_lock.toml"), 'provider = "postgresql"\n');
  writeMigration(root, FIRST, 'CREATE TABLE "User" (id text PRIMARY KEY);\n');
  writeMigration(root, SECOND, 'CREATE TABLE "Booking" (id text PRIMARY KEY);\n');
  writeMigration(root, THIRD, 'CREATE TABLE "Review" (id text PRIMARY KEY);\n');
  writeManifest(root);
  git(root, "init", "-q");
  git(root, "-c", "user.email=t@example.com", "-c", "user.name=t", "add", "-A");
  git(root, "-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-q", "-m", "base");
  return root;
}

function writeManifest(root: string) {
  const { manifest, problems } = buildManifest(snapshotFromDisk(join(root, MIGRATIONS_PATH)), null);
  if (!manifest) throw new Error(problems.join("\n"));
  writeFileSync(join(root, MANIFEST_PATH), serializeManifest(manifest));
}

function manifestOf(root: string): MigrationManifest {
  const { manifest } = parseManifest(readManifestFile(join(root, MANIFEST_PATH)).json);
  if (!manifest) throw new Error("fixture manifest unreadable");
  return manifest;
}

function check(root: string): string[] {
  return checkSnapshotAgainstManifest(snapshotFromDisk(join(root, MIGRATIONS_PATH)), manifestOf(root));
}

function checkAgainstBase(root: string, base: string): string[] {
  const current = snapshotFromDisk(join(root, MIGRATIONS_PATH));
  return [
    ...checkSnapshotAgainstManifest(current, manifestOf(root)),
    ...checkSnapshotAppendOnly(snapshotFromCommit(root, base), current),
  ];
}

/** Runs the real CI command in the fixture; returns its exit code and output. */
function runCli(root: string, script: string, ...args: string[]): { code: number; output: string } {
  try {
    const output = execFileSync(TSX, [script, ...args], { cwd: root, stdio: ["ignore", "pipe", "pipe"] }).toString();
    return { code: 0, output };
  } catch (error) {
    const e = error as { status: number; stdout: Buffer; stderr: Buffer };
    return { code: e.status, output: `${e.stdout}${e.stderr}` };
  }
}

// --- the checks ------------------------------------------------------------

describe("migration immutability - the rules", () => {
  it("passes when nothing changed", () => {
    expect(check(fixtureRepo())).toEqual([]);
  });

  it("passes a new migration added correctly (directory + `npm run db:manifest`)", () => {
    const root = fixtureRepo();
    const base = git(root, "rev-parse", "HEAD");
    writeMigration(root, "20260104000000_add_payments", 'CREATE TABLE "Payment" (id text PRIMARY KEY);\n');
    const { manifest, added } = buildManifest(snapshotFromDisk(join(root, MIGRATIONS_PATH)), manifestOf(root));
    expect(added).toEqual(["20260104000000_add_payments"]);
    writeFileSync(join(root, MANIFEST_PATH), serializeManifest(manifest!));

    expect(checkAgainstBase(root, base)).toEqual([]);
    expect(checkManifestAppendOnly(parseManifest(JSON.parse(git(root, "show", `${base}:${MANIFEST_PATH}`))).manifest!, manifestOf(root))).toEqual([]);
  });

  it("fails when an existing migration's SQL is edited", () => {
    const root = fixtureRepo();
    writeFileSync(join(root, MIGRATIONS_PATH, SECOND, "migration.sql"), 'CREATE TABLE "Booking" (id uuid PRIMARY KEY);\n');
    expect(check(root)).toEqual([`Migration "${SECOND}": migration.sql was edited.`]);
  });

  it("fails when a migration directory is renamed (the incident: 190352 -> 191043)", () => {
    const root = fixtureRepo();
    renameSync(join(root, MIGRATIONS_PATH, SECOND), join(root, MIGRATIONS_PATH, "20260102000001_add_bookings"));
    const problems = check(root);
    expect(problems).toContain(`Migration "${SECOND}" was deleted or renamed - it's in the manifest but not in prisma/migrations.`);
    expect(problems.some((p) => p.includes('"20260102000001_add_bookings" isn\'t in the manifest'))).toBe(true);
  });

  it("fails when a migration is deleted", () => {
    const root = fixtureRepo();
    rmSync(join(root, MIGRATIONS_PATH, THIRD), { recursive: true });
    expect(check(root)).toEqual([`Migration "${THIRD}" was deleted or renamed - it's in the manifest but not in prisma/migrations.`]);
  });

  it("fails when a recorded checksum is changed in the manifest", () => {
    const root = fixtureRepo();
    const manifest = manifestOf(root);
    manifest.migrations[0].files["migration.sql"] = "0".repeat(64);
    writeFileSync(join(root, MANIFEST_PATH), serializeManifest(manifest));
    expect(check(root)).toEqual([`Migration "${FIRST}": migration.sql was edited.`]);
  });

  it("fails on two migrations sharing a timestamp", () => {
    const root = fixtureRepo();
    writeMigration(root, `${THIRD.slice(0, 14)}_add_other`, "SELECT 1;\n");
    // Directories are compared in sorted order: "..._add_other" < "..._add_reviews".
    expect(check(root)).toContain(`Migrations "${THIRD.slice(0, 14)}_add_other" and "${THIRD}" share a timestamp, so their order is ambiguous.`);
  });

  it("fails on a migration with no manifest entry (added outside the review path)", () => {
    const root = fixtureRepo();
    writeMigration(root, "20260104000000_sneaky", "DROP TABLE \"Review\";\n");
    expect(check(root)).toEqual([
      'Migration "20260104000000_sneaky" isn\'t in the manifest. If it\'s a genuinely new migration, run `npm run db:manifest` and commit the manifest with it.',
    ]);
  });

  it("fails on malformed manifest entries", () => {
    type ManifestJson = {
      version: unknown;
      migrationLock: unknown;
      migrations: { name?: string; files: Record<string, string> }[];
      retired: unknown[];
    };
    const valid: ManifestJson = JSON.parse(serializeManifest(manifestOf(fixtureRepo())));
    const cases: [string, (m: ManifestJson) => void, string][] = [
      ["bad hash", (m) => { m.migrations[0].files["migration.sql"] = "not-a-hash"; }, "malformed hash"],
      ["no name", (m) => { delete m.migrations[1].name; }, "has no name"],
      ["no migration.sql", (m) => { m.migrations[2].files = { "other.sql": "a".repeat(64) }; }, "doesn't list migration.sql"],
      ["out of order", (m) => { m.migrations.reverse(); }, "isn't in order"],
      ["duplicate", (m) => { m.migrations.push(m.migrations[2]); }, "twice"],
      ["bad lock", (m) => { m.migrationLock = "x"; }, "migrationLock isn't a SHA-256"],
      ["bad retired", (m) => { m.retired = [{ name: 1 }]; }, "Retired entry #1 is malformed"],
    ];
    for (const [label, mutate, expected] of cases) {
      const copy = structuredClone(valid);
      mutate(copy);
      const { problems } = parseManifest(copy);
      expect(problems.some((p) => p.includes(expected)), label).toBe(true);
    }
    expect(parseManifest(null).manifest).toBeNull();
    expect(parseManifest({ ...valid, version: 2 }).manifest).toBeNull();
    expect(parseManifest({ ...valid, migrations: undefined }).manifest).toBeNull();
  });

  it("fails when a file is added to an existing migration, the lock file changes, or a stray file appears", () => {
    const root = fixtureRepo();
    writeFileSync(join(root, MIGRATIONS_PATH, FIRST, "extra.sql"), "SELECT 1;\n");
    writeFileSync(join(root, MIGRATIONS_PATH, "migration_lock.toml"), 'provider = "mysql"\n');
    writeFileSync(join(root, MIGRATIONS_PATH, "notes.txt"), "hi\n");
    expect(check(root)).toEqual([
      "prisma/migrations/migration_lock.toml changed.",
      "prisma/migrations/notes.txt isn't a migration directory or migration_lock.toml.",
      `Migration "${FIRST}": extra.sql was added to an existing migration.`,
    ]);
  });
});

describe("migration immutability - against the base commit", () => {
  it("reads a commit exactly as it reads the disk", () => {
    const root = fixtureRepo();
    expect(snapshotFromCommit(root, "HEAD")).toEqual(snapshotFromDisk(join(root, MIGRATIONS_PATH)));
  });

  it("catches an edit even when the manifest was regenerated to hide it", () => {
    const root = fixtureRepo();
    const base = git(root, "rev-parse", "HEAD");
    writeFileSync(join(root, MIGRATIONS_PATH, FIRST, "migration.sql"), "DROP SCHEMA public CASCADE;\n");
    writeManifest(root); // what someone "fixing CI" might do
    expect(check(root)).toEqual([]); // the manifest alone is now fooled...
    const baseManifest = parseManifest(JSON.parse(git(root, "show", `${base}:${MANIFEST_PATH}`))).manifest!;
    expect(checkAgainstBase(root, base)).toEqual([`Migration "${FIRST}" was changed since the base commit.`]);
    expect(checkManifestAppendOnly(baseManifest, manifestOf(root))).toEqual([
      `Manifest entry "${FIRST}" was changed, removed or reordered since the base commit.`,
    ]);
  });

  it("refuses a new migration timestamped before one that already existed", () => {
    const root = fixtureRepo();
    const base = git(root, "rev-parse", "HEAD");
    writeMigration(root, "20251231000000_backdated", "SELECT 1;\n");
    expect(checkSnapshotAppendOnly(snapshotFromCommit(root, base), snapshotFromDisk(join(root, MIGRATIONS_PATH)))).toEqual([
      `New migration "20251231000000_backdated" is older than "${THIRD}", which already existed - give it a new timestamp.`,
    ]);
  });

  it("recognises a missing base (a new branch pushes an all-zero `before`)", () => {
    const root = fixtureRepo();
    expect(commitExists(root, "0".repeat(40))).toBe(false);
    expect(commitExists(root, "")).toBe(false);
    expect(commitExists(root, "1234567890abcdef1234567890abcdef12345678")).toBe(false);
    expect(commitExists(root, git(root, "rev-parse", "HEAD"))).toBe(true);
  });
});

describe("migration immutability - the retained 20260924190352 production-history row", () => {
  const RETIRED = RETIRED_MIGRATIONS[0];

  it("the real manifest records exactly RETIRED_MIGRATIONS, and the real repository passes", () => {
    const manifest = manifestOf(REPO_ROOT);
    expect(manifest.retired).toEqual([{ name: RETIRED.name, checksum: RETIRED.checksum }]);
    expect(check(REPO_ROOT)).toEqual([]);
  });

  it("fails if the retired list is altered", () => {
    const root = fixtureRepo();
    const manifest = manifestOf(root);
    manifest.retired = [];
    writeFileSync(join(root, MANIFEST_PATH), serializeManifest(manifest));
    expect(check(root)).toEqual(["The manifest's retired list doesn't match RETIRED_MIGRATIONS in src/lib/migrationSafety/history.ts."]);
  });

  it("fails if the retired migration ever reappears as a directory", () => {
    const root = fixtureRepo();
    writeMigration(root, RETIRED.name, "SELECT 1;\n");
    expect(check(root)).toContain(`"${RETIRED.name}" is retired production history and must never reappear as a migration.`);
  });

  it("the manifest's migrations still satisfy Phase 3's history check on production's recovered history", () => {
    // Production's recovered history ended at the hotel provider cache
    // migration; later migrations aren't part of that snapshot.
    const local = manifestOf(REPO_ROOT)
      .migrations.filter((entry) => entry.name <= "20260925061447_add_hotel_provider_cache")
      .map((entry) => ({ name: entry.name, checksum: entry.files["migration.sql"] }));
    const hotel = "20260924191043_add_hotel_affiliate_system";
    let clock = Date.UTC(2026, 7, 27);
    const row = (name: string, checksum: string, rolledBack = false): MigrationHistoryRow => {
      clock += 60_000;
      return { migrationName: name, checksum, startedAt: new Date(clock), finishedAt: rolledBack ? null : new Date(clock + 1), rolledBackAt: rolledBack ? new Date(clock + 2) : null };
    };
    const rows = local.flatMap((m) =>
      m.name === hotel ? [row(RETIRED.name, RETIRED.checksum), row(m.name, m.checksum, true), row(m.name, m.checksum)] : [row(m.name, m.checksum)],
    );
    const report = evaluateMigrationHistory(rows, local);
    expect(rows).toHaveLength(44);
    expect(report.problems).toEqual([]);
    expect(report.retired).toEqual([RETIRED.name]);
  });
});

describe("migration immutability - the real CLIs, as CI runs them", () => {
  it("passes a clean repository, with and without a base commit", () => {
    const root = fixtureRepo();
    expect(runCli(root, CHECK_SCRIPT).code).toBe(0);
    const withBase = runCli(root, CHECK_SCRIPT, "--base", git(root, "rev-parse", "HEAD"));
    expect(withBase.code).toBe(0);
    expect(withBase.output).toContain("passed");
  });

  it("fails CI on an edited migration, and db:manifest refuses to paper over it", () => {
    const root = fixtureRepo();
    const base = git(root, "rev-parse", "HEAD");
    const sqlPath = join(root, MIGRATIONS_PATH, SECOND, "migration.sql");
    const original = readFileSync(sqlPath);
    writeFileSync(sqlPath, "-- edited\n");

    const ci = runCli(root, CHECK_SCRIPT, "--base", base);
    expect(ci.code).toBe(1);
    expect(ci.output).toContain(`::error::Migration "${SECOND}": migration.sql was edited.`);
    expect(ci.output).toContain(`::error::Migration "${SECOND}" was changed since the base commit.`);

    const update = runCli(root, UPDATE_SCRIPT);
    expect(update.code).toBe(1);
    expect(update.output).toContain("Refusing to update the manifest");

    writeFileSync(sqlPath, original);
    expect(runCli(root, CHECK_SCRIPT, "--base", base).code).toBe(0);
  });

  it("warns and falls back to the manifest when the base commit isn't available", () => {
    const root = fixtureRepo();
    const result = runCli(root, CHECK_SCRIPT, "--base", "0".repeat(40));
    expect(result.code).toBe(0);
    expect(result.output).toContain("::warning::Base commit");
  });

  it("fails when the manifest is missing", () => {
    const root = fixtureRepo();
    rmSync(join(root, MANIFEST_PATH));
    const result = runCli(root, CHECK_SCRIPT);
    expect(result.code).toBe(1);
    expect(result.output).toContain("prisma/migration-manifest.json is missing");
  });
});
