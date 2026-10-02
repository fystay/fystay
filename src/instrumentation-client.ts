// Client-side Sentry init, loaded automatically by Next.js on every page.
// Turbopack requires this exact file (src/instrumentation-client.ts) in
// place of the older sentry.client.config.ts convention.
//
// Same dev-mode-fallback pattern as every other integration in this
// codebase (Stripe, Resend, Twilio, Supabase Storage, PMS adapters): no
// NEXT_PUBLIC_SENTRY_DSN set -> Sentry.init is simply never called, so
// every Sentry.* call elsewhere (captureException, etc.) becomes a no-op
// and nothing is sent anywhere. Set NEXT_PUBLIC_SENTRY_DSN to turn this on.
import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    // Don't attach IP addresses, cookies or request bodies to events.
    sendDefaultPii: false,
    // Keep this low in production - it's a sample rate for performance
    // traces, not error reporting (errors are always captured regardless).
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1,
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV,
    // Session replay is off by default - it's a separate, higher-volume
    // Sentry product this project hasn't opted into.
  });
}

export function onRouterTransitionStart(
  url: string,
  navigationType: "push" | "replace" | "traverse",
) {
  if (!dsn) return;
  Sentry.captureRouterTransitionStart(url, navigationType);
}
