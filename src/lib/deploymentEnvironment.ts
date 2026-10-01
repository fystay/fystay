/** Anything env-shaped - process.env, or a plain object in tests. */
export type EnvSource = Readonly<Record<string, string | undefined>>;

/**
 * True only on a real production deployment. Vercel sets VERCEL_ENV to
 * "production", "preview" or "development"; anything else (local `next dev`,
 * tests, scripts) has it unset. NODE_ENV is deliberately not used: a local
 * `next build && next start` sets NODE_ENV=production without being a real
 * production deployment.
 */
export function isProductionDeployment(env: EnvSource = process.env): boolean {
  return env.VERCEL_ENV === "production";
}

/**
 * True only off Vercel entirely - local `next dev`, tests and CI, where
 * VERCEL_ENV is unset. The one place a route may hand back an actionable
 * link (a password-reset or email-change link) in its response instead of
 * emailing it. Preview deployments are publicly reachable too, so they're
 * excluded along with production.
 */
export function isLocalEnvironment(env: EnvSource = process.env): boolean {
  return !env.VERCEL_ENV;
}
