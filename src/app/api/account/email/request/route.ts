import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getResendClient, EMAIL_FROM } from "@/lib/email";
import { generateEmailChangeToken } from "@/lib/emailChange";
import { checkRateLimit, rateLimitedResponse } from "@/lib/rateLimit";
import { withApiErrorHandling } from "@/lib/apiError";

const requestEmailChangeSchema = z.object({ newEmail: z.string().email() });

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
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
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

  if (newEmail === user.email) {
    return NextResponse.json({ error: "That's already your email address." }, { status: 400 });
  }

  const existing = await prisma.user.findUnique({ where: { email: newEmail } });
  if (existing) {
    return NextResponse.json({ error: "That email address is already in use." }, { status: 409 });
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

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";
  const confirmUrl = `${baseUrl}/account/email-change/confirm?token=${token}`;

  const resend = getResendClient();
  if (!resend) {
    // Resend isn't configured (e.g. local dev) - return the link directly
    // so the flow can still be exercised end to end.
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
