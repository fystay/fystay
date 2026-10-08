import { createHmac, timingSafeEqual } from "crypto";

/**
 * Two-factor for Google/Apple sign-in. An account with two-factor turned on
 * asks for its code whichever way the person signs in: when Google or Apple
 * vouches for them, the signIn callback (src/auth.ts) doesn't start a
 * session yet - it sets this signed, five-minute "half signed in" cookie
 * and sends them to the login page's code step. The "oauth-two-factor"
 * sign-in then checks the cookie and the code together.
 *
 * Signed with AUTH_SECRET like the link-intent cookie; it names the
 * account but grants nothing on its own - without a valid code it's
 * useless, and it expires quickly.
 */
export const OAUTH_TWO_FACTOR_COOKIE = "fystay.oauth-2fa";
export const OAUTH_TWO_FACTOR_TTL_SECONDS = 5 * 60;

type Payload = { userId: string; purpose: "oauth-2fa"; exp: number };

function sign(data: string, secret: string): string {
  return createHmac("sha256", secret).update(data).digest("base64url");
}

export function createOAuthTwoFactorToken(userId: string, secret: string, now: Date = new Date()): string {
  const payload: Payload = {
    userId,
    purpose: "oauth-2fa",
    exp: Math.floor(now.getTime() / 1000) + OAUTH_TWO_FACTOR_TTL_SECONDS,
  };
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${data}.${sign(data, secret)}`;
}

/** The account a valid, unexpired token names, or null. */
export function verifyOAuthTwoFactorToken(
  token: string | undefined,
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
  if (payload.purpose !== "oauth-2fa" || typeof payload.userId !== "string" || typeof payload.exp !== "number") {
    return null;
  }
  if (payload.exp <= Math.floor(now.getTime() / 1000)) return null;
  return payload.userId;
}
