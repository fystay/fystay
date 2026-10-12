import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { checkRateLimit, rateLimitedResponse } from "@/lib/rateLimit";
import {
  checkVerificationCode,
  isPhoneVerificationConfigured,
  normalizePhoneInput,
  type CodeCheckResult,
} from "@/lib/phoneVerification";
import { withApiErrorHandling } from "@/lib/apiError";

const verifyCodeSchema = z.object({
  phone: z.string().min(1).max(32),
  code: z.string().trim().regex(/^\d{4,10}$/),
});

const failure: Record<Exclude<CodeCheckResult, "approved">, { error: string; status: number }> = {
  incorrect: { error: "That code isn't right. Check the text message and try again.", status: 400 },
  expired: { error: "That code has expired. Send a new one.", status: 410 },
  too_many_attempts: { error: "Too many wrong codes. Send a new one.", status: 429 },
  unavailable: { error: "We couldn't check the code just now. Please try again.", status: 502 },
};

/**
 * The phone is marked verified only when Twilio approves the code sent to
 * that exact number. The code is passed through, never stored or logged.
 */
async function postHandler(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isPhoneVerificationConfigured()) {
    return NextResponse.json({ error: "Phone verification isn't switched on yet." }, { status: 501 });
  }

  const body = await request.json().catch(() => null);
  const parsed = verifyCodeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter the code from the text message." }, { status: 400 });
  }
  const phone = normalizePhoneInput(parsed.data.phone);
  if (!phone) {
    return NextResponse.json({ error: "Invalid phone number" }, { status: 400 });
  }

  // A guess-the-code attack is the thing to guard against here, not
  // Twilio spend - Twilio also stops each code after 5 wrong guesses.
  const limit = await checkRateLimit({
    key: `phone-verify-check:${session.user.id}`,
    limit: 10,
    windowMs: 15 * 60 * 1000,
  });
  if (!limit.allowed) {
    return rateLimitedResponse(limit);
  }

  const result = await checkVerificationCode(phone, parsed.data.code);
  if (result !== "approved") {
    return NextResponse.json({ error: failure[result].error, reason: result }, { status: failure[result].status });
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data: { phone, phoneVerifiedAt: new Date() },
  });

  return NextResponse.json({ verified: true, phone });
}

export const POST = withApiErrorHandling(postHandler);
