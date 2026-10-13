import type { PrismaClient } from "@prisma/client";
import { generateResetToken, hashResetToken } from "@/lib/passwordReset";
import { EMAIL_FROM, getResendClient } from "@/lib/email";
import { escapeHtml, renderEmail } from "@/lib/emailLayout";
import { BASE_URL } from "@/lib/baseUrl";
import { sanitizeCallbackUrl } from "@/lib/safeRedirect";
import { REFERRAL_CREDIT_CENTS } from "@/lib/referral";

/**
 * Proving a password account's email address. An account can't sign in
 * at all until it's proven (see authorize() and the jwt callback in
 * src/auth.ts), so nothing is ever done for an address nobody has shown
 * they own. Google/Apple accounts are verified at creation, and only when
 * the provider says it verified the address (see resolveOAuthSignIn).
 *
 * Tokens reuse the password-reset scheme: 32 random bytes, only their
 * SHA-256 stored, single use. A new link replaces any earlier unused one,
 * and each lasts 48 hours.
 */
export const VERIFICATION_TTL_HOURS = 48;
const VERIFICATION_TTL_MS = VERIFICATION_TTL_HOURS * 60 * 60 * 1000;

type Db = Pick<PrismaClient, "emailVerificationToken" | "user" | "$transaction">;

export const VERIFY_EMAIL_MESSAGE = "Please verify your email address first - we've sent you a link.";

export type VerifyOutcome = "verified" | "already_verified" | "expired" | "used" | "invalid";

/**
 * Creates a link and emails it. `sent` is true only when the email
 * provider accepted the message - never assumed. Returns the link itself
 * only on a developer's own machine with no email provider (so the flow
 * can still be tried end to end), never in a deployed environment. Neither
 * the token nor the link is ever logged.
 */
export async function sendVerificationEmail(
  db: Db,
  user: { id: string; email: string; name: string },
  options: { local: boolean; next?: string | null },
): Promise<{ sent: boolean; devUrl?: string }> {
  const { token, tokenHash } = generateResetToken();
  const now = new Date();
  await db.$transaction([
    // Only the newest link works, so an older email lying around can't be used.
    db.emailVerificationToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: now } }),
    db.emailVerificationToken.create({
      data: { userId: user.id, tokenHash, expiresAt: new Date(now.getTime() + VERIFICATION_TTL_MS) },
    }),
  ]);
  const next = sanitizeCallbackUrl(options.next);
  const url = `${BASE_URL}/api/auth/verify-email?token=${token}${next ? `&next=${encodeURIComponent(next)}` : ""}`;

  const resend = getResendClient();
  if (!resend) {
    if (options.local) return { sent: false, devUrl: url };
    console.error("Verification email not sent: email isn't configured (RESEND_API_KEY).");
    return { sent: false };
  }

  const { error } = await resend.emails
    .send({
      from: EMAIL_FROM,
      to: user.email,
      subject: "Confirm your email for FYStay",
      html: renderEmail({
        preheader: "One tap to confirm this is your email address.",
        heading: "Confirm your email",
        intro: `Hi ${escapeHtml(user.name)}, please confirm this is your email address so we can keep your account and bookings secure.`,
        cta: { label: "Confirm my email", url },
        paragraphs: [
          `This link works for ${VERIFICATION_TTL_HOURS} hours and can be used once. If you didn't create a FYStay account, you can ignore this email.`,
        ],
      }),
    })
    .catch((thrown: unknown) => ({ error: thrown }));
  if (error) {
    // The provider's reason only - never the link, the token or the key.
    const reason = error as { name?: string; message?: string; statusCode?: number };
    console.error("Verification email not sent: the email provider refused it.", {
      name: reason.name,
      statusCode: reason.statusCode,
      message: reason.message,
    });
    return { sent: false };
  }
  return { sent: true };
}

/**
 * Uses a link from the email. The token is claimed before anything else
 * changes, so a link opened twice (or by a mail scanner and then the
 * person) verifies once. A referred account gets its welcome credit here,
 * at verification, not at sign-up.
 */
export async function verifyEmailToken(
  db: Db,
  token: string,
  now: Date = new Date(),
): Promise<VerifyOutcome> {
  const record = await db.emailVerificationToken.findUnique({ where: { tokenHash: hashResetToken(token) } });
  if (!record) return "invalid";
  if (record.usedAt) return "used";
  if (record.expiresAt <= now) return "expired";

  return db.$transaction(async (tx) => {
    const claimed = await tx.emailVerificationToken.updateMany({
      where: { id: record.id, usedAt: null },
      data: { usedAt: now },
    });
    if (claimed.count === 0) return "used";

    const user = await tx.user.findUnique({
      where: { id: record.userId },
      select: { emailVerifiedAt: true, referredByUserId: true },
    });
    if (!user) return "invalid";
    if (user.emailVerifiedAt) return "already_verified";

    const marked = await tx.user.updateMany({
      where: { id: record.userId, emailVerifiedAt: null },
      data: {
        emailVerifiedAt: now,
        ...(user.referredByUserId && { creditBalanceCents: { increment: REFERRAL_CREDIT_CENTS } }),
      },
    });
    return marked.count === 1 ? "verified" : "already_verified";
  });
}
