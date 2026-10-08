/**
 * The example stays, hosts, guests and reviews used on Preview (see
 * src/lib/demoSeed.ts and the Preview-only example catalogue) all belong
 * to accounts on these two domains, which FYStay controls and real people
 * can't sign up with. That's what keeps them apart from genuine
 * marketplace content: Preview says plainly that it's example content
 * (PreviewSiteBanner), and production's health check alerts if any of
 * these accounts ever appear there (/api/health/config).
 */
export const DEMO_EMAIL_DOMAINS = ["@fystay.dev", "@guests.fystay.dev"] as const;

export const demoAccountWhere = {
  OR: DEMO_EMAIL_DOMAINS.map((domain) => ({ email: { endsWith: domain } })),
};
