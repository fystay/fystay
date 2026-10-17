import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { sentryIngestOrigin } from "@/lib/sentryCsp";

// The browser SDK posts errors straight to Sentry's ingest host, so it has to
// be allowed in connect-src - only when a DSN is configured.
const SENTRY_INGEST = sentryIngestOrigin(process.env.NEXT_PUBLIC_SENTRY_DSN);

// Google Maps (the results map) loads its script, tiles, fonts and web
// workers from Google - allowed only once its browser key is configured.
// Its script needs nothing extra: it's added by FYStay's own nonce-trusted
// code, which 'strict-dynamic' already allows.
const GOOGLE_MAPS = Boolean(process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY?.trim());
const MAPS_CONNECT = GOOGLE_MAPS ? " https://*.googleapis.com https://*.gstatic.com https://*.google.com data: blob:" : "";

// Nearly every page in this app calls auth() and is already dynamically
// rendered, so a per-request nonce (which requires dynamic rendering) costs
// us no static-generation benefit we'd otherwise have.
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const isDev = process.env.NODE_ENV === "development";

  // style-src allows 'unsafe-inline' rather than a nonce: React renders a
  // few inline `style="..."` attributes (e.g. Avatar's dynamic size), and
  // nonces can only cover <style> elements/stylesheets, not style attributes.
  const cspHeader = `
    default-src 'self';
    script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""};
    style-src 'self' 'unsafe-inline'${GOOGLE_MAPS ? " https://fonts.googleapis.com" : ""};
    img-src 'self' data: https:${GOOGLE_MAPS ? " blob:" : ""};
    font-src 'self'${GOOGLE_MAPS ? " https://fonts.gstatic.com" : ""};
    connect-src 'self'${SENTRY_INGEST ? ` ${SENTRY_INGEST}` : ""}${MAPS_CONNECT};
    worker-src 'self'${GOOGLE_MAPS ? " blob:" : ""};
    object-src 'none';
    base-uri 'self';
    form-action 'self';
    frame-ancestors 'none';
    upgrade-insecure-requests;
  `;
  const contentSecurityPolicyHeaderValue = cspHeader.replace(/\s{2,}/g, " ").trim();

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", contentSecurityPolicyHeaderValue);

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });
  response.headers.set("Content-Security-Policy", contentSecurityPolicyHeaderValue);

  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!api|_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
