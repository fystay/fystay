import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { sendVerificationEmail } from "@/lib/emailVerification";
import { isLocalEnvironment } from "@/lib/deploymentEnvironment";
import { checkRateLimit, clientIp, rateLimitedResponse } from "@/lib/rateLimit";
import { withApiErrorHandling } from "@/lib/apiError";

const bodySchema = z.object({
  email: z.string().trim().max(254),
  callbackUrl: z.string().max(500).optional(),
});

// Said whether or not the address has an account waiting, so this can't be
// used to find out who has signed up.
const GENERIC = "If that address has an unconfirmed FYStay account, we've sent it a new link.";

/**
 * "Send the link again". Works signed out - an unconfirmed account can't
 * sign in (see src/auth.ts) - so it's rate limited by address and by IP.
 * Only a send the email provider actually accepted is reported as sent;
 * a refusal is a 503 the person can retry.
 */
async function postHandler(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success || !parsed.data.email.includes("@")) {
    return NextResponse.json({ error: "Enter the email address you signed up with." }, { status: 400 });
  }
  const email = parsed.data.email.toLowerCase();

  const ipLimit = await checkRateLimit({ key: `verify-email-ip:${clientIp(request)}`, limit: 10, windowMs: 60 * 60 * 1000 });
  if (!ipLimit.allowed) return rateLimitedResponse(ipLimit);
  const emailLimit = await checkRateLimit({ key: `verify-email:${email}`, limit: 3, windowMs: 15 * 60 * 1000 });
  if (!emailLimit.allowed) return rateLimitedResponse(emailLimit);

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, name: true, emailVerifiedAt: true, deletedAt: true },
  });
  if (!user || user.deletedAt || user.emailVerifiedAt) return NextResponse.json({ message: GENERIC });

  const result = await sendVerificationEmail(prisma, user, {
    local: isLocalEnvironment(),
    next: parsed.data.callbackUrl,
  }).catch(() => ({ sent: false, devUrl: undefined }));
  if (!result.sent && !result.devUrl) {
    return NextResponse.json(
      { error: "We couldn't send the email just now. Please try again in a few minutes." },
      { status: 503 },
    );
  }
  return NextResponse.json({ message: GENERIC, ...(result.devUrl && { devUrl: result.devUrl }) });
}

export const POST = withApiErrorHandling(postHandler);
