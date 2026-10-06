import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getResendClient, EMAIL_FROM } from "@/lib/email";
import { generateEmailChangeToken } from "@/lib/emailChange";
import { checkRateLimit, rateLimitedResponse } from "@/lib/rateLimit";
import { withApiErrorHandling } from "@/lib/apiError";
import { isLocalEnvironment } from "@/lib/deploymentEnvironment";
import { BASE_URL } from "@/lib/baseUrl";

const requestEmailChangeSchema = z.object({
  newEmail: z.string().email(),
  currentPassword: z.string().min(1).max(200),
});

async function postHandler(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limit = await checkRateLimit({
    key: `email-change-request:${session.user.id}`,
    limit: 5,
    windowMs: 60 * 60 * 1000,
  });
  if (!limit.allowed) return rateLimitedResponse(limit);

  const body = await request.json();
  const parsed = requestEmailChangeSchema.safeParse(body);
  if (!parsed.success) {
    const missingPassword = parsed.error.issues.some((issue) => issue.path[0] === "currentPassword");
    return NextResponse.json(
      { error: missingPassword ? "Enter your current password." : "Enter a valid email address." },
      { status: 400 },
    );
  }
  const newEmail = parsed.data.newEmail.toLowerCase();

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: session.user.id },
    select: { email: true, passwordHash: true },
  });

  // A Google-linked account is matched by email on every sign-in (see
  // auth.ts's signIn callback, `prisma.user.upsert({ where: { email } })`)
  // - changing this row's email out from under that would make the next
  // "Continue with Google" create a brand-new, disconnected account at the
  // old address instead of signing back into this one. Gated the same way
  // TwoFactorCard already is on this page: only an account that also has
  // its own password isn't relying on email-as-identity for Google.
  if (!user.passwordHash) {
    return NextResponse.json(
      { error: "Accounts signed in with Google can't change their email here." },
      { status: 400 },
    );
  }

  // The current password, not just a signed-in session: otherwise anyone
  // holding a session (a borrowed phone, an unlocked laptop) could move the
  // account to an inbox they control and then reset its password from
  // there. Guesses are capped by this route's rate limit above.
  if (!(await bcrypt.compare(parsed.data.currentPassword, user.passwordHash))) {
    return NextResponse.json({ error: "That password isn't right." }, { status: 400 });
  }

  if (newEmail === user.email) {
    return NextResponse.json({ error: "That's already your email address." }, { status: 400 });
  }

  const existing = await prisma.user.findUnique({ where: { email: newEmail } });
  if (existing) {
    return NextResponse.json({ error: "That email address is already in use." }, { status: 409 });
  }

  // The confirmation link is the proof the person controls the new inbox,
  // so it may only ever travel by email. Off a developer's own machine,
  // email being unavailable means email changes are unavailable - never
  // that the link comes back in this response.
  const resend = getResendClient();
  if (!resend && !isLocalEnvironment()) {
    console.error("Email change requested but email isn't configured (RESEND_API_KEY) - no link sent.");
    return NextResponse.json(
      { error: "Changing your email isn't available right now. Please try again later." },
      { status: 503 },
    );
  }

  const { token, tokenHash, expiresAt } = generateEmailChangeToken();
  await prisma.emailChangeToken.create({
    data: { userId: session.user.id, newEmail, tokenHash, expiresAt },
  });

  // Same "no background job runner, so sweep opportunistically" reasoning
  // as forgot-password - a token row is only ever read again by confirm,
  // so the moment a new one is requested is as good a time as any to clear
  // out ones nothing will look up again.
  await prisma.emailChangeToken.deleteMany({
    where: { OR: [{ expiresAt: { lt: new Date() } }, { usedAt: { not: null } }] },
  });

  const baseUrl = BASE_URL;
  const confirmUrl = `${baseUrl}/account/email-change/confirm?token=${token}`;

  if (!resend) {
    // Local dev/tests only (checked above): return the link directly so the
    // flow can still be exercised end to end without an email provider.
    return NextResponse.json({ ok: true, confirmUrl, devMode: true });
  }

  await resend.emails.send({
    from: EMAIL_FROM,
    to: newEmail,
    subject: "Confirm your new FYStay email address",
    html: `<p>Confirm this email address to finish changing your FYStay account's email.</p><p><a href="${confirmUrl}">Confirm email change</a></p><p>This link expires in an hour. If you didn't request this, you can safely ignore it - your email won't change unless this link is opened.</p>`,
  });

  return NextResponse.json({ ok: true });
}

export const POST = withApiErrorHandling(postHandler);
