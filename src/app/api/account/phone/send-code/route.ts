import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { checkRateLimit, rateLimitedResponse } from "@/lib/rateLimit";
import { isPhoneVerificationConfigured, isValidE164Phone, sendVerificationCode } from "@/lib/phoneVerification";
import { withApiErrorHandling } from "@/lib/apiError";

const sendCodeSchema = z.object({ phone: z.string().min(1) });

/**
 * Rate-limited per account, not per IP - unlike a login/password endpoint,
 * the abuse this guards against is one signed-in user racking up real
 * Twilio SMS charges against FYStay's account, not credential stuffing.
 */
async function postHandler(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isPhoneVerificationConfigured()) {
    return NextResponse.json({ error: "Phone verification is not available right now" }, { status: 501 });
  }

  const body = await request.json();
  const parsed = sendCodeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }
  const phone = parsed.data.phone.trim();
  if (!isValidE164Phone(phone)) {
    return NextResponse.json(
      { error: "Enter your phone number in international format, e.g. +447911123456" },
      { status: 400 },
    );
  }

  const limit = await checkRateLimit({
    key: `phone-verify-send:${session.user.id}`,
    limit: 5,
    windowMs: 60 * 60 * 1000,
  });
  if (!limit.allowed) {
    return rateLimitedResponse(limit);
  }

  try {
    await sendVerificationCode(phone);
  } catch {
    return NextResponse.json({ error: "Could not send a verification code to that number" }, { status: 502 });
  }

  return NextResponse.json({ sent: true });
}

export const POST = withApiErrorHandling(postHandler);
