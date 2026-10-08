import { NextResponse } from "next/server";
import { VERIFY_EMAIL_MESSAGE } from "@/lib/emailVerification";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { withApiErrorHandling } from "@/lib/apiError";
import { checkRateLimit, rateLimitedResponse } from "@/lib/rateLimit";
import { enabledSocialProviders } from "@/lib/authProviders";
import { OAUTH_PROVIDER_NAMES, OAUTH_PROVIDERS } from "@/lib/oauthProviders";
import {
  createLinkIntent,
  deployedOverHttps,
  LINK_INTENT_COOKIE,
  linkIntentCookieOptions,
  linkIntentSecret,
} from "@/lib/oauthLinkIntent";

const schema = z.object({
  provider: z.enum(OAUTH_PROVIDERS),
  currentPassword: z.string().max(200).optional(),
});

type Checked =
  | { ok: false; response: NextResponse }
  | { ok: true; userId: string; provider: (typeof OAUTH_PROVIDERS)[number]; hasPassword: boolean; emailVerified: boolean; identities: { provider: string }[] };

/**
 * Shared by connect and disconnect: signed in, rate-limited, and - for an
 * account with a password - the password again. Adding or removing a way
 * into the account is as sensitive as changing its email, so a session on
 * someone else's device isn't enough on its own.
 */
async function check(request: Request): Promise<Checked> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const limit = await checkRateLimit({
    key: `account-connections:${session.user.id}`,
    limit: 10,
    windowMs: 60 * 60 * 1000,
  });
  if (!limit.allowed) return { ok: false, response: rateLimitedResponse(limit) };

  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) {
    return { ok: false, response: NextResponse.json({ error: "Invalid input" }, { status: 400 }) };
  }

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: session.user.id },
    select: { passwordHash: true, emailVerifiedAt: true, authIdentities: { select: { provider: true } } },
  });
  if (user.passwordHash) {
    const password = parsed.data.currentPassword ?? "";
    if (!password || !(await bcrypt.compare(password, user.passwordHash))) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: password ? "That password isn't right." : "Enter your password to continue." },
          { status: 400 },
        ),
      };
    }
  }

  return {
    ok: true,
    userId: session.user.id,
    provider: parsed.data.provider,
    hasPassword: Boolean(user.passwordHash),
    emailVerified: Boolean(user.emailVerifiedAt),
    identities: user.authIdentities,
  };
}

/**
 * Starts connecting Google/Apple: sets the signed link-intent cookie the
 * signIn callback in src/auth.ts reads when the provider sends the person
 * back. The browser then calls signIn(provider) itself.
 */
async function postHandler(request: Request) {
  const checked = await check(request);
  if (!checked.ok) return checked.response;
  const { userId, provider, identities, emailVerified } = checked;

  // Someone who signed up with an address they don't own could otherwise
  // attach their own Google account to it, and keep it after the real
  // owner takes the account back with a password reset.
  if (!emailVerified) {
    return NextResponse.json({ error: VERIFY_EMAIL_MESSAGE }, { status: 403 });
  }
  if (!enabledSocialProviders()[provider]) {
    return NextResponse.json({ error: `${OAUTH_PROVIDER_NAMES[provider]} sign-in isn't available yet.` }, { status: 400 });
  }
  if (identities.some((identity) => identity.provider === provider)) {
    return NextResponse.json({ error: `${OAUTH_PROVIDER_NAMES[provider]} is already connected.` }, { status: 409 });
  }
  const secret = linkIntentSecret();
  if (!secret) {
    return NextResponse.json({ error: "Connecting accounts isn't available right now." }, { status: 503 });
  }

  const cookieStore = await cookies();
  cookieStore.set(LINK_INTENT_COOKIE, createLinkIntent(userId, provider, secret), linkIntentCookieOptions(deployedOverHttps()));
  return NextResponse.json({ ok: true });
}

/** Disconnects Google/Apple - never the last way into the account. */
async function deleteHandler(request: Request) {
  const checked = await check(request);
  if (!checked.ok) return checked.response;
  const { userId, provider, hasPassword, identities } = checked;

  if (!identities.some((identity) => identity.provider === provider)) {
    return NextResponse.json({ error: `${OAUTH_PROVIDER_NAMES[provider]} isn't connected.` }, { status: 404 });
  }
  if (!hasPassword && identities.length === 1) {
    return NextResponse.json(
      {
        error: `${OAUTH_PROVIDER_NAMES[provider]} is how you sign in. Add a password first (use "Forgot password?" on the login page), then you can disconnect it.`,
      },
      { status: 409 },
    );
  }

  await prisma.authIdentity.deleteMany({ where: { userId, provider } });
  return NextResponse.json({ ok: true });
}

export const POST = withApiErrorHandling(postHandler);
export const DELETE = withApiErrorHandling(deleteHandler);
