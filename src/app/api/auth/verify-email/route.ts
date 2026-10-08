import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyEmailToken } from "@/lib/emailVerification";
import { BASE_URL } from "@/lib/baseUrl";
import { withApiErrorHandling } from "@/lib/apiError";

/**
 * The link in the "Confirm your email" message. A GET, like any email
 * link: it only ever marks the account's own address as proven, so a
 * mail scanner opening it first does no harm. Lands on the account page,
 * which says how it went.
 */
async function getHandler(request: Request) {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  const outcome = token ? await verifyEmailToken(prisma, token) : "invalid";
  return NextResponse.redirect(`${BASE_URL}/account?emailVerified=${outcome}`, 303);
}

export const GET = withApiErrorHandling(getHandler);
