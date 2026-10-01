import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { checkRateLimit, clientIp, rateLimitedResponse } from "@/lib/rateLimit";
import { generateReferralCode, REFERRAL_CREDIT_CENTS } from "@/lib/referral";
import { withApiErrorHandling } from "@/lib/apiError";

const signupSchema = z.object({
  name: z.string().min(1, "Please enter your name.").max(100, "Name is too long."),
  email: z.string().email("Please enter a valid email address."),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters.")
    .max(72, "Password is too long."),
  role: z.enum(["GUEST", "HOST"]).default("GUEST"),
  referralCode: z.string().trim().max(20).optional(),
  // Enforced here too, not just as a disabled submit button client-side -
  // otherwise anyone hitting this endpoint directly could create an account
  // with no recorded consent at all.
  termsAccepted: z.literal(true, "You must agree to the Terms and Privacy Policy."),
});

async function postHandler(request: Request) {
  // Keyed by IP, not email: the existing-account check below already stops
  // any one email being reused, so what needs capping here is a single
  // source spinning up many *different* accounts (spam signups, or probing
  // which emails are already taken via the 409 response).
  const rateLimit = await checkRateLimit({
    key: `signup:${clientIp(request)}`,
    limit: 5,
    windowMs: 60 * 60 * 1000,
  });
  if (!rateLimit.allowed) return rateLimitedResponse(rateLimit);

  const body = await request.json();
  const parsed = signupSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const { name, email, password, role, referralCode } = parsed.data;
  const normalizedEmail = email.toLowerCase();

  const existing = await prisma.user.findUnique({
    where: { email: normalizedEmail },
  });
  if (existing) {
    return NextResponse.json(
      { error: "An account with this email already exists." },
      { status: 409 },
    );
  }

  // A referral code from the URL is a courtesy, not something worth
  // blocking signup over - an unrecognized or already-invalid code (typo,
  // stale link) just means no welcome credit, never a signup error.
  const referrer = referralCode
    ? await prisma.user.findUnique({
        where: { referralCode: referralCode.toUpperCase() },
        select: { id: true },
      })
    : null;

  const passwordHash = await bcrypt.hash(password, 10);

  // Retried on the vanishingly rare referralCode collision, the same
  // pattern as generateBookingReference's own retry loop at the point it's
  // actually written.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const user = await prisma.user.create({
        data: {
          name,
          email: normalizedEmail,
          passwordHash,
          role,
          referralCode: generateReferralCode(),
          referredByUserId: referrer?.id,
          creditBalanceCents: referrer ? REFERRAL_CREDIT_CENTS : 0,
          termsAcceptedAt: new Date(),
        },
        select: { id: true, name: true, email: true, role: true },
      });
      return NextResponse.json({ user }, { status: 201 });
    } catch (error) {
      const isCodeCollision =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002" &&
        (error.meta?.target as string[] | undefined)?.includes("referralCode");
      if (!isCodeCollision || attempt === 2) throw error;
    }
  }

  return NextResponse.json({ error: "Could not create account" }, { status: 500 });
}

export const POST = withApiErrorHandling(postHandler);
