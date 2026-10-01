import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { generateBackupCodes, hashBackupCodes, verifyTotpCode } from "@/lib/twoFactor";
import { decryptTwoFactorSecret } from "@/lib/twoFactorCrypto";
import { withApiErrorHandling } from "@/lib/apiError";
import { checkRateLimit, rateLimitedResponse } from "@/lib/rateLimit";

const verifySchema = z.object({ code: z.string().min(6).max(6) });

/** Completes enrollment: proves the user can produce a real code from the pending secret, then actually turns 2FA on and issues one-time backup codes (shown to the client exactly once - only their hashes are ever stored). */
async function postHandler(request: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // A 6-digit code is only a second factor if it can't be guessed: without
  // a cap, a hijacked session could brute-force its way through this check.
  const limit = await checkRateLimit({
    key: `2fa-verify:${session.user.id}`,
    limit: 10,
    windowMs: 15 * 60 * 1000,
  });
  if (!limit.allowed) return rateLimitedResponse(limit);

  const body = await request.json().catch(() => null);
  const parsed = verifySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter the 6-digit code from your authenticator app" }, { status: 400 });
  }

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: session.user.id },
    select: { twoFactorSecretCiphertext: true, twoFactorEnabledAt: true },
  });
  if (user.twoFactorEnabledAt) {
    return NextResponse.json({ error: "Two-factor authentication is already enabled" }, { status: 409 });
  }
  if (!user.twoFactorSecretCiphertext) {
    return NextResponse.json({ error: "Start enrollment first" }, { status: 409 });
  }

  const secret = decryptTwoFactorSecret(user.twoFactorSecretCiphertext);
  if (!verifyTotpCode(secret, parsed.data.code)) {
    return NextResponse.json({ error: "That code doesn't match - check your authenticator app and try again" }, { status: 400 });
  }

  const backupCodes = generateBackupCodes();
  const hashes = await hashBackupCodes(backupCodes);
  await prisma.user.update({
    where: { id: session.user.id },
    data: { twoFactorEnabledAt: new Date(), twoFactorBackupCodeHashes: hashes },
  });

  return NextResponse.json({ enabled: true, backupCodes });
}

export const POST = withApiErrorHandling(postHandler);
