/**
 * Reads prisma/migrations - from disk, or from any git commit - into the
 * snapshot shape manifest.ts compares. Node-only tooling for CI and
 * scripts/db/; nothing in the application imports it.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { MigrationDirectory, MigrationsSnapshot } from "./manifest";
import { MIGRATIONS_PATH } from "./manifest";

const LOCK_FILE = "migration_lock.toml";

export function sha256(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

function filesUnder(dir: string, prefix = ""): Record<string, string> {
  const files: Record<string, string> = {};
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) Object.assign(files, filesUnder(join(dir, entry.name), relative));
    else files[relative] = sha256(readFileSync(join(dir, entry.name)));
  }
  return files;
}

export function snapshotFromDisk(migrationsDir: string): MigrationsSnapshot {
  const directories: MigrationDirectory[] = [];
  const strayEntries: string[] = [];
  let lockFile: string | null = null;

  for (const entry of readdirSync(migrationsDir, { withFileTypes: true })) {
    if (entry.isDirectory()) directories.push({ name: entry.name, files: filesUnder(join(migrationsDir, entry.name)) });
    else if (entry.name === LOCK_FILE) lockFile = sha256(readFileSync(join(migrationsDir, entry.name)));
    else strayEntries.push(entry.name);
  }
  directories.sort((a, b) => a.name.localeCompare(b.name));
  strayEntries.sort();
  return { lockFile, strayEntries, directories };
}

function git(repoDir: string, args: string[]): Buffer {
  return execFileSync("git", args, { cwd: repoDir, stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 });
}

/** True if `ref` names a commit this clone actually has. */
export function commitExists(repoDir: string, ref: string): boolean {
  if (!ref || /^0+$/.test(ref)) return false;
  try {
    git(repoDir, ["cat-file", "-e", `${ref}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

/** A file's content at a commit, or null if it didn't exist there. */
export function fileAtCommit(repoDir: string, ref: string, path: string): string | null {
  try {
    return git(repoDir, ["show", `${ref}:${path}`]).toString("utf8");
  } catch {
    return null;
  }
}

/** prisma/migrations exactly as committed at `ref`, hashed the same way as from disk. */
export function snapshotFromCommit(repoDir: string, ref: string, migrationsPath = MIGRATIONS_PATH): MigrationsSnapshot {
  const listing = git(repoDir, ["ls-tree", "-r", "-z", ref, "--", `${migrationsPath}/`]).toString("utf8");
  const byDirectory = new Map<string, Record<string, string>>();
  const strayEntries: string[] = [];
  let lockFile: string | null = null;

  for (const record of listing.split("\0").filter(Boolean)) {
    // "<mode> <type> <object>\t<path>"
    const tab = record.indexOf("\t");
    const [, type, object] = record.slice(0, tab).split(" ");
    const path = record.slice(tab + 1);
    if (type !== "blob") continue;
    const relative = path.slice(migrationsPath.length + 1);
    const content = git(repoDir, ["cat-file", "blob", object]);
    const slash = relative.indexOf("/");
    if (slash === -1) {
      if (relative === LOCK_FILE) lockFile = sha256(content);
      else strayEntries.push(relative);
      continue;
    }
    const directory = relative.slice(0, slash);
    const files = byDirectory.get(directory) ?? {};
    files[relative.slice(slash + 1)] = sha256(content);
    byDirectory.set(directory, files);
  }

  const directories = [...byDirectory.entries()]
    .map(([name, files]) => ({ name, files }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { lockFile, strayEntries: strayEntries.sort(), directories };
}

export function readManifestFile(path: string): { text: string | null; json: unknown } {
  if (!existsSync(path)) return { text: null, json: undefined };
  const text = readFileSync(path, "utf8");
  try {
    return { text, json: JSON.parse(text) };
  } catch {
    return { text, json: undefined };
  }
}
