import { PRODUCTION_SUPABASE_PROJECT_REF } from "./databaseIdentity";
import { BACKUP_SUPABASE_PROJECT_REF } from "./previewDatabase";

/**
 * Nightly backup of the production database into the FYStay Backup Supabase
 * project ("fystaybackup") - the pure parts, so they can be tested.
 * Orchestrated by scripts/db/backup-production.ts from the
 * "Production database backup" GitHub workflow; runbook in
 * docs/production-database-backups.md.
 *
 * Production is read through a dedicated login that can only read
 * (pg_read_all_data + BYPASSRLS, so pg_dump sees every row past RLS). Every
 * dump is restored into a throwaway Postgres on the runner and checked row
 * for row before it's kept, then stored in a private bucket in the Backup
 * project. Nothing here ever writes to production.
 */

export const BACKUP_READER_ROLE = "fystay_backup_reader";
export const BACKUP_BUCKET = "prod-backups";
export const BACKUP_SUPABASE_URL = `https://${BACKUP_SUPABASE_PROJECT_REF}.supabase.co`;
export const PRODUCTION_STORAGE_URL = `https://${PRODUCTION_SUPABASE_PROJECT_REF}.supabase.co`;

/** Daily backups are kept this long; the first backup of each month for a year. */
export const DAILY_RETENTION_DAYS = 35;
export const MONTHLY_RETENTION_MONTHS = 12;

/** The Supabase project a Postgres connection string names: pooler user ("role.ref") or direct host ("db.ref.supabase.co"). */
export function supabaseRefFromDbUrl(url: URL): string | null {
  const userRef = decodeURIComponent(url.username).split(".")[1];
  if (userRef) return userRef;
  return url.hostname.match(/^db\.([a-z0-9]+)\.supabase\.co$/)?.[1] ?? null;
}

/** The database role a connection string logs in as (the part before ".ref" on the pooler). */
function roleFromDbUrl(url: URL): string {
  return decodeURIComponent(url.username).split(".")[0];
}

/**
 * Refuses to run unless the source is production read through the backup
 * login, over a session connection (port 5432 - pg_dump needs one), and the
 * destination is the Backup project. Problems are described without ever
 * repeating a connection string.
 */
export function backupTargetProblems(env: Readonly<Record<string, string | undefined>>): string[] {
  const problems: string[] = [];
  const source = env.PROD_BACKUP_DB_URL;
  if (!source) {
    problems.push("PROD_BACKUP_DB_URL is not set (GitHub environment 'backup')");
  } else {
    let url: URL | null = null;
    try {
      url = new URL(source);
    } catch {
      problems.push("PROD_BACKUP_DB_URL isn't a valid connection string");
    }
    if (url) {
      if (supabaseRefFromDbUrl(url) !== PRODUCTION_SUPABASE_PROJECT_REF) {
        problems.push(`PROD_BACKUP_DB_URL must name the production project (${PRODUCTION_SUPABASE_PROJECT_REF})`);
      }
      if (roleFromDbUrl(url) !== BACKUP_READER_ROLE) {
        problems.push(`PROD_BACKUP_DB_URL must log in as ${BACKUP_READER_ROLE}, the read-only backup login`);
      }
      if (url.port !== "5432") {
        problems.push("PROD_BACKUP_DB_URL must use port 5432 (session pooler or direct), not the transaction pooler");
      }
    }
  }
  if (!env.BACKUP_SUPABASE_SERVICE_ROLE_KEY) {
    problems.push("BACKUP_SUPABASE_SERVICE_ROLE_KEY is not set (GitHub environment 'backup')");
  } else {
    const jwtRef = legacyJwtRef(env.BACKUP_SUPABASE_SERVICE_ROLE_KEY);
    if (jwtRef && jwtRef !== BACKUP_SUPABASE_PROJECT_REF) {
      problems.push(`BACKUP_SUPABASE_SERVICE_ROLE_KEY belongs to another project (${jwtRef}), not the Backup project`);
    }
  }
  return problems;
}

/** The `ref` claim of a legacy service_role JWT; null for the newer sb_secret_ keys, which don't carry one. */
function legacyJwtRef(key: string): string | null {
  const payload = key.split(".")[1];
  if (!payload) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { ref?: unknown };
    return typeof claims.ref === "string" ? claims.ref : null;
  } catch {
    return null;
  }
}

/**
 * Rows per table in a plain-SQL data dump (`pg_restore --data-only -f -`):
 * the lines between each `COPY <table> (...) FROM stdin;` and its `\.`.
 */
export function countCopyRows(sql: string): Map<string, number> {
  const counts = new Map<string, number>();
  let table: string | null = null;
  let rows = 0;
  for (const line of sql.split("\n")) {
    if (table === null) {
      const match = line.match(/^COPY (\S+) .*FROM stdin;$/);
      if (match) {
        table = normaliseTableName(match[1]);
        rows = 0;
      }
    } else if (line === "\\.") {
      counts.set(table, rows);
      table = null;
    } else {
      rows += 1;
    }
  }
  return counts;
}

/** `public."User"` and `public.foo` both become `User` / `foo` - the schema is always public here. */
export function normaliseTableName(qualified: string): string {
  const name = qualified.replace(/^public\./, "");
  return name.startsWith('"') && name.endsWith('"') ? name.slice(1, -1).replace(/""/g, '"') : name;
}

export type CountComparison = { ok: boolean; problems: string[] };

/**
 * The restore check. Every production table must be in the dump; the
 * restored copy must hold exactly the rows the dump holds; and the dump must
 * be close to the live counts read just before it (rows can come and go in
 * the seconds between, but an empty or truncated dump can't pass).
 */
export function compareCounts({
  live,
  dumped,
  restored,
}: {
  live: Map<string, number>;
  dumped: Map<string, number>;
  restored: Map<string, number>;
}): CountComparison {
  const problems: string[] = [];
  for (const [table, liveRows] of live) {
    if (!dumped.has(table)) {
      problems.push(`${table}: missing from the dump`);
      continue;
    }
    const dumpRows = dumped.get(table)!;
    const restoredRows = restored.get(table);
    if (restoredRows === undefined) problems.push(`${table}: missing from the restored copy`);
    else if (restoredRows !== dumpRows) problems.push(`${table}: dump has ${dumpRows} rows, restored copy has ${restoredRows}`);
    const allowed = Math.max(5, Math.ceil(liveRows * 0.01));
    if (Math.abs(liveRows - dumpRows) > allowed) {
      problems.push(`${table}: production had ${liveRows} rows moments before, the dump has ${dumpRows}`);
    }
  }
  return { ok: problems.length === 0, problems };
}

/** Folder name for one backup run, e.g. `db/2026-10-14T031700Z`. Sorts by time. */
export function backupFolder(at: Date): string {
  return `db/${at.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z").replace(/^(\d{4})(\d{2})(\d{2})/, "$1-$2-$3")}`;
}

/** The time a backup folder was taken, or null if the name isn't one of ours. */
export function backupFolderTime(folder: string): Date | null {
  const match = folder.match(/^db\/(\d{4}-\d{2}-\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (!match) return null;
  const date = new Date(`${match[1]}T${match[2]}:${match[3]}:${match[4]}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Backup folders past retention: older than DAILY_RETENTION_DAYS, except the
 * first backup of each calendar month for MONTHLY_RETENTION_MONTHS. Folders
 * whose names aren't ours are never selected.
 */
export function expiredBackupFolders(folders: string[], now: Date): string[] {
  const dated = folders
    .map((folder) => ({ folder, at: backupFolderTime(folder) }))
    .filter((f): f is { folder: string; at: Date } => f.at !== null)
    .sort((a, b) => a.at.getTime() - b.at.getTime());
  const dailyCutoff = now.getTime() - DAILY_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const monthlyCutoff = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - MONTHLY_RETENTION_MONTHS, 1));
  const firstOfMonth = new Set<string>();
  const seenMonths = new Set<string>();
  for (const { folder, at } of dated) {
    const month = at.toISOString().slice(0, 7);
    if (!seenMonths.has(month)) {
      seenMonths.add(month);
      firstOfMonth.add(folder);
    }
  }
  return dated
    .filter(({ folder, at }) => {
      if (at.getTime() >= dailyCutoff) return false;
      if (firstOfMonth.has(folder) && at >= monthlyCutoff) return false;
      return true;
    })
    .map(({ folder }) => folder);
}
