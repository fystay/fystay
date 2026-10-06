import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { revokeAllSessions } from "@/lib/sessionRevocation";
import { withApiErrorHandling } from "@/lib/apiError";

/**
 * Self-service "sign out of all devices" - bumps sessionVersion so every
 * session this account has, including the one making this request, stops
 * validating on its next read (see the jwt callback in src/auth.ts). The
 * client is expected to call NextAuth's own signOut() right after this
 * succeeds to clear its own cookie and redirect immediately, rather than
 * leaving the current tab showing a page whose session has already been
 * revoked server-side.
 */
async function postHandler() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await revokeAllSessions(prisma, session.user.id);

  return NextResponse.json({ ok: true });
}

export const POST = withApiErrorHandling(postHandler);
