/**
 * CI's migration immutability check (and the production migration
 * workflow's, before it connects to anything). No database access.
 *
 *   npm run db:check-migrations                    # repository vs manifest
 *   npm run db:check-migrations -- --base <sha>    # ...and vs that commit
 *
 * With --base, every migration that existed at <sha> must be unchanged and
 * the manifest may only have grown. A missing or all-zero <sha> (a brand-new
 * branch, or a commit this clone doesn't have) falls back to the manifest
 * check alone, with a warning. See src/lib/migrationSafety/manifest.ts.
 */
import { join } from "node:path";
import {
  checkManifestAppendOnly,
  checkSnapshotAgainstManifest,
  checkSnapshotAppendOnly,
  MANIFEST_PATH,
  MIGRATIONS_PATH,
  parseManifest,
} from "../../src/lib/migrationSafety/manifest";
import {
  commitExists,
  fileAtCommit,
  readManifestFile,
  snapshotFromCommit,
  snapshotFromDisk,
} from "../../src/lib/migrationSafety/migrationFiles";

function fail(lines: string[]): never {
  for (const line of lines) console.log(`::error::${line}`);
  console.log(`\nMigration immutability check FAILED (${lines.length} problem${lines.length === 1 ? "" : "s"}).`);
  process.exit(1);
}

function main() {
  const root = process.cwd();
  const baseFlag = process.argv.indexOf("--base");
  const base = baseFlag === -1 ? undefined : (process.argv[baseFlag + 1] ?? "");

  const { text, json } = readManifestFile(join(root, MANIFEST_PATH));
  if (text === null) fail([`${MANIFEST_PATH} is missing. Run \`npm run db:manifest\` and commit it.`]);
  if (json === undefined) fail([`${MANIFEST_PATH} isn't valid JSON.`]);

  const { manifest, problems: parseProblems } = parseManifest(json);
  if (!manifest) fail(parseProblems);

  const snapshot = snapshotFromDisk(join(root, MIGRATIONS_PATH));
  const problems = [...parseProblems, ...checkSnapshotAgainstManifest(snapshot, manifest)];
  console.log(`Repository: ${snapshot.directories.length} migrations; manifest: ${manifest.migrations.length} entries.`);

  if (base !== undefined) {
    if (!commitExists(root, base)) {
      console.log(
        `::warning::Base commit "${base || "(none)"}" isn't available (a new branch, or not fetched) - ` +
          `checked against the manifest only.`,
      );
    } else {
      const baseSnapshot = snapshotFromCommit(root, base);
      problems.push(...checkSnapshotAppendOnly(baseSnapshot, snapshot));
      const baseManifestText = fileAtCommit(root, base, MANIFEST_PATH);
      if (baseManifestText === null) {
        console.log(`Base ${base.slice(0, 12)} predates the manifest - compared its migration files directly.`);
      } else {
        let baseJson: unknown;
        try {
          baseJson = JSON.parse(baseManifestText);
        } catch {
          baseJson = undefined;
        }
        const { manifest: baseManifest } = parseManifest(baseJson);
        if (baseManifest) problems.push(...checkManifestAppendOnly(baseManifest, manifest));
        else console.log(`::warning::The base commit's manifest can't be parsed - compared its migration files only.`);
      }
      const added = snapshot.directories.length - baseSnapshot.directories.length;
      console.log(`Base ${base.slice(0, 12)}: ${baseSnapshot.directories.length} migrations; ${added} added since.`);
    }
  }

  if (problems.length > 0) fail(problems);
  console.log("Migration immutability check passed: no migration edited, renamed or deleted; manifest complete.");
}

main();
