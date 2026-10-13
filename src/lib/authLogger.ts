import * as Sentry from "@sentry/nextjs";

/**
 * Auth.js's own failures (a Google/Apple callback that can't swap its code
 * for a token, a bad client secret, a missing AUTH_SECRET) end as a quiet
 * redirect to /login?error=..., so without this they'd only ever reach the
 * hour of Vercel logs. Each goes to Sentry under its Auth.js type. Expected
 * outcomes - a wrong password, a stale form - stay out of it.
 */
const EXPECTED = new Set(["CredentialsSignin", "MissingCSRF", "AccessDenied", "Verification"]);

type AuthJsError = Error & { type?: string };

export function reportAuthError(error: AuthJsError): void {
  const type = error.type ?? error.name;
  console.error(`[auth][error] ${type}`);
  if (EXPECTED.has(type)) return;
  Sentry.captureException(error, { tags: { area: "auth", authErrorType: type }, fingerprint: ["auth", type] });
}
