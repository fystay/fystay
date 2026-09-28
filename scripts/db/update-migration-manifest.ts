/**
 * Records new migrations in prisma/migration-manifest.json - run it after
 * `prisma migrate dev` creates one, and commit the result with the migration.
 *
 *   npm run db:manifest
 *
 * Append-only: it refuses, rather than "fixing" the manifest, if any
 * migration already recorded was edited, renamed or deleted.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildManifest,
  MANIFEST_PATH,
  MIGRATIONS_PATH,
  parseManifest,
  serializeManifest,
} from "../../src/lib/migrationSafety/manifest";
import { readManifestFile, snapshotFromDisk } from "../../src/lib/migrationSafety/migrationFiles";

function main() {
  const root = process.cwd();
  const manifestPath = join(root, MANIFEST_PATH);
  const { text, json } = readManifestFile(manifestPath);

  let previous = null;
  if (text !== null) {
    const parsed = parseManifest(json);
    if (!parsed.manifest || parsed.problems.length > 0) {
      for (const problem of parsed.problems) console.error(`- ${problem}`);
      console.error(`${MANIFEST_PATH} is malformed - restore it from git rather than regenerating it.`);
      process.exit(1);
    }
    previous = parsed.manifest;
  }

  const { manifest, added, problems } = buildManifest(snapshotFromDisk(join(root, MIGRATIONS_PATH)), previous);
  if (!manifest) {
    for (const problem of problems) console.error(`- ${problem}`);
    console.error("Refusing to update the manifest. Applied migrations are immutable - revert the change and add a new migration instead.");
    process.exit(1);
  }

  const output = serializeManifest(manifest);
  if (output === text) {
    console.log(`${MANIFEST_PATH} is up to date (${manifest.migrations.length} migrations).`);
    return;
  }
  writeFileSync(manifestPath, output);
  console.log(
    previous
      ? `Added ${added.length} migration(s) to ${MANIFEST_PATH}: ${added.join(", ")}`
      : `Created ${MANIFEST_PATH} with ${manifest.migrations.length} migrations.`,
  );
}

main();
