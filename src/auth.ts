import { cache } from "react";
import NextAuth, { CredentialsSignin, type NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import Apple from "next-auth/providers/apple";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { appleSignInEnabled, googleSignInEnabled } from "@/lib/authProviders";
import { createAppleClientSecret } from "@/lib/appleClientSecret";
import { claimIsTrue, isOAuthProvider, resolveOAuthSignIn } from "@/lib/oauthAccounts";
import { deployedOverHttps, LINK_INTENT_COOKIE, linkIntentSecret, verifyLinkIntent } from "@/lib/oauthLinkIntent";
import { peekRateLimit, recordFailedAttempt, resetRateLimit } from "@/lib/rateLimit";
import { decryptTwoFactorSecret } from "@/lib/twoFactorCrypto";
import { verifyAndConsumeBackupCode, verifyTotpCode } from "@/lib/twoFactor";
import { isSuspended } from "@/lib/suspension";

/**
 * Thrown instead of returning null when a password is correct but the
 * account has 2FA enabled and no code (or an already-consumed/invalid one)
 * was submitted. next-auth's own CredentialsSignin.type is always fixed at
 * "CredentialsSignin" for every subclass, but `code` is the one field it
 * documents as configurable per-instance and does pass through to the
 * client's signIn() result (as `result.code`) - LoginForm.tsx checks for
 * exactly this string to know when to show the code-entry step, as opposed
 * to a genuinely wrong password.
 */
class TwoFactorRequiredError extends CredentialsSignin {
  constructor() {
    super();
    this.code = "TwoFactorRequired";
  }
}

/**
 * Thrown instead of returning null when the email/password (and 2FA code,
 * if enabled) were otherwise correct but an admin has suspended this
 * account (see User.suspendedAt) - deliberately checked only after the
 * credentials themselves have already been verified, so a mere guess
 * against a suspended account's email still gets the same generic
 * "invalid credentials" response as any other wrong guess, rather than
 * leaking that the account exists and is suspended. Same code-based
 * convention as TwoFactorRequiredError above: LoginForm.tsx checks for
 * this exact "AccountSuspended" code to show a friendly, specific message
 * instead of "invalid credentials".
 */
class AccountSuspendedError extends CredentialsSignin {
  constructor() {
    super();
    this.code = "AccountSuspended";
  }
}

// Keyed by the attempted email, not the caller's IP - authorize() here has
// no access to the request, and a per-account cap on guesses is the actual
// goal (a distributed brute force spreading guesses across many IPs against
// one account is exactly what this needs to stop, not what it should miss).
// Only failed attempts count, and a success clears the count entirely - a
// real user logging in from several devices/tabs in one session can easily
// rack up more than a handful of *successful* logins, and counting those
// against the same cap as guesses would eventually lock them out of their
// own account for doing nothing wrong.
const LOGIN_RATE_LIMIT = { limit: 10, windowMs: 15 * 60 * 1000 };

/**
 * Apple returns to /api/auth/callback/apple with a cross-site form POST
 * (response_mode=form_post), and browsers don't send SameSite=Lax cookies
 * on those - so the state, nonce and callback-url cookies Auth.js set when
 * the flow started would be missing and every Apple sign-in would fail its
 * checks. On https deployments those four short-lived, httpOnly cookies are
 * SameSite=None (which requires Secure). Plain-http local development keeps
 * the defaults: browsers reject SameSite=None without Secure, and Apple
 * doesn't allow http or localhost return URLs anyway.
 */
const crossSiteCallbackCookie = { options: { sameSite: "none" as const, secure: true } };

/** Apple's client secret is a JWT signed with our key; a bad key turns Apple off rather than breaking every login. */
function appleClientSecret(): string | null {
  try {
    return createAppleClientSecret({
      clientId: process.env.APPLE_CLIENT_ID!,
      teamId: process.env.APPLE_TEAM_ID!,
      keyId: process.env.APPLE_KEY_ID!,
      privateKey: process.env.APPLE_PRIVATE_KEY!,
    });
  } catch (error) {
    console.error("Sign in with Apple is off: APPLE_PRIVATE_KEY couldn't be read as an EC private key.", {
      error: error instanceof Error ? error.name : "unknown",
    });
    return null;
  }
}
const appleSecret = appleSignInEnabled ? appleClientSecret() : null;

/** Where a refused Google/Apple sign-in lands: the page it started from, with a reason it can explain. */
function oauthRefusalRedirect(reason: string, provider: string, linking: boolean): string {
  const params = new URLSearchParams({ error: reason, provider });
  return linking ? `/account?connect=${provider}&${params}` : `/login?${params}`;
}

const { handlers, signIn, signOut, auth: uncachedAuth } = NextAuth({
  // Trust the Host header from the deployment platform's proxy (Vercel, etc.).
  // Without this, NextAuth v5 rejects every request in production mode
  // ("UntrustedHost") since it can't otherwise tell a real request apart
  // from one with a spoofed Host header.
  trustHost: true,
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
    // Provider errors (a cancelled Google/Apple screen, a misconfigured
    // provider) come back to the login page as ?error=..., which LoginForm
    // turns into a friendly message - never Auth.js's own error page.
    error: "/login",
  },
  ...(deployedOverHttps() && {
    cookies: {
      state: crossSiteCallbackCookie,
      nonce: crossSiteCallbackCookie,
      pkceCodeVerifier: crossSiteCallbackCookie,
      callbackUrl: crossSiteCallbackCookie,
    } as NextAuthConfig["cookies"],
  }),
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
        // Only ever sent once the client already knows 2FA is required for
        // this account (see the TwoFactorRequiredError thrown below) -
        // absent on every ordinary login attempt.
        code: { label: "Two-factor code", type: "text" },
      },
      authorize: async (credentials) => {
        const email = credentials?.email;
        const password = credentials?.password;
        if (typeof email !== "string" || typeof password !== "string") {
          return null;
        }

        const normalizedEmail = email.toLowerCase();
        const rateLimitKey = `login:${normalizedEmail}`;
        // A read-only check: denies the same way a wrong password would (a
        // plain null) if already over the limit, without yet touching the
        // counter itself - a rate-limited response that looked any
        // different would itself tell an attacker their guessing was
        // noticed, and roughly how many guesses it took.
        const { allowed } = await peekRateLimit({ key: rateLimitKey, ...LOGIN_RATE_LIMIT });
        if (!allowed) return null;

        const user = await prisma.user.findUnique({
          where: { email: normalizedEmail },
        });
        // No account, or one created via Google that's never also set a
        // password: either way there's nothing to check the password
        // against, so deny rather than passing null into bcrypt.
        if (!user || !user.passwordHash) {
          await recordFailedAttempt({ key: rateLimitKey, windowMs: LOGIN_RATE_LIMIT.windowMs });
          return null;
        }

        const isValid = await bcrypt.compare(password, user.passwordHash);
        if (!isValid) {
          await recordFailedAttempt({ key: rateLimitKey, windowMs: LOGIN_RATE_LIMIT.windowMs });
          return null;
        }

        // Checked only after the password check above succeeds - never
        // before - so this never distinguishes a suspended account from a
        // wrong-password one to someone who hasn't actually proven they
        // know the password. Checked before 2FA (rather than after) since
        // there's no point asking a suspended account for a code it'll be
        // refused regardless of. Not recorded against the rate limit and
        // the limit isn't reset either, the same treatment as the
        // 2FA-required path just below: nothing was actually guessed, and
        // no real login has succeeded yet.
        if (isSuspended(user)) {
          throw new AccountSuspendedError();
        }

        if (user.twoFactorEnabledAt && user.twoFactorSecretCiphertext) {
          const code = typeof credentials?.code === "string" ? credentials.code.trim() : "";
          // No code submitted yet: the password was right, but this isn't
          // failed credentials - it's an incomplete attempt. Not recorded
          // against the rate limit (nothing was actually guessed) and the
          // limit isn't reset either (a real login hasn't succeeded yet).
          if (!code) throw new TwoFactorRequiredError();

          const secret = decryptTwoFactorSecret(user.twoFactorSecretCiphertext);
          let codeValid = verifyTotpCode(secret, code);
          if (!codeValid) {
            const { valid, remainingHashes } = await verifyAndConsumeBackupCode(
              user.twoFactorBackupCodeHashes,
              code,
            );
            codeValid = valid;
            if (valid) {
              await prisma.user.update({
                where: { id: user.id },
                data: { twoFactorBackupCodeHashes: remainingHashes },
              });
            }
          }

          if (!codeValid) {
            await recordFailedAttempt({ key: rateLimitKey, windowMs: LOGIN_RATE_LIMIT.windowMs });
            return null;
          }
        }

        await resetRateLimit(rateLimitKey);

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          sessionVersion: user.sessionVersion,
        };
      },
    }),
    ...(googleSignInEnabled
      ? [
          Google({
            // Passed explicitly: Auth.js would otherwise only look for
            // AUTH_GOOGLE_ID/AUTH_GOOGLE_SECRET, while googleSignInEnabled
            // (which shows the button) checks these two.
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
            // role and sessionVersion are placeholders the jwt callback
            // below always replaces from the account's own User row; the
            // id here is Google's, not FYStay's (see resolveOAuthSignIn).
            profile(profile) {
              return {
                id: profile.sub,
                name: profile.name,
                email: profile.email,
                image: profile.picture,
                role: "GUEST",
                sessionVersion: 1,
              };
            },
          }),
        ]
      : []),
    ...(appleSecret
      ? [
          Apple({
            clientId: process.env.APPLE_CLIENT_ID,
            clientSecret: appleSecret,
            // Apple sends the person's name only on their very first
            // consent (as a separate "user" form field Auth.js folds into
            // the profile), never a photo, and the email may be a private
            // relay address. No name means none - not the email address,
            // which is what the stock profile() would use as a name.
            profile(profile) {
              const name = [profile.user?.name?.firstName, profile.user?.name?.lastName]
                .filter(Boolean)
                .join(" ");
              return {
                id: profile.sub,
                name: name || null,
                email: profile.email,
                image: null,
                role: "GUEST",
                sessionVersion: 1,
              };
            },
          }),
        ]
      : []),
  ],
  events: {
    // A half-finished "Connect Google/Apple" must not outlive the person who
    // started it: on a shared computer, the next person's Google sign-in
    // would otherwise be linked to the account that just signed out.
    async signOut() {
      (await cookies()).delete(LINK_INTENT_COOKIE);
    },
  },
  callbacks: {
    async signIn({ user, account, profile }) {
      if (!account || !isOAuthProvider(account.provider)) return true;
      const provider = account.provider;

      // "Connect Google/Apple" from the account page: a signed, short-lived
      // cookie set after the person re-entered their password (see
      // src/lib/oauthLinkIntent.ts). Read once, then cleared.
      const cookieStore = await cookies();
      const intent = cookieStore.get(LINK_INTENT_COOKIE)?.value;
      const secret = linkIntentSecret();
      const linkToUserId = intent && secret ? verifyLinkIntent(intent, provider, secret) : null;
      if (intent) cookieStore.delete(LINK_INTENT_COOKIE);

      const result = await resolveOAuthSignIn(prisma, {
        provider,
        providerAccountId: account.providerAccountId,
        email: user.email,
        emailVerified: claimIsTrue(profile?.email_verified),
        name: user.name,
        image: user.image,
        linkToUserId,
      });
      if (!result.ok) return oauthRefusalRedirect(result.reason, provider, Boolean(linkToUserId));
      if (linkToUserId) return `/account?connected=${provider}`;
      return true;
    },
    async jwt({ token, user, account }) {
      if (account && isOAuthProvider(account.provider)) {
        // The provider's profile knows nothing of this app's id or role -
        // signIn() above just found, created or linked the FYStay account
        // this identity belongs to, so read it from there.
        const identity = await prisma.authIdentity.findUnique({
          where: {
            provider_providerAccountId: { provider: account.provider, providerAccountId: account.providerAccountId },
          },
          select: { user: { select: { id: true, role: true, sessionVersion: true, name: true, image: true } } },
        });
        if (!identity) return null;
        token.id = identity.user.id;
        token.role = identity.user.role;
        token.sessionVersion = identity.user.sessionVersion;
        // The account's own name and photo, not the provider's: someone who
        // edited their name on FYStay keeps seeing it in the header.
        token.name = identity.user.name;
        token.picture = identity.user.image;
        // Freshly stamped from the row just read above - nothing further
        // to validate this same call.
        return token;
      }
      if (user) {
        token.id = user.id;
        token.role = user.role;
        token.sessionVersion = user.sessionVersion;
        // Same reasoning as the Google branch: authorize() just read this
        // user fresh from the DB.
        return token;
      }

      // Every later read of an *existing* session (no `user` on this call -
      // see the two early returns above) re-validates against the live
      // User row instead of trusting whatever the JWT already claims. This
      // is what makes a password reset, an admin suspending this account,
      // or self-service account deletion actually end an already-issued
      // session instead of leaving it valid until NextAuth's own JWT
      // expiry (30 days by default) - and what powers the self-service
      // "sign out of all devices" action (see revokeAllSessions). auth()
      // is wrapped in React's cache() below so this only runs once per
      // request no matter how many places call it.
      const current = await prisma.user.findUnique({
        where: { id: token.id as string },
        select: { role: true, sessionVersion: true, suspendedAt: true, deletedAt: true },
      });
      if (!current || current.deletedAt || isSuspended(current) || current.sessionVersion !== token.sessionVersion) {
        return null;
      }
      // The role is re-read too, so a guest who starts hosting (see
      // /api/account/become-host) gets host access without signing out.
      token.role = current.role;
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.role = token.role as "GUEST" | "HOST" | "ADMIN";
      }
      return session;
    },
  },
});

export { handlers, signIn, signOut };
// React's cache() dedupes calls within a single request (server component
// render, or a route handler's own execution) - without it, every one of
// the ~40 call sites across this app that call auth() would each trigger
// their own full internal NextAuth round trip, including the live
// sessionVersion/suspendedAt/deletedAt lookup the jwt callback above now
// does on every session read. One request should only pay for that once.
export const auth = cache(uncachedAuth);
