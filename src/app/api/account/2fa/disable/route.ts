import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { verifyAndConsumeBackupCode, verifyTotpCode } from "@/lib/twoFactor";
import { decryptTwoFactorSecret } from "@/lib/twoFactorCrypto";
import { withApiErrorHandling } from "@/lib/apiError";
import { checkRateLimit, rateLimitedResponse } from "@/lib/rateLimit";

const disableSchema = z.object({ code: z.string().min(6).max(11) });

/** Turns 2FA off - requires a current code (TOTP or a backup code) as proof, the same way changing a password requires the current one, so a hijacked-but-still-logged-in session can't silently strip an account's second factor. */
async function postHandler(request: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // A 6-digit code is only a second factor if it can't be guessed: without
  // a cap, a hijacked session could brute-force its way through this check.
  const limit = await checkRateLimit({
    key: `2fa-disable:${session.user.id}`,
    limit: 10,
    windowMs: 15 * 60 * 1000,
  });
  if (!limit.allowed) return rateLimitedResponse(limit);

  const body = await request.json().catch(() => null);
  const parsed = disableSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter your current code to confirm" }, { status: 400 });
  }

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: session.user.id },
    select: { twoFactorSecretCiphertext: true, twoFactorEnabledAt: true, twoFactorBackupCodeHashes: true },
  });
  if (!user.twoFactorEnabledAt || !user.twoFactorSecretCiphertext) {
    return NextResponse.json({ error: "Two-factor authentication isn't enabled" }, { status: 409 });
  }

  const secret = decryptTwoFactorSecret(user.twoFactorSecretCiphertext);
  let codeValid = verifyTotpCode(secret, parsed.data.code);
  if (!codeValid) {
    const { valid } = await verifyAndConsumeBackupCode(user.twoFactorBackupCodeHashes, parsed.data.code);
    codeValid = valid;
  }
  if (!codeValid) {
    return NextResponse.json({ error: "That code doesn't match" }, { status: 400 });
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data: {
      twoFactorSecretCiphertext: null,
      twoFactorEnabledAt: null,
      twoFactorBackupCodeHashes: [],
    },
  });

  return NextResponse.json({ disabled: true });
}

export const POST = withApiErrorHandling(postHandler);
