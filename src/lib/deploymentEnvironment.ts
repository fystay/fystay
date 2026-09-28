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
