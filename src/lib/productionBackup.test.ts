import { describe, expect, it } from "vitest";
import {
  backupFolder,
  backupFolderTime,
  backupTargetProblems,
  compareCounts,
  countCopyRows,
  expiredBackupFolders,
} from "./productionBackup";

const PROD_READER = "postgresql://fystay_backup_reader.wzatjhyfwtmxdxfmurkm:pw@aws-0-eu-west-1.pooler.supabase.com:5432/postgres";
const legacyKey = (ref: string) =>
  `x.${Buffer.from(JSON.stringify({ ref, role: "service_role" })).toString("base64url")}.y`;

describe("backupTargetProblems", () => {
  it("accepts production read through the backup login and a Backup project key", () => {
    expect(
      backupTargetProblems({ PROD_BACKUP_DB_URL: PROD_READER, BACKUP_SUPABASE_SERVICE_ROLE_KEY: legacyKey("sqkpixwvugrxllrxlexs") }),
    ).toEqual([]);
    expect(backupTargetProblems({ PROD_BACKUP_DB_URL: PROD_READER, BACKUP_SUPABASE_SERVICE_ROLE_KEY: "sb_secret_abc" })).toEqual([]);
  });

  it("refuses missing settings", () => {
    expect(backupTargetProblems({})).toHaveLength(2);
  });

  it("refuses a source that isn't production, the full-access login, or the transaction pooler", () => {
    const problems = backupTargetProblems({
      PROD_BACKUP_DB_URL: "postgresql://postgres.sqkpixwvugrxllrxlexs:pw@aws-0-eu-west-1.pooler.supabase.com:6543/postgres",
      BACKUP_SUPABASE_SERVICE_ROLE_KEY: "sb_secret_abc",
    });
    expect(problems.join("\n")).toMatch(/production project/);
    expect(problems.join("\n")).toMatch(/fystay_backup_reader/);
    expect(problems.join("\n")).toMatch(/port 5432/);
  });

  it("refuses a destination key from another project - above all production's", () => {
    const problems = backupTargetProblems({
      PROD_BACKUP_DB_URL: PROD_READER,
      BACKUP_SUPABASE_SERVICE_ROLE_KEY: legacyKey("wzatjhyfwtmxdxfmurkm"),
    });
    expect(problems).toEqual([expect.stringMatching(/another project \(wzatjhyfwtmxdxfmurkm\)/)]);
  });

  it("never repeats the connection string or password in a problem", () => {
    const problems = backupTargetProblems({
      PROD_BACKUP_DB_URL: "postgresql://postgres.wzatjhyfwtmxdxfmurkm:s3cret@host:6543/postgres",
    });
    expect(problems.join("\n")).not.toContain("s3cret");
  });
});

describe("countCopyRows", () => {
  it("counts the rows of every COPY block, quoted or not", () => {
    const sql = [
      "SET statement_timeout = 0;",
      'COPY public."User" (id, email) FROM stdin;',
      "u1\ta@example.com",
      "u2\tb@example.com",
      "\\.",
      "",
      "COPY public.plain (id) FROM stdin;",
      "\\.",
      'COPY public."_prisma_migrations" (id) FROM stdin;',
      "m1",
      "\\.",
    ].join("\n");
    expect(Object.fromEntries(countCopyRows(sql))).toEqual({ User: 2, plain: 0, _prisma_migrations: 1 });
  });
});

describe("compareCounts", () => {
  const map = (o: Record<string, number>) => new Map(Object.entries(o));

  it("passes when the restore matches the dump and the dump matches production", () => {
    expect(compareCounts({ live: map({ User: 15 }), dumped: map({ User: 15 }), restored: map({ User: 15 }) }).ok).toBe(true);
  });

  it("allows a few rows of drift between the live count and the dump", () => {
    expect(compareCounts({ live: map({ RateLimitHit: 102 }), dumped: map({ RateLimitHit: 99 }), restored: map({ RateLimitHit: 99 }) }).ok).toBe(true);
  });

  it("fails a restore that lost rows, a missing table, and an empty dump", () => {
    const result = compareCounts({
      live: map({ User: 15, Listing: 40, Booking: 200 }),
      dumped: map({ User: 15, Booking: 0 }),
      restored: map({ User: 14, Booking: 0 }),
    });
    expect(result.ok).toBe(false);
    expect(result.problems).toEqual([
      "User: dump has 15 rows, restored copy has 14",
      "Listing: missing from the dump",
      "Booking: production had 200 rows moments before, the dump has 0",
    ]);
  });
});

describe("backup folders and retention", () => {
  it("names folders by UTC time and reads them back", () => {
    const at = new Date("2026-10-14T03:17:05.123Z");
    expect(backupFolder(at)).toBe("db/2026-10-14T031705Z");
    expect(backupFolderTime(backupFolder(at))?.toISOString()).toBe("2026-10-14T03:17:05.000Z");
    expect(backupFolderTime("db/not-a-backup")).toBeNull();
  });

  it("keeps 35 days of dailies and the first backup of each month for 12 months", () => {
    const now = new Date("2026-12-31T03:00:00Z");
    const folders = [
      "db/2025-11-01T031700Z", // first of its month, but older than 12 months - expires
      "db/2026-10-01T031700Z", // first of October - kept as the monthly
      "db/2026-10-02T031700Z", // October daily past 35 days - expires
      "db/2026-11-26T031700Z", // inside 35 days - kept
      "db/2026-12-30T031700Z", // kept
      "storage/listing-photos/x.jpg", // not ours - never touched
    ];
    expect(expiredBackupFolders(folders, now)).toEqual(["db/2025-11-01T031700Z", "db/2026-10-02T031700Z"]);
  });
});
