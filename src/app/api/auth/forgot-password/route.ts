import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getResendClient, EMAIL_FROM } from "@/lib/email";
import { generateResetToken } from "@/lib/passwordReset";
import { checkRateLimit, clientIp, rateLimitedResponse } from "@/lib/rateLimit";
import { withApiErrorHandling } from "@/lib/apiError";
import { isLocalEnvironment } from "@/lib/deploymentEnvironment";

const forgotPasswordSchema = z.object({ email: z.string().email() });

// Always the same shape and wording, whether or not the email matched an
// account, so this endpoint can't be used to discover who has an account.
const genericResponse = {
  message: "If an account exists for that email, we've sent a password reset link.",
};

async function postHandler(request: Request) {
  const body = await request.json();
  const parsed = forgotPasswordSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }

  const normalizedEmail = parsed.data.email.toLowerCase();
  // Two separate caps: one per email (so retrying the same address can't be
  // used to re-send indefinitely) and one per IP (so one source can't work
  // through many different addresses - which the always-generic response
  // below would otherwise make a cheap way to probe for accounts).
  const [emailLimit, ipLimit] = await Promise.all([
    checkRateLimit({ key: `forgot-password:${normalizedEmail}`, limit: 3, windowMs: 15 * 60 * 1000 }),
    checkRateLimit({ key: `forgot-password-ip:${clientIp(request)}`, limit: 20, windowMs: 15 * 60 * 1000 }),
  ]);
  if (!emailLimit.allowed || !ipLimit.allowed) {
    return rateLimitedResponse(emailLimit.allowed ? ipLimit : emailLimit);
  }

  // A reset link is a credential, so it may only ever travel by email. Off a
  // developer's own machine, email being unavailable means no link at all -
  // answered with the same generic response as an unknown address, before
  // looking the address up, so this can't reveal who has an account either.
  const resend = getResendClient();
  if (!resend && !isLocalEnvironment()) {
    console.error("Password reset requested but email isn't configured (RESEND_API_KEY) - no link sent.");
    return NextResponse.json(genericResponse);
  }

  const user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
  });
  if (!user) {
    return NextResponse.json(genericResponse);
  }

  const { token, tokenHash, expiresAt } = generateResetToken();
  await prisma.passwordResetToken.create({
    data: { userId: user.id, tokenHash, expiresAt },
  });

  // No background job runner (see completePastBookings in bookingLifecycle.ts
  // for the same reasoning elsewhere) - a token row is only ever read again
  // by reset-password, so the moment a new one is requested is as good a
  // time as any to sweep out rows nothing will ever look up again, rather
  // than letting them accumulate forever.
  await prisma.passwordResetToken.deleteMany({
    where: { OR: [{ expiresAt: { lt: new Date() } }, { usedAt: { not: null } }] },
  });

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";
  const resetUrl = `${baseUrl}/reset-password?token=${token}`;

  if (!resend) {
    // Local dev/tests only (checked above): return the link directly so the
    // flow can still be exercised end to end without an email provider.
    return NextResponse.json({ ...genericResponse, resetUrl, devMode: true });
  }

  await resend.emails.send({
    from: EMAIL_FROM,
    to: user.email,
    subject: "Reset your FYStay password",
    html: `<p>Someone requested a password reset for your FYStay account.</p><p><a href="${resetUrl}">Reset your password</a></p><p>This link expires in an hour. If you didn't request this, you can safely ignore this email.</p>`,
  });

  return NextResponse.json(genericResponse);
}

export const POST = withApiErrorHandling(postHandler);
