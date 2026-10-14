/**
 * Nightly production database backup into the FYStay Backup Supabase
 * project ("fystaybackup"). Run by .github/workflows/db-backup-production.yml;
 * runbook: docs/production-database-backups.md.
 *
 *   1. Check the settings: production through the read-only backup login,
 *      the Backup project as the destination (src/lib/productionBackup.ts).
 *   2. Read production's live row counts, then pg_dump the public schema
 *      (all app data, RLS policies and grants) and storage metadata.
 *   3. Restore the dump into a throwaway Postgres on the runner and check it
 *      row for row and migration for migration. A dump that doesn't restore
 *      is never kept.
 *   4. Upload it to the private `prod-backups` bucket in the Backup project,
 *      read it back and compare checksums.
 *   5. Copy any new or changed listing photos / avatars across.
 *   6. Delete backups past retention.
 *
 * Read-only towards production. Never prints a connection string or key.
 * Any failure exits non-zero, which fails the workflow and emails the owner.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  BACKUP_BUCKET,
  BACKUP_SUPABASE_URL,
  PRODUCTION_STORAGE_URL,
  backupFolder,
  backupTargetProblems,
  compareCounts,
  countCopyRows,
  expiredBackupFolders,
} from "../../src/lib/productionBackup";
import { PRODUCTION_SUPABASE_PROJECT_REF } from "../../src/lib/databaseIdentity";

// --- Postgres -----------------------------------------------------------------

/**
 * A connection string as libpq environment variables, so it never goes on a
 * command line - a failure message repeats the command, and the password
 * would be in it.
 */
export function libpqEnv(connectionString: string): Record<string, string> {
  const url = new URL(connectionString);
  const env: Record<string, string> = {
    PGHOST: url.hostname,
    PGPORT: url.port || "5432",
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: decodeURIComponent(url.pathname.replace(/^\//, "")) || "postgres",
  };
  const sslmode = url.searchParams.get("sslmode") ?? (/\.supabase\.(co|com)$/.test(url.hostname) ? "require" : null);
  if (sslmode) env.PGSSLMODE = sslmode;
  return env;
}

/** Runs a Postgres client tool against a database, connection details in the environment. */
function pgTool(tool: string, args: string[], url: string, capture: boolean): string {
  return execFileSync(tool, args, {
    env: { ...process.env, ...libpqEnv(url) },
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 1024,
    stdio: capture ? ["ignore", "pipe", "pipe"] : ["ignore", "inherit", "inherit"],
  }) as string;
}

/** One SQL statement through psql; rows as arrays of fields. */
export function psql(url: string, sql: string): string[][] {
  const out = pgTool("psql", ["-X", "-At", "-F", "\t", "-v", "ON_ERROR_STOP=1", "-c", sql], url, true);
  return out
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => line.split("\t"));
}

/** Rows in every table of the public schema. */
export function tableCounts(url: string): Map<string, number> {
  const tables = psql(url, "select tablename from pg_tables where schemaname = 'public' order by 1").map(([t]) => t);
  if (tables.length === 0) return new Map();
  const sql = tables
    .map((t) => `select ${quoteLiteral(t)}, count(*) from public.${quoteIdent(t)}`)
    .join(" union all ");
  return new Map(psql(url, sql).map(([t, n]) => [t, Number(n)]));
}

export function appliedMigrations(url: string): string[] {
  return psql(url, "select migration_name from public._prisma_migrations where finished_at is not null and rolled_back_at is null order by 1").map(
    ([name]) => name,
  );
}

const quoteIdent = (name: string) => `"${name.replace(/"/g, '""')}"`;
const quoteLiteral = (value: string) => `'${value.replace(/'/g, "''")}'`;

export type DumpFiles = { dir: string; publicDump: string; storageMetadata: string };

export function dumpProduction(sourceUrl: string): DumpFiles {
  const dir = mkdtempSync(join(tmpdir(), "fystay-backup-"));
  const publicDump = join(dir, "public.dump");
  const storageMetadata = join(dir, "storage-metadata.sql");
  // The app's data, schema, RLS policies and grants. --no-owner: a restore
  // target's postgres owns everything. --no-publications: Realtime's
  // publication belongs to the Supabase platform, not to this schema.
  pgTool("pg_dump", ["--format=custom", "--schema=public", "--no-owner", "--no-publications", "--file", publicDump], sourceUrl, false);
  // Which photos and avatars exist, for re-linking files after a restore.
  pgTool("pg_dump", ["--data-only", "--format=plain", "--table=storage.buckets", "--table=storage.objects", "--file", storageMetadata], sourceUrl, false);
  return { dir, publicDump, storageMetadata };
}

/**
 * Restores the dump into an empty database the way docs/production-database-backups.md
 * says to, then checks it. Throws, listing every mismatch, if it isn't a
 * complete copy.
 */
export function restoreAndVerify(
  dump: DumpFiles,
  restoreUrl: string,
  live: { counts: Map<string, number>; migrations: string[] },
): { tables: number; rows: number } {
  // What every Supabase database already has and the dump's grants and
  // defaults refer to.
  psql(
    restoreUrl,
    `do $$ begin
       if not exists (select from pg_roles where rolname = 'anon') then create role anon nologin; end if;
       if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
       if not exists (select from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
       if not exists (select from pg_roles where rolname = 'fystay_pms_host_scoped') then create role fystay_pms_host_scoped nologin; end if;
     end $$;
     create schema if not exists extensions;
     create extension if not exists pgcrypto with schema extensions;
     create extension if not exists "uuid-ossp" with schema extensions;`,
  );
  // pg_restore only restores into a database when given --dbname; naming the
  // database alone keeps the rest of the connection in the environment.
  pgTool("pg_restore", ["--dbname", libpqEnv(restoreUrl).PGDATABASE, "--no-owner", "--clean", "--if-exists", "--exit-on-error", "--single-transaction", dump.publicDump], restoreUrl, false);

  const dumped = countCopyRows(execFileSync("pg_restore", ["--data-only", "--file", "-", dump.publicDump], { encoding: "utf8", maxBuffer: 1024 * 1024 * 1024 }));
  const restored = tableCounts(restoreUrl);
  const { problems } = compareCounts({ live: live.counts, dumped, restored });

  const restoredMigrations = appliedMigrations(restoreUrl);
  if (restoredMigrations.join("\n") !== live.migrations.join("\n")) {
    problems.push(`migrations: production has ${live.migrations.length} applied, the restored copy ${restoredMigrations.length}`);
  }
  if (problems.length > 0) throw new Error(`The backup did not restore as a complete copy:\n- ${problems.join("\n- ")}`);
  return { tables: restored.size, rows: [...restored.values()].reduce((a, b) => a + b, 0) };
}

// --- Backup project storage ---------------------------------------------------

function storageHeaders(key: string, extra: Record<string, string> = {}): Record<string, string> {
  return { apikey: key, authorization: `Bearer ${key}`, ...extra };
}

async function storageRequest(key: string, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${BACKUP_SUPABASE_URL}/storage/v1${path}`, {
    ...init,
    headers: { ...storageHeaders(key), ...(init.headers as Record<string, string> | undefined) },
  });
}

async function ensurePrivateBucket(key: string): Promise<void> {
  const existing = await storageRequest(key, `/bucket/${BACKUP_BUCKET}`);
  if (existing.ok) {
    const bucket = (await existing.json()) as { public?: boolean };
    if (bucket.public) throw new Error(`The ${BACKUP_BUCKET} bucket in the Backup project is public - make it private before backing up into it.`);
    return;
  }
  const created = await storageRequest(key, "/bucket", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: BACKUP_BUCKET, name: BACKUP_BUCKET, public: false }),
  });
  if (!created.ok) throw new Error(`Couldn't create the ${BACKUP_BUCKET} bucket in the Backup project (HTTP ${created.status}).`);
}

const encodePath = (path: string) => path.split("/").map(encodeURIComponent).join("/");

async function upload(key: string, path: string, body: Buffer, contentType: string, upsert: boolean): Promise<void> {
  const res = await storageRequest(key, `/object/${BACKUP_BUCKET}/${encodePath(path)}`, {
    method: "POST",
    headers: { "content-type": contentType, "x-upsert": String(upsert) },
    body: new Uint8Array(body),
  });
  if (!res.ok) throw new Error(`Upload of ${path} to the Backup project failed (HTTP ${res.status}).`);
}

async function download(key: string, path: string): Promise<Buffer> {
  const res = await storageRequest(key, `/object/authenticated/${BACKUP_BUCKET}/${encodePath(path)}`);
  if (!res.ok) throw new Error(`Couldn't read back ${path} from the Backup project (HTTP ${res.status}).`);
  return Buffer.from(await res.arrayBuffer());
}

async function list(key: string, prefix: string): Promise<{ name: string; id: string | null }[]> {
  const res = await storageRequest(key, `/object/list/${BACKUP_BUCKET}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prefix, limit: 1000, offset: 0, sortBy: { column: "name", order: "asc" } }),
  });
  if (!res.ok) throw new Error(`Couldn't list ${prefix} in the Backup project (HTTP ${res.status}).`);
  return (await res.json()) as { name: string; id: string | null }[];
}

/** Copies production's photos and avatars that the Backup project doesn't have yet (or has at a different size). */
async function copyStorageFiles(sourceUrl: string, key: string): Promise<{ total: number; copied: number }> {
  const buckets = new Map(psql(sourceUrl, "select id, public from storage.buckets").map(([id, pub]) => [id, pub === "t"]));
  const objects = psql(sourceUrl, "select bucket_id, name, coalesce(metadata->>'size', '') from storage.objects order by 1, 2");
  let copied = 0;
  for (const [bucket, name, size] of objects) {
    if (!buckets.get(bucket)) {
      throw new Error(`Production bucket "${bucket}" is private; this backup only copies files from public buckets. See the runbook.`);
    }
    const target = `storage/${bucket}/${name}`;
    const head = await storageRequest(key, `/object/authenticated/${BACKUP_BUCKET}/${encodePath(target)}`, { method: "HEAD" });
    if (head.ok && size && head.headers.get("content-length") === size) continue;
    const res = await fetch(`${PRODUCTION_STORAGE_URL}/storage/v1/object/public/${encodePath(bucket)}/${encodePath(name)}`);
    if (!res.ok) throw new Error(`Couldn't download ${bucket}/${name} from production storage (HTTP ${res.status}).`);
    const body = Buffer.from(await res.arrayBuffer());
    await upload(key, target, body, res.headers.get("content-type") ?? "application/octet-stream", true);
    copied += 1;
  }
  return { total: objects.length, copied };
}

async function pruneExpired(key: string, now: Date): Promise<string[]> {
  const folders = (await list(key, "db/")).filter((e) => e.id === null).map((e) => `db/${e.name}`);
  const expired = expiredBackupFolders(folders, now);
  for (const folder of expired) {
    const files = (await list(key, `${folder}/`)).filter((e) => e.id !== null).map((e) => `${folder}/${e.name}`);
    if (files.length === 0) continue;
    const res = await storageRequest(key, `/object/${BACKUP_BUCKET}`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prefixes: files }),
    });
    if (!res.ok) throw new Error(`Couldn't delete expired backup ${folder} (HTTP ${res.status}).`);
  }
  return expired;
}

// --- Run ------------------------------------------------------------------------

const sha256 = (data: Buffer) => createHash("sha256").update(data).digest("hex");

function summary(lines: string[]): void {
  console.log(lines.join("\n"));
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join("\n")}\n`);
}

async function main(): Promise<void> {
  const problems = backupTargetProblems(process.env);
  const restoreUrl = process.env.RESTORE_CHECK_DB_URL;
  if (!restoreUrl) problems.push("RESTORE_CHECK_DB_URL is not set (the workflow's throwaway Postgres)");
  if (problems.length > 0) throw new Error(`Backup not started:\n- ${problems.join("\n- ")}`);
  const sourceUrl = process.env.PROD_BACKUP_DB_URL!;
  const key = process.env.BACKUP_SUPABASE_SERVICE_ROLE_KEY!;
  const startedAt = new Date();

  console.log("Reading production's live row counts...");
  const live = { counts: tableCounts(sourceUrl), migrations: appliedMigrations(sourceUrl) };
  const serverVersion = psql(sourceUrl, "show server_version")[0][0];

  console.log("Dumping production (read-only)...");
  const dump = dumpProduction(sourceUrl);

  console.log("Restoring into the throwaway database and checking it...");
  const restore = restoreAndVerify(dump, restoreUrl!, live);

  const publicDump = readFileSync(dump.publicDump);
  const storageMetadata = readFileSync(dump.storageMetadata);
  const folder = backupFolder(startedAt);
  const manifest = {
    createdAt: startedAt.toISOString(),
    productionProjectRef: PRODUCTION_SUPABASE_PROJECT_REF,
    postgresServerVersion: serverVersion,
    pgDumpVersion: execFileSync("pg_dump", ["--version"], { encoding: "utf8" }).trim(),
    latestMigration: live.migrations.at(-1) ?? null,
    migrations: live.migrations.length,
    tables: Object.fromEntries(live.counts),
    restoreCheck: { passed: true, tables: restore.tables, rows: restore.rows },
    files: {
      "public.dump": { bytes: publicDump.length, sha256: sha256(publicDump) },
      "storage-metadata.sql": { bytes: storageMetadata.length, sha256: sha256(storageMetadata) },
    },
  };
  const manifestPath = join(dump.dir, "manifest.json");
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  console.log(`Uploading to the Backup project (${BACKUP_BUCKET}/${folder})...`);
  await ensurePrivateBucket(key);
  await upload(key, `${folder}/public.dump`, publicDump, "application/octet-stream", false);
  await upload(key, `${folder}/storage-metadata.sql`, storageMetadata, "application/sql", false);
  await upload(key, `${folder}/manifest.json`, readFileSync(manifestPath), "application/json", false);
  const readBack = await download(key, `${folder}/public.dump`);
  if (sha256(readBack) !== manifest.files["public.dump"].sha256) {
    throw new Error("The dump read back from the Backup project doesn't match what was uploaded.");
  }

  console.log("Copying new or changed storage files...");
  const files = await copyStorageFiles(sourceUrl, key);

  const expired = await pruneExpired(key, startedAt);

  summary([
    "## Production database backup: succeeded",
    "",
    `- Backup: \`${BACKUP_BUCKET}/${folder}\` in the Backup project (fystaybackup)`,
    `- Restore check: passed - ${restore.tables} tables, ${restore.rows} rows, ${live.migrations.length} migrations (latest \`${manifest.latestMigration}\`)`,
    `- Dump: ${(statSync(dump.publicDump).size / 1024).toFixed(0)} KB, checksum verified after upload`,
    `- Storage files: ${files.total} in production, ${files.copied} copied this run`,
    `- Expired backups deleted: ${expired.length === 0 ? "none" : expired.join(", ")}`,
  ]);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    // Messages are built above without connection strings or keys.
    console.error(error instanceof Error ? error.message : String(error));
    summary(["## Production database backup: FAILED", "", "See the step log for the reason. No new backup was kept."]);
    process.exit(1);
  });
}
