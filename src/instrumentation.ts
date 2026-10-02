import type { Instrumentation } from "next";

// Server/edge-side Sentry init. Next.js calls register() once per runtime
// before it starts handling requests; branching on NEXT_RUNTIME is the
// framework's own documented way to give each runtime (nodejs vs edge) its
// own setup, since the SDK's client/server/edge builds are auto-selected
// via package.json export conditions rather than separate config files.
//
// Same dev-mode-fallback pattern as every other integration in this
// codebase: no SENTRY_DSN set -> Sentry.init is never called, so
// captureRequestError below and every other Sentry.* call becomes a no-op.
export async function register() {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;

  if (process.env.NEXT_RUNTIME === "nodejs") {
    const Sentry = await import("@sentry/nextjs");
    Sentry.init({
      dsn,
      // Don't attach IP addresses, cookies or request bodies to events.
      sendDefaultPii: false,
      tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1,
      environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
    });
  } else if (process.env.NEXT_RUNTIME === "edge") {
    const Sentry = await import("@sentry/nextjs");
    Sentry.init({
      dsn,
      // Don't attach IP addresses, cookies or request bodies to events.
      sendDefaultPii: false,
      tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1,
      environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
    });
  }
}

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (!process.env.SENTRY_DSN) return;
  const Sentry = await import("@sentry/nextjs");
  Sentry.captureRequestError(error, request, context);
};
