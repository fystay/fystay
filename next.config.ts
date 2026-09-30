import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";
import { assertNoProductionDatabaseOutsideProduction } from "./src/lib/databaseIdentity";

// A preview deployment configured with production database or Supabase
// credentials fails here, before anything compiles, so it never goes live.
// src/lib/prisma.ts repeats the check at runtime.
assertNoProductionDatabaseOutsideProduction();

const remotePatterns: NonNullable<NextConfig["images"]>["remotePatterns"] = [
  {
    protocol: "https",
    hostname: "images.unsplash.com",
  },
];

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
if (supabaseUrl) {
  try {
    remotePatterns.push({
      protocol: "https",
      hostname: new URL(supabaseUrl).hostname,
      pathname: "/storage/v1/object/public/**",
    });
  } catch {
    // ignore malformed env value
  }
}

// Vercel Preview has no NEXT_PUBLIC_BASE_URL of its own, so links built from
// it (emails, Stripe return URLs, redirects) would fall back to localhost.
// Use the branch's stable preview URL instead. Only applies to a Vercel
// preview build with no explicit value, so Production, local and CI builds
// keep reading NEXT_PUBLIC_BASE_URL exactly as before.
const vercelPreviewHost = process.env.VERCEL_BRANCH_URL ?? process.env.VERCEL_URL;
const previewBaseUrl =
  !process.env.NEXT_PUBLIC_BASE_URL && process.env.VERCEL_ENV === "preview" && vercelPreviewHost
    ? `https://${vercelPreviewHost}`
    : undefined;

const nextConfig: NextConfig = {
  ...(previewBaseUrl ? { env: { NEXT_PUBLIC_BASE_URL: previewBaseUrl } } : {}),
  images: { remotePatterns },
  // Content-Security-Policy is set per-request (with a nonce) in src/proxy.ts;
  // these are the headers that don't need to vary per request.
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
        ],
      },
    ];
  },
};

// withSentryConfig wraps the build regardless of whether SENTRY_DSN is
// set - it only affects build-time instrumentation (source map upload,
// tunneling) and no-ops safely without SENTRY_AUTH_TOKEN/SENTRY_ORG/
// SENTRY_PROJECT, matching the dev-mode-fallback pattern used everywhere
// else in this codebase.
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: true,
  webpack: {
    treeshake: { removeDebugLogging: true },
  },
  sourcemaps: {
    disable: !process.env.SENTRY_AUTH_TOKEN,
  },
});
