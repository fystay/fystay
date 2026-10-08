import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getResendClient, EMAIL_FROM } from "@/lib/email";
import { hashEmailChangeToken, isEmailChangeTokenValid } from "@/lib/emailChange";
import { withApiErrorHandling } from "@/lib/apiError";

const confirmEmailChangeSchema = z.object({ token: z.string().min(1) });

/**
 * Deliberately no session check here, same trust model as
 * /api/auth/reset-password: the token itself (proof of access to the new
 * inbox) is what's being verified, not who's currently signed in - the
 * confirmation link is just as likely to be opened from a different
 * browser/device than the one the change was requested from.
 */
async function postHandler(request: Request) {
  const body = await request.json();
  const parsed = confirmEmailChangeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const record = await prisma.emailChangeToken.findUnique({
    where: { tokenHash: hashEmailChangeToken(parsed.data.token) },
    include: { user: { select: { email: true } } },
  });

  if (!record) {
    return NextResponse.json(
      { error: "This confirmation link is invalid or has expired. Request a new one from your account page." },
      { status: 400 },
    );
  }

  // A confirm link can genuinely be opened twice - a double-tap, a page
  // reload, an email client "prefetching" the link, or (in dev) React
  // Strict Mode firing this same effect twice. If this exact token already
  // went on to actually change the account's email, that's not an error to
  // surface - just report the same success again rather than the scary
  // "invalid or expired" message a naive re-check would give a guest who
  // did nothing wrong.
  if (record.usedAt) {
    if (record.user.email === record.newEmail) {
      return NextResponse.json({ ok: true, newEmail: record.newEmail });
    }
    return NextResponse.json(
      { error: "This confirmation link is invalid or has expired. Request a new one from your account page." },
      { status: 400 },
    );
  }
  if (!isEmailChangeTokenValid(record)) {
    return NextResponse.json(
      { error: "This confirmation link is invalid or has expired. Request a new one from your account page." },
      { status: 400 },
    );
  }

  const oldEmail = record.user.email;

  // Claims the token atomically before touching User: the WHERE usedAt:
  // null makes this an all-or-nothing race at the database level, so of
  // two concurrent confirms for the same token, only one ever proceeds to
  // actually change the email (and bump sessionVersion) below - the other
  // sees count 0 and falls back to the already-used branch above on retry
  // rather than both mutating the account.
  const claimed = await prisma.emailChangeToken.updateMany({
    where: { id: record.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (claimed.count === 0) {
    return NextResponse.json({ ok: true, newEmail: record.newEmail });
  }

  try {
    // Changing the email is itself a signal worth re-authenticating over -
    // bumping sessionVersion here signs out every session on this account
    // (see src/lib/sessionRevocation.ts), same as a password reset, so
    // nothing keeps using the old identity after this point.
    await prisma.user.update({
      where: { id: record.userId },
      data: { email: record.newEmail, emailVerifiedAt: new Date(), sessionVersion: { increment: 1 } },
    });
  } catch (err) {
    // Re-checked here, not just at request time: another account could
    // have taken this exact email in the window between the two.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return NextResponse.json({ error: "That email address is already in use." }, { status: 409 });
    }
    throw err;
  }

  // Best-effort notice to the address being replaced - the one signal a
  // real owner would have of an account takeover attempt that got this
  // far (session + inbox access to the new address, but not the old one).
  // Never blocks the response: the email change itself already succeeded.
  const resend = getResendClient();
  if (resend) {
    await resend.emails
      .send({
        from: EMAIL_FROM,
        to: oldEmail,
        subject: "Your FYStay email address was changed",
        html: `<p>The email address on your FYStay account was just changed to ${record.newEmail}.</p><p>If you didn't make this change, contact us immediately.</p>`,
      })
      .catch(() => {});
  }

  return NextResponse.json({ ok: true, newEmail: record.newEmail });
}

export const POST = withApiErrorHandling(postHandler);
