import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyEmailToken } from "@/lib/emailVerification";
import { BASE_URL } from "@/lib/baseUrl";
import { sanitizeCallbackUrl } from "@/lib/safeRedirect";
import { withApiErrorHandling } from "@/lib/apiError";

/**
 * The link in the "Confirm your email" message. A GET, like any email
 * link: it only ever marks the account's own address as proven, so a
 * mail scanner opening it first does no harm. A confirmed address goes on
 * to log in - straight back to the page sign-up started from when there
 * was one; an expired, already-used or unknown link goes to a page that
 * says which and offers a new one.
 */
async function getHandler(request: Request) {
  const params = new URL(request.url).searchParams;
  const token = params.get("token") ?? "";
  const outcome = token ? await verifyEmailToken(prisma, token) : "invalid";

  if (outcome === "verified" || outcome === "already_verified") {
    const next = sanitizeCallbackUrl(params.get("next"));
    const destination = next
      ? `/login?emailConfirmed=1&callbackUrl=${encodeURIComponent(next)}`
      : `/account?emailVerified=${outcome}`;
    return NextResponse.redirect(`${BASE_URL}${destination}`, 303);
  }
  return NextResponse.redirect(`${BASE_URL}/verify-email?status=${outcome}`, 303);
}

export const GET = withApiErrorHandling(getHandler);
