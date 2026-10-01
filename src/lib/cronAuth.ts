import { timingSafeEqual } from "node:crypto";

/**
 * Whether a request to a /api/cron route may run the job.
 *
 * Vercel Cron authenticates itself by sending `Authorization: Bearer
 * $CRON_SECRET` - CRON_SECRET is the one variable name it reads. Each route's
 * own older secret (e.g. BOOKING_REQUEST_CRON_SECRET) is still accepted for
 * triggering a job by hand. The `x-vercel-cron` header is deliberately NOT
 * trusted: any client can send it, so it proves nothing.
 *
 * No secret configured means every request is refused.
 */
export function isAuthorizedCronRequest(request: Request, routeSecret?: string): boolean {
  const header = request.headers.get("authorization");
  if (!header) return false;
  return [process.env.CRON_SECRET, routeSecret].some(
    (secret) => Boolean(secret) && safeEqual(header, `Bearer ${secret}`),
  );
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
