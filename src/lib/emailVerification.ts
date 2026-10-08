import type { PrismaClient } from "@prisma/client";
import { generateResetToken, hashResetToken } from "@/lib/passwordReset";
import { EMAIL_FROM, getResendClient } from "@/lib/email";
import { escapeHtml, renderEmail } from "@/lib/emailLayout";
import { BASE_URL } from "@/lib/baseUrl";
import { REFERRAL_CREDIT_CENTS } from "@/lib/referral";

/**
 * Proving a password account's email address. Until it's proven the
 * account works for browsing and booking, but gets nothing that a
 * throwaway or squatted address could abuse: no welcome credit, no promo
 * codes, no two-factor set-up and no connected Google/Apple sign-in (see
 * requireVerifiedEmail's callers). Google/Apple accounts are verified at
 * creation - the provider vouched for the address.
 *
 * Tokens reuse the password-reset scheme: 32 random bytes, only their
 * SHA-256 stored, single use. They last a week rather than an hour - this
 * link is often opened days later, and it grants nothing but "this inbox
 * is yours".
 */
const VERIFICATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type Db = Pick<PrismaClient, "emailVerificationToken" | "user" | "$transaction">;

export const VERIFY_EMAIL_MESSAGE = "Please verify your email address first - we've sent you a link.";

/**
 * Creates a link and emails it. Returns the link itself only on a
 * developer's own machine with no email provider (so the flow can still be
 * tried end to end), never in a deployed environment.
 */
export async function sendVerificationEmail(
  db: Db,
  user: { id: string; email: string; name: string },
  options: { local: boolean },
): Promise<{ sent: boolean; devUrl?: string }> {
  const { token, tokenHash } = generateResetToken();
  await db.emailVerificationToken.create({
    data: { userId: user.id, tokenHash, expiresAt: new Date(Date.now() + VERIFICATION_TTL_MS) },
  });
  const url = `${BASE_URL}/api/auth/verify-email?token=${token}`;

  const resend = getResendClient();
  if (!resend) {
    if (options.local) return { sent: false, devUrl: url };
    console.error("Verification email not sent: email isn't configured (RESEND_API_KEY).");
    return { sent: false };
  }

  const { error } = await resend.emails.send({
    from: EMAIL_FROM,
    to: user.email,
    subject: "Confirm your email for FYStay",
    html: renderEmail({
      preheader: "One tap to confirm this is your email address.",
      heading: "Confirm your email",
      intro: `Hi ${escapeHtml(user.name)}, please confirm this is your email address so we can keep your account and bookings secure.`,
      cta: { label: "Confirm my email", url },
      paragraphs: ["This link works for 7 days. If you didn't create a FYStay account, you can ignore this email."],
    }),
  });
  return { sent: !error };
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
): Promise<"verified" | "already_verified" | "invalid"> {
  const record = await db.emailVerificationToken.findUnique({ where: { tokenHash: hashResetToken(token) } });
  if (!record || record.usedAt || record.expiresAt <= now) return "invalid";

  return db.$transaction(async (tx) => {
    const claimed = await tx.emailVerificationToken.updateMany({
      where: { id: record.id, usedAt: null },
      data: { usedAt: now },
    });
    if (claimed.count === 0) return "invalid";

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
