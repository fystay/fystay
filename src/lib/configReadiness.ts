/**
 * What production needs configured before real guests and money arrive,
 * checked from the environment without ever reading out a value. Behind
 * /api/health/config (cron-secret protected) so the owner - or an uptime
 * monitor - can see at a glance what's missing, instead of finding out
 * when a guest's confirmation email never arrives.
 *
 * "blocker": a guest booking, payment, payout or sign-in breaks without it.
 * "warning": the site works, but something fails quietly or nobody hears
 * about a problem.
 */
export type ConfigCheck = { key: string; ok: boolean; severity: "blocker" | "warning"; why: string };

type Env = Record<string, string | undefined>;

const set = (env: Env, name: string) => Boolean(env[name]?.trim());

export function configReadiness(env: Env = process.env): ConfigCheck[] {
  const live = env.VERCEL_ENV === "production";
  const stripeKey = env.STRIPE_SECRET_KEY ?? "";
  const emailFrom = env.EMAIL_FROM ?? "";

  return [
    { key: "DATABASE_URL", ok: set(env, "DATABASE_URL"), severity: "blocker", why: "Nothing works without the database." },
    { key: "AUTH_SECRET", ok: set(env, "AUTH_SECRET"), severity: "blocker", why: "Sign-in sessions can't be issued." },
    { key: "STRIPE_SECRET_KEY", ok: set(env, "STRIPE_SECRET_KEY"), severity: "blocker", why: "Guests can't pay." },
    {
      key: "STRIPE_SECRET_KEY is live",
      ok: !live || stripeKey.startsWith("sk_live_") || stripeKey.startsWith("rk_live_"),
      severity: "blocker",
      why: "Production is using a Stripe test key: no real money would move.",
    },
    { key: "STRIPE_WEBHOOK_SECRET", ok: set(env, "STRIPE_WEBHOOK_SECRET"), severity: "blocker", why: "Paid bookings never confirm: Stripe's payment notices are refused." },
    { key: "STRIPE_CONNECT_WEBHOOK_SECRET", ok: set(env, "STRIPE_CONNECT_WEBHOOK_SECRET"), severity: "blocker", why: "Hosts' payout set-up never shows as finished, so their listings can't take bookings." },
    { key: "RESEND_API_KEY", ok: set(env, "RESEND_API_KEY"), severity: "blocker", why: "No email is sent at all: confirmations, password resets, alerts." },
    {
      key: "EMAIL_FROM on your own domain",
      ok: emailFrom.length > 0 && !emailFrom.includes("resend.dev"),
      severity: "blocker",
      why: "Resend's test sender only delivers to your own inbox; guests and hosts would get nothing.",
    },
    { key: "NEXT_PUBLIC_BASE_URL", ok: set(env, "NEXT_PUBLIC_BASE_URL"), severity: "blocker", why: "Links in emails and Stripe return pages point to the wrong site." },
    { key: "CRON_SECRET", ok: set(env, "CRON_SECRET"), severity: "blocker", why: "Daily jobs (deposit holds and releases, unpaid request expiry, reminder emails) never run." },
    { key: "TWO_FACTOR_ENCRYPTION_KEY", ok: set(env, "TWO_FACTOR_ENCRYPTION_KEY"), severity: "blocker", why: "Two-factor sign-in can't be set up or checked." },
    { key: "SUPABASE_SERVICE_ROLE_KEY", ok: set(env, "SUPABASE_SERVICE_ROLE_KEY"), severity: "blocker", why: "Photo uploads fail." },
    { key: "SENTRY_DSN", ok: set(env, "SENTRY_DSN"), severity: "warning", why: "Server errors and refused emails go unreported." },
    { key: "NEXT_PUBLIC_SENTRY_DSN", ok: set(env, "NEXT_PUBLIC_SENTRY_DSN"), severity: "warning", why: "Errors in guests' browsers go unreported." },
    { key: "DISPUTE_ALERT_EMAIL", ok: set(env, "DISPUTE_ALERT_EMAIL"), severity: "warning", why: "Payment alerts (disputes, failed refunds, unpaid deposit claims) go to the public support inbox." },
    { key: "NEXT_PUBLIC_COMPANY_LEGAL_NAME", ok: set(env, "NEXT_PUBLIC_COMPANY_LEGAL_NAME"), severity: "warning", why: "Terms, receipts and the footer don't name the company guests are dealing with." },
  ];
}

export function readinessSummary(checks: ConfigCheck[]) {
  const missing = checks.filter((c) => !c.ok);
  return {
    ready: missing.every((c) => c.severity !== "blocker"),
    blockers: missing.filter((c) => c.severity === "blocker").map(({ key, why }) => ({ key, why })),
    warnings: missing.filter((c) => c.severity === "warning").map(({ key, why }) => ({ key, why })),
  };
}

/**
 * readinessSummary plus the one check that needs the database: example
 * accounts (src/lib/demoContent.ts) must never be on the live site.
 */
export async function productionReadiness(
  countDemoAccounts: () => Promise<number>,
  env: Record<string, string | undefined> = process.env,
) {
  const summary = readinessSummary(configReadiness(env));
  if (env.VERCEL_ENV === "production") {
    const demoAccounts = await countDemoAccounts();
    if (demoAccounts > 0) {
      summary.ready = false;
      summary.blockers.push({
        key: "Demo content in production",
        why: `${demoAccounts} example account(s) found on the live site - remove them so example stays and reviews aren't shown as real.`,
      });
    }
  }
  return summary;
}
