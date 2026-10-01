import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";

/**
 * Wraps an API route handler so an *unexpected* thrown error - a bug, a
 * Prisma failure that isn't already caught, a downstream API outage -
 * is logged and reported to Sentry, then turned into a generic 500
 * instead of either crashing the function or leaking an internal error
 * message/stack to the client.
 *
 * This is not a replacement for a route's own explicit error responses
 * (400 for bad input, 401/403 for auth, 404, 409 for conflicts, etc.) -
 * every route in this codebase already returns those directly and should
 * keep doing so. This only exists to give the *unhandled* case a single,
 * consistent, observable behavior instead of each route needing its own
 * top-level try/catch.
 *
 * Sentry.captureException is a no-op when SENTRY_DSN isn't set (see
 * src/instrumentation.ts) - same dev-mode-fallback pattern as every other
 * integration in this codebase.
 */
export function withApiErrorHandling<Args extends unknown[], R extends Response>(
  handler: (...args: Args) => Promise<R>,
): (...args: Args) => Promise<R | NextResponse> {
  return async (...args: Args) => {
    try {
      return await handler(...args);
    } catch (error) {
      // request.json() on a malformed body throws a SyntaxError - that's the
      // client's mistake, not ours, so it's a 400 and not reported to Sentry.
      if (error instanceof SyntaxError) {
        return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
      }
      console.error(error);
      Sentry.captureException(error);
      return NextResponse.json(
        { error: "Something went wrong. Please try again." },
        { status: 500 },
      );
    }
  };
}
