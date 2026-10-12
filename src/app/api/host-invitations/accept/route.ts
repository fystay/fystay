import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { withApiErrorHandling } from "@/lib/apiError";
import { checkRateLimit, rateLimitedResponse } from "@/lib/rateLimit";
import { acceptHostInvitation } from "@/lib/listingOnboarding";

const MESSAGES = {
  invalid: "This invitation link isn't valid. Ask FYStay to send a new one.",
  expired: "This invitation has expired. Ask FYStay to send a new one.",
  accepted: "This invitation has already been used.",
  revoked: "This invitation was withdrawn.",
  wrong_account: "You're signed in with a different email address from the one invited. Sign in with the invited address.",
  email_unverified: "Confirm your email address first - we've sent you a link - then accept the invitation.",
  account_inactive: "This account can't accept invitations.",
} as const;

/** The invited owner, signed in as themselves, takes over the draft(s) FYStay prepared. */
async function postHandler(request: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Please sign in first." }, { status: 401 });

  const rateLimit = await checkRateLimit({ key: `host-invitation-accept:${session.user.id}`, limit: 10, windowMs: 15 * 60 * 1000 });
  if (!rateLimit.allowed) return rateLimitedResponse(rateLimit);

  const parsed = z.object({ token: z.string().min(1).max(200) }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: MESSAGES.invalid }, { status: 400 });

  const result = await acceptHostInvitation(prisma, parsed.data.token, session.user.id);
  if (!result.ok) {
    return NextResponse.json({ error: MESSAGES[result.reason], code: result.reason }, { status: result.reason === "wrong_account" ? 403 : 409 });
  }
  return NextResponse.json({ ok: true, listingIds: result.listingIds });
}

export const POST = withApiErrorHandling(postHandler);
