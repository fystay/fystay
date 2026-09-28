/**
 * CI's production-build safety check: the build must never touch a database.
 *
 * 1. Neither package.json's build script nor vercel.json's buildCommand may
 *    run migrations, seeds or any other database command.
 * 2. Runs the real `npm run build` with every database variable pointed at a
 *    local TCP "canary" that records connection attempts. Any connection -
 *    from Prisma or anything else - fails the check, as does a failed build.
 *
 *   node scripts/ci/check-build-database-free.mjs
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import net from "node:net";

const DATABASE_COMMAND = /\bprisma\s+(migrate|db)\b|\bdb:(migrate|seed)\b|\bseed\b/;

function fail(message) {
  console.log(`::error::${message}`);
  process.exit(1);
}

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const vercel = JSON.parse(readFileSync("vercel.json", "utf8"));
for (const [label, command] of [
  ["package.json scripts.build", pkg.scripts?.build],
  ["package.json scripts.prebuild", pkg.scripts?.prebuild],
  ["package.json scripts.postbuild", pkg.scripts?.postbuild],
  ["vercel.json buildCommand", vercel.buildCommand],
]) {
  if (command && DATABASE_COMMAND.test(command)) fail(`${label} runs a database command: ${command}`);
}
console.log(`Build commands: package.json "${pkg.scripts.build}", vercel.json "${vercel.buildCommand}" - no database commands.`);

const attempts = [];
const canary = net.createServer((socket) => {
  attempts.push(new Date().toISOString());
  socket.destroy();
});
await new Promise((resolve) => canary.listen(0, "127.0.0.1", resolve));
const { port } = canary.address();
const url = `postgresql://canary:canary@127.0.0.1:${port}/canary`;
console.log(`Database canary listening on 127.0.0.1:${port}; building...`);

const code = await new Promise((resolve) => {
  const build = spawn("npm", ["run", "build"], {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url, PMS_HOST_SCOPED_DATABASE_URL: url },
  });
  build.on("exit", (exitCode, signal) => resolve(exitCode ?? (signal ? 1 : 0)));
});
canary.close();

if (code !== 0) fail(`npm run build exited ${code}.`);
if (attempts.length > 0) fail(`The build opened ${attempts.length} database connection(s) - next build must never touch a database.`);
console.log("Production build is database-free: built successfully with 0 database connections.");
