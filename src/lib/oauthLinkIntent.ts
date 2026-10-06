import { createHmac, timingSafeEqual } from "crypto";
import { isOAuthProvider, type OAuthProviderId } from "@/lib/oauthProviders";

/**
 * "Connect Google/Apple" from the account page. The person re-enters their
 * password (POST /api/account/connections), which sets this short-lived,
 * signed, httpOnly cookie; the provider round trip then comes back to
 * Auth.js's callback, where the signIn callback (src/auth.ts) reads it and
 * links the new identity to that account rather than looking it up by
 * email. Signed with AUTH_SECRET, so it can't be forged, and tied to one
 * provider so a Google intent can't link an Apple account.
 */

export const LINK_INTENT_COOKIE = "fystay.oauth-link";
// Long enough to get through Google's or Apple's screens, short enough that
// an abandoned attempt doesn't linger; signing out clears it too (src/auth.ts).
export const LINK_INTENT_TTL_SECONDS = 5 * 60;

type Payload = { userId: string; provider: OAuthProviderId; exp: number };

function sign(data: string, secret: string): string {
  return createHmac("sha256", secret).update(data).digest("base64url");
}

export function createLinkIntent(
  userId: string,
  provider: OAuthProviderId,
  secret: string,
  now: Date = new Date(),
): string {
  const payload: Payload = { userId, provider, exp: Math.floor(now.getTime() / 1000) + LINK_INTENT_TTL_SECONDS };
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${data}.${sign(data, secret)}`;
}

/** The user id the intent was issued for, or null if it's forged, expired or for another provider. */
export function verifyLinkIntent(
  token: string | undefined,
  provider: string,
  secret: string,
  now: Date = new Date(),
): string | null {
  if (!token) return null;
  const [data, signature, extra] = token.split(".");
  if (!data || !signature || extra !== undefined) return null;

  const expected = Buffer.from(sign(data, secret));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;

  let payload: Partial<Payload>;
  try {
    payload = JSON.parse(Buffer.from(data, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof payload.userId !== "string" || !isOAuthProvider(payload.provider) || typeof payload.exp !== "number") {
    return null;
  }
  if (payload.provider !== provider) return null;
  if (payload.exp <= Math.floor(now.getTime() / 1000)) return null;
  return payload.userId;
}

/** The secret Auth.js itself signs sessions with. */
export function linkIntentSecret(): string | null {
  return process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET ?? null;
}

/**
 * The cookie has to survive Apple's cross-site form POST back to the
 * callback, so on https it's SameSite=None (which needs Secure); plain-http
 * local development keeps Lax, which Google's GET callback still carries.
 */
export function linkIntentCookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    secure,
    sameSite: secure ? ("none" as const) : ("lax" as const),
    path: "/",
    maxAge: LINK_INTENT_TTL_SECONDS,
  };
}

/** Same rule src/auth.ts uses for its own callback cookies. */
export function deployedOverHttps(): boolean {
  return Boolean(process.env.VERCEL) || /^https:/i.test(process.env.AUTH_URL ?? process.env.NEXTAUTH_URL ?? "");
}
