import { isProductionDeployment, type EnvSource } from "@/lib/deploymentEnvironment";

/**
 * Demo seeding (src/lib/demoSeed.ts) creates accounts with published test
 * passwords and marks the mock hotel provider ACTIVE - dev/test fixture data
 * that must never land in a real production database. Every seeding entry
 * point (prisma/seed.ts, /api/admin/seed-demo-data) checks this one rule, so
 * the two can't drift apart. ALLOW_PRODUCTION_SEED=true is the only override,
 * and it has to be set deliberately.
 */
export function isProductionSeedRefused(env: EnvSource = process.env): boolean {
  return isProductionDeployment(env) && env.ALLOW_PRODUCTION_SEED !== "true";
}
