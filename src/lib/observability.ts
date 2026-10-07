import * as Sentry from "@sentry/nextjs";
import { isAuthorizedCronRequest } from "@/lib/cronAuth";

/**
 * For errors that are caught on purpose - the work carries on, but someone
 * should know - in the places where a quiet failure costs money or leaves
 * a guest or host waiting (refunds, deposits, payouts, daily jobs). Logged
 * as before and reported to Sentry, tagged by area so alert rules can
 * single out payments. A no-op in Sentry without SENTRY_DSN.
 */
export function reportError(
  error: unknown,
  context: { area: "payments" | "deposits" | "bookings" | "email" | "cron" | "sync"; message: string; bookingId?: string },
): void {
  console.error(`${context.message}${context.bookingId ? ` (booking ${context.bookingId})` : ""}:`, error);
  Sentry.captureException(error, {
    tags: { area: context.area },
    extra: { message: context.message, bookingId: context.bookingId },
  });
}

/**
 * Wraps a daily job (vercel.json `crons`) so Sentry Crons knows when it
 * ran and whether it worked - and alerts when it fails, or doesn't run at
 * all (Vercel itself tells nobody: a job refused for a missing CRON_SECRET
 * or a crashed run just shows in the logs).
 *
 * Only an authorised request checks in, so anyone else calling the URL
 * can't mark a job as failed. A 5xx response or a throw counts as a
 * failure; the per-item failures a job logs and carries on from are
 * reported separately (reportError).
 */
export function withCronMonitor(
  monitorSlug: string,
  schedule: string,
  /** The job's own older secret variable, also accepted (see cronAuth.ts). */
  routeSecretName: string,
  handler: (request: Request) => Promise<Response>,
): (request: Request) => Promise<Response> {
  return async (request: Request) => {
    if (!process.env.SENTRY_DSN || !isAuthorizedCronRequest(request, process.env[routeSecretName])) return handler(request);

    const checkInId = Sentry.captureCheckIn(
      { monitorSlug, status: "in_progress" },
      { schedule: { type: "crontab", value: schedule }, timezone: "Etc/UTC", checkinMargin: 30, maxRuntime: 10 },
    );
    let status: "ok" | "error" = "error";
    try {
      const response = await handler(request);
      status = response.status < 500 ? "ok" : "error";
      return response;
    } finally {
      Sentry.captureCheckIn({ checkInId, monitorSlug, status });
      // Serverless functions freeze once they've answered; send the
      // check-in before that.
      await Sentry.flush(2000);
    }
  };
}
