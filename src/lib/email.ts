import * as Sentry from "@sentry/nextjs";
import { Resend } from "resend";

/**
 * The Resend client every email in the app goes through, or null when no
 * key is set (development: emails are skipped).
 *
 * Resend doesn't throw when it refuses an email (an unverified sending
 * domain, a bad address, a rate limit): it returns `{ error }`. Most send
 * sites only await the call, so without this a refused email - a booking
 * confirmation, a password reset, an ops alert - would vanish without a
 * trace. Every refusal is logged and reported to Sentry here, once, for
 * all of them. The return value is unchanged, so callers that check
 * `error` themselves still can, and no send site starts throwing.
 */
export function getResendClient(): Resend | null {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  const client = new Resend(key);
  const send = client.emails.send.bind(client.emails);
  client.emails.send = async (payload, options) => {
    const result = await send(payload, options);
    if (result.error) reportEmailRefused(payload.subject ?? "(no subject)", result.error);
    return result;
  };
  return client;
}

function reportEmailRefused(subject: string, error: { name: string; message: string }) {
  // The subject says which email it was; the recipient stays out of the
  // logs and Sentry.
  console.error(`email not sent ("${subject}"): ${error.name}: ${error.message}`);
  Sentry.captureMessage(`Email not sent: ${error.name}`, {
    level: "error",
    tags: { area: "email" },
    extra: { subject, reason: error.message },
  });
}

/**
 * An ops alert (chargeback, failed refund, unpaid deposit claim) that
 * couldn't be emailed because Resend isn't configured. Without a key no
 * email goes anywhere, but the alert must still reach someone: Sentry.
 */
export function reportUnsentOpsAlert(subject: string): void {
  console.error(`ops alert not emailed (email isn't configured): ${subject}`);
  Sentry.captureMessage(`Ops alert not emailed: ${subject}`, { level: "error", tags: { area: "payments" } });
}

/**
 * The address transactional email is sent from once Resend is configured.
 * Resend's onboarding address only delivers to the Resend account's own
 * inbox, so production needs EMAIL_FROM on a verified domain (see
 * /api/health/config).
 */
export const EMAIL_FROM = process.env.EMAIL_FROM ?? "FYStay <onboarding@resend.dev>";
