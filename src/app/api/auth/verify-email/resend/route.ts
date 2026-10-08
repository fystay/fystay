import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { sendVerificationEmail } from "@/lib/emailVerification";
import { isLocalEnvironment } from "@/lib/deploymentEnvironment";
import { checkRateLimit, rateLimitedResponse } from "@/lib/rateLimit";
import { withApiErrorHandling } from "@/lib/apiError";

/** "Send the link again", for the signed-in person's own address only. */
async function postHandler() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const limit = await checkRateLimit({ key: `verify-email:${session.user.id}`, limit: 3, windowMs: 15 * 60 * 1000 });
  if (!limit.allowed) return rateLimitedResponse(limit);

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, email: true, name: true, emailVerifiedAt: true },
  });
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.emailVerifiedAt) return NextResponse.json({ alreadyVerified: true });

  const result = await sendVerificationEmail(prisma, user, { local: isLocalEnvironment() });
  if (!result.sent && !result.devUrl) {
    return NextResponse.json({ error: "We couldn't send the email just now. Please try again later." }, { status: 503 });
  }
  return NextResponse.json({ sent: true, ...(result.devUrl && { devUrl: result.devUrl }) });
}

export const POST = withApiErrorHandling(postHandler);
